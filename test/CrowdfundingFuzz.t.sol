// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {Crowdfunding} from "../src/Crowdfunding.sol";

contract CrowdfundingFuzzTest is Test {
    Crowdfunding private target;
    address private owner;
    address private alice;
    address private bob;

    function setUp() public {
        target = new Crowdfunding();
        owner = makeAddr("fuzz owner");
        alice = makeAddr("fuzz alice");
        bob = makeAddr("fuzz bob");
        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.warp(1_000_000);
    }

    function _create(uint256 goal, uint256 duration) private returns (uint256 id) {
        vm.prank(owner);
        target.createCampaign(goal, duration);
        return target.campaignCount();
    }

    function _contribute(uint256 id, address donor, uint256 amount) private {
        vm.prank(donor);
        target.contribute{value: amount}(id);
    }

    function testFuzz_createPreservesParameters(uint256 rawGoal, uint256 rawDuration) public {
        uint256 goal = bound(rawGoal, 1, type(uint256).max);
        uint256 duration = bound(rawDuration, 1, type(uint256).max - block.timestamp);
        uint256 id = _create(goal, duration);
        (address actualOwner, uint256 actualGoal, uint256 raised, uint256 deadline, bool withdrawn) =
            target.campaigns(id);
        assertEq(actualOwner, owner);
        assertEq(actualGoal, goal);
        assertEq(deadline, block.timestamp + duration);
        assertEq(raised, 0);
        assertFalse(withdrawn);
    }

    function testFuzz_durationOverflowRollsBackCreation(uint256 seed) public {
        uint256 duration = bound(seed, type(uint256).max - block.timestamp + 1, type(uint256).max);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        target.createCampaign(1, duration);
        assertEq(target.campaignCount(), 0);
        (address actualOwner,,,,) = target.campaigns(1);
        assertEq(actualOwner, address(0));
    }

    function testFuzz_repeatedContributionsAccumulate(uint96[4] memory rawAmounts) public {
        uint256 id = _create(100 ether, 100);
        uint256 total;
        for (uint256 i; i < rawAmounts.length; ++i) {
            uint256 amount = bound(rawAmounts[i], 1, 20 ether);
            _contribute(id, alice, amount);
            total += amount;
            assertEq(target.contributions(id, alice), total);
            (,, uint256 raised,,) = target.campaigns(id);
            assertEq(raised, total);
            assertEq(address(target).balance, total);
        }
    }

    function testFuzz_contributorAttribution(address first, address second, uint96 rawA, uint96 rawB) public {
        vm.assume(first != address(target) && second != address(target));
        vm.assume(first != address(vm) && second != address(vm));
        uint256 a = bound(rawA, 1, 20 ether);
        uint256 b = bound(rawB, 1, 20 ether);
        uint256 id = _create(100 ether, 100);
        vm.deal(first, 100 ether);
        vm.deal(second, 100 ether);
        _contribute(id, first, a);
        _contribute(id, second, b);
        assertEq(target.contributions(id, first), first == second ? a + b : a);
        assertEq(target.contributions(id, second), first == second ? a + b : b);
        assertEq(address(target).balance, a + b);
    }

    function testFuzz_settlementConservesContributions(uint96 rawA, uint96 rawB, uint96 rawGoal, bool reverse) public {
        uint256 a = bound(rawA, 1, 20 ether);
        uint256 b = bound(rawB, 1, 20 ether);
        uint256 goal = bound(rawGoal, 1, 50 ether);
        uint256 id = _create(goal, 100);
        _contribute(id, alice, a);
        _contribute(id, bob, b);
        vm.warp(block.timestamp + 100);
        if (a + b >= goal) {
            vm.prank(owner);
            target.withdraw(id);
            assertEq(owner.balance, a + b);
            (,, uint256 raised,, bool withdrawn) = target.campaigns(id);
            assertEq(raised, a + b);
            assertTrue(withdrawn);
            vm.prank(owner);
            vm.expectRevert(Crowdfunding.AlreadyWithdrawn.selector);
            target.withdraw(id);
            vm.prank(alice);
            vm.expectRevert(Crowdfunding.GoalWasReached.selector);
            target.refund(id);
        } else {
            address first = reverse ? bob : alice;
            address second = reverse ? alice : bob;
            uint256 secondAmount = reverse ? a : b;
            vm.prank(first);
            target.refund(id);
            assertEq(target.contributions(id, first), 0);
            assertEq(target.contributions(id, second), secondAmount);
            assertEq(address(target).balance, secondAmount);
            vm.prank(first);
            vm.expectRevert(Crowdfunding.NothingToRefund.selector);
            target.refund(id);
            vm.prank(second);
            target.refund(id);
            assertEq(alice.balance, 1_000 ether);
            assertEq(bob.balance, 1_000 ether);
        }
        assertEq(address(target).balance, 0);
    }

    function testFuzz_campaignIsolation(uint96 rawA, uint96 rawB, bool withdrawFirst) public {
        uint256 a = bound(rawA, 1, 20 ether);
        uint256 b = bound(rawB, 1, 20 ether);
        uint256 success = _create(a, 100);
        uint256 failure = _create(b + 1, 100);
        _contribute(success, alice, a);
        _contribute(failure, alice, b);
        vm.warp(block.timestamp + 100);
        if (withdrawFirst) {
            vm.prank(owner);
            target.withdraw(success);
            assertEq(address(target).balance, b);
            assertEq(target.contributions(failure, alice), b);
            vm.prank(alice);
            target.refund(failure);
        } else {
            vm.prank(alice);
            target.refund(failure);
            assertEq(address(target).balance, a);
            (,, uint256 raised,, bool withdrawn) = target.campaigns(success);
            assertEq(raised, a);
            assertFalse(withdrawn);
            vm.prank(owner);
            target.withdraw(success);
        }
        assertEq(owner.balance, a);
        assertEq(alice.balance, 1_000 ether - a);
        assertEq(address(target).balance, 0);
    }

    function testFuzz_contributionDeadline(uint32 rawDuration, uint8 rawBoundary) public {
        uint256 duration = bound(rawDuration, 1, 365 days);
        uint256 boundary = bound(rawBoundary, 0, 2);
        uint256 id = _create(1 ether, duration);
        vm.warp(block.timestamp + duration - 1 + boundary);
        vm.prank(alice);
        if (boundary != 0) vm.expectRevert(Crowdfunding.CampaignEnded.selector);
        target.contribute{value: 1}(id);
        assertEq(address(target).balance, boundary == 0 ? 1 : 0);
    }

    function testFuzz_settlementDeadline(uint32 rawDuration, uint8 rawBoundary, bool successful) public {
        uint256 duration = bound(rawDuration, 1, 365 days);
        uint256 boundary = bound(rawBoundary, 0, 2);
        uint256 id = _create(successful ? 1 ether : 2 ether, duration);
        _contribute(id, alice, 1 ether);
        vm.warp(block.timestamp + duration - 1 + boundary);
        vm.prank(successful ? owner : alice);
        if (boundary == 0) vm.expectRevert(Crowdfunding.CampaignNotEnded.selector);
        if (successful) target.withdraw(id);
        else target.refund(id);
        assertEq(address(target).balance, boundary == 0 ? 1 ether : 0);
    }

    function testFuzz_unauthorizedWithdrawal(uint160 rawSender, uint96 rawAmount) public {
        address sender = address(uint160(bound(rawSender, 0x10000, type(uint160).max)));
        vm.assume(sender != owner && sender != address(target));
        uint256 amount = bound(rawAmount, 1, 20 ether);
        uint256 id = _create(amount, 100);
        _contribute(id, alice, amount);
        vm.warp(block.timestamp + 100);
        vm.prank(sender);
        vm.expectRevert(Crowdfunding.NotOwner.selector);
        target.withdraw(id);
        (,,,, bool withdrawn) = target.campaigns(id);
        assertFalse(withdrawn);
        assertEq(address(target).balance, amount);
    }

    function testFuzz_nonexistentCampaign(uint256 seed) public {
        _create(1 ether, 100);
        uint256 id = bound(seed, 2, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);
        target.contribute{value: 1}(id);
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);
        target.withdraw(id);
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);
        target.refund(id);
        assertEq(target.campaignCount(), 1);
        assertEq(address(target).balance, 0);
    }

    function _recipient(uint160 seed) private view returns (address payable recipient) {
        recipient = payable(address(uint160(bound(seed, 0x10000, type(uint160).max))));
        vm.assume(recipient != owner && recipient != alice && recipient != bob);
        vm.assume(recipient != address(target) && recipient != address(vm) && recipient != address(this));
        vm.assume(recipient.code.length == 0);
    }

    function testFuzz_withdrawAPIsShareOneEntitlement(uint96 rawAmount, uint160 recipientSeed, bool redirectFirst)
        public
    {
        uint256 amount = bound(rawAmount, 1, 20 ether);
        address payable recipient = _recipient(recipientSeed);
        uint256 recipientBefore = recipient.balance;
        uint256 id = _create(amount, 100);
        _contribute(id, alice, amount);
        vm.warp(block.timestamp + 100);
        vm.prank(owner);
        if (redirectFirst) target.withdrawTo(id, recipient);
        else target.withdraw(id);
        assertEq(recipient.balance, recipientBefore + (redirectFirst ? amount : 0));
        assertEq(owner.balance, redirectFirst ? 0 : amount);
        vm.prank(owner);
        vm.expectRevert(Crowdfunding.AlreadyWithdrawn.selector);
        if (redirectFirst) target.withdraw(id);
        else target.withdrawTo(id, recipient);
        (address actualOwner,, uint256 raised,, bool withdrawn) = target.campaigns(id);
        assertEq(actualOwner, owner);
        assertEq(raised, amount);
        assertTrue(withdrawn);
        assertEq(address(target).balance, 0);
    }

    function testFuzz_refundAPIsShareOneEntitlement(uint96 rawAmount, uint160 recipientSeed, bool redirectFirst)
        public
    {
        uint256 amount = bound(rawAmount, 1, 20 ether);
        address payable recipient = _recipient(recipientSeed);
        uint256 recipientBefore = recipient.balance;
        uint256 id = _create(amount + 1, 100);
        _contribute(id, alice, amount);
        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        if (redirectFirst) target.refundTo(id, recipient);
        else target.refund(id);
        assertEq(recipient.balance, recipientBefore + (redirectFirst ? amount : 0));
        assertEq(alice.balance, 1_000 ether - (redirectFirst ? amount : 0));
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.NothingToRefund.selector);
        if (redirectFirst) target.refund(id);
        else target.refundTo(id, recipient);
        assertEq(target.contributions(id, alice), 0);
        (,, uint256 raised,,) = target.campaigns(id);
        assertEq(raised, 0);
        assertEq(address(target).balance, 0);
    }
}
