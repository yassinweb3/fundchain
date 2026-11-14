// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {Crowdfunding} from "../src/Crowdfunding.sol";
import {CrowdfundingActor, ForceCrowdfundingETH} from "./helpers/CrowdfundingActors.sol";

contract CrowdfundingSecurityTest is Test {
    Crowdfunding private target;
    address private owner;
    address private alice;
    address private bob;
    uint256 private constant GOAL = 10 ether;
    uint256 private constant DURATION = 100;
    uint256 private start;

    event CampaignCreated(uint256 indexed campaignId, address indexed owner);
    event Contributed(uint256 indexed campaignId, address indexed contributor, uint256 amount);
    event Withdrawn(uint256 indexed campaignId, address indexed owner, uint256 amount);
    event Refunded(uint256 indexed campaignId, address indexed contributor, uint256 amount);

    function setUp() public {
        target = new Crowdfunding();
        owner = makeAddr("security owner");
        alice = makeAddr("security alice");
        bob = makeAddr("security bob");
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(address(this), 100 ether);
        vm.warp(1_000_000);
        start = block.timestamp;
    }

    function _create(uint256 goal, uint256 duration) private returns (uint256 id) {
        vm.prank(owner);
        target.createCampaign(goal, duration);
        return target.campaignCount();
    }

    function _contribute(uint256 id, address donor, uint256 value) private {
        vm.prank(donor);
        target.contribute{value: value}(id);
    }

    function _raised(uint256 id) private view returns (uint256 amount) {
        (,, amount,,) = target.campaigns(id);
    }

    function _withdrawn(uint256 id) private view returns (bool value) {
        (,,,, value) = target.campaigns(id);
    }

    function test_contributionDeadlineBoundaries() public {
        uint256 id = _create(GOAL, DURATION);
        vm.warp(start + DURATION - 1);
        _contribute(id, alice, 1 wei);
        vm.warp(start + DURATION);
        vm.expectRevert(Crowdfunding.CampaignEnded.selector);
        _contribute(id, alice, 1 wei);
        vm.warp(start + DURATION + 1);
        vm.expectRevert(Crowdfunding.CampaignEnded.selector);
        _contribute(id, alice, 1 wei);
        assertEq(_raised(id), 1 wei);
        assertEq(target.contributions(id, alice), 1 wei);
        assertEq(address(target).balance, 1 wei);
    }

    function test_withdrawDeadlineBoundaries() public {
        uint256 id = _create(GOAL, DURATION);
        _contribute(id, alice, GOAL);
        vm.warp(start + DURATION - 1);
        vm.prank(owner);
        vm.expectRevert(Crowdfunding.CampaignNotEnded.selector);
        target.withdraw(id);
        assertFalse(_withdrawn(id));
        vm.warp(start + DURATION);
        vm.prank(owner);
        target.withdraw(id);
        assertEq(owner.balance, GOAL);
        vm.warp(start + DURATION + 1);
        vm.prank(owner);
        vm.expectRevert(Crowdfunding.AlreadyWithdrawn.selector);
        target.withdraw(id);
    }

    function test_refundDeadlineBoundaries() public {
        uint256 id = _create(GOAL, DURATION);
        _contribute(id, alice, 1 ether);
        vm.warp(start + DURATION - 1);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.CampaignNotEnded.selector);
        target.refund(id);
        assertEq(target.contributions(id, alice), 1 ether);
        vm.warp(start + DURATION);
        vm.prank(alice);
        target.refund(id);
        assertEq(alice.balance, 100 ether);
        vm.warp(start + DURATION + 1);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.NothingToRefund.selector);
        target.refund(id);
    }

    function test_goalMinusOneCannotWithdrawButCanRefund() public {
        uint256 id = _create(GOAL, DURATION);
        _contribute(id, alice, GOAL - 1);
        vm.warp(start + DURATION);
        vm.prank(owner);
        vm.expectRevert(Crowdfunding.GoalNotReached.selector);
        target.withdraw(id);
        vm.prank(alice);
        target.refund(id);
        assertEq(alice.balance, 100 ether);
        assertEq(address(target).balance, 0);
    }

    function test_overfundingPaysFullCampaignAmount() public {
        uint256 id = _create(GOAL, DURATION);
        _contribute(id, alice, GOAL);
        _contribute(id, alice, 1 wei);
        assertEq(target.contributions(id, alice), GOAL + 1);
        vm.warp(start + DURATION);
        vm.prank(owner);
        target.withdraw(id);
        assertEq(owner.balance, GOAL + 1);
        assertEq(_raised(id), GOAL + 1); // Historical funding is retained after payout.
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.GoalWasReached.selector);
        target.refund(id);
    }

    function test_zeroCampaignIdsRejectWithoutStateChanges() public {
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);
        target.contribute{value: 1}(0);
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);
        target.withdraw(0);
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);
        target.refund(0);
        assertEq(address(target).balance, 0);
        assertEq(target.campaignCount(), 0);
    }

    function test_createAndContributionEvents() public {
        vm.expectEmit(true, true, false, true, address(target));
        emit CampaignCreated(1, owner);
        uint256 id = _create(GOAL, DURATION);
        vm.expectEmit(true, true, false, true, address(target));
        emit Contributed(id, alice, 2 ether);
        _contribute(id, alice, 2 ether);
    }

    function test_withdrawReentrancyCannotRepeatOrRefund() public {
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(target.withdraw, (1));
        calls[1] = abi.encodeCall(target.refund, (1));
        calls[2] = abi.encodeCall(target.contribute, (1));
        actor.configure(1, calls, false);
        vm.warp(start + DURATION);
        actor.withdraw(1);
        assertTrue(actor.observedWithdrawn());
        assertEq(actor.observedRaised(), GOAL);
        assertFalse(actor.callbackSucceeded(0));
        assertFalse(actor.callbackSucceeded(1));
        assertFalse(actor.callbackSucceeded(2));
        assertEq(actor.callbackResults(0), abi.encodeWithSelector(Crowdfunding.AlreadyWithdrawn.selector));
        assertEq(actor.callbackResults(1), abi.encodeWithSelector(Crowdfunding.GoalWasReached.selector));
        assertEq(actor.callbackResults(2), abi.encodeWithSelector(Crowdfunding.CampaignEnded.selector));
        assertEq(actor.received(), GOAL);
        assertEq(actor.receiveCount(), 1);
        assertEq(address(target).balance, 0);
    }

    function test_refundReentrancyCannotRepeatOrWithdraw() public {
        uint256 id = _create(GOAL, DURATION);
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.contribute{value: 2 ether}(id);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(target.refund, (id));
        calls[1] = abi.encodeCall(target.withdraw, (id));
        actor.configure(id, calls, false);
        vm.warp(start + DURATION);
        actor.refund(id);
        assertEq(actor.observedContribution(), 0);
        assertEq(actor.observedRaised(), 0);
        assertFalse(actor.callbackSucceeded(0));
        assertFalse(actor.callbackSucceeded(1));
        assertEq(actor.callbackResults(0), abi.encodeWithSelector(Crowdfunding.NothingToRefund.selector));
        assertEq(actor.callbackResults(1), abi.encodeWithSelector(Crowdfunding.NotOwner.selector));
        assertEq(actor.received(), 2 ether);
        assertEq(actor.receiveCount(), 1);
    }

    function test_bubbledWithdrawReentrancyRollsBack() public {
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.withdraw, (1));
        actor.configure(1, calls, true);
        vm.warp(start + DURATION);
        vm.expectRevert(Crowdfunding.TransferFailed.selector);
        actor.withdraw(1);
        assertFalse(_withdrawn(1));
        assertEq(_raised(1), GOAL);
        assertEq(address(target).balance, GOAL);
        assertEq(actor.received(), 0);
        assertEq(address(actor).balance, 0);
    }

    function test_bubbledRefundReentrancyRollsBack() public {
        uint256 id = _create(GOAL, DURATION);
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.contribute{value: 2 ether}(id);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.refund, (id));
        actor.configure(id, calls, true);
        vm.warp(start + DURATION);
        vm.expectRevert(Crowdfunding.RefundFailed.selector);
        actor.refund(id);
        assertEq(target.contributions(id, address(actor)), 2 ether);
        assertEq(_raised(id), 2 ether);
        assertEq(address(target).balance, 2 ether);
        assertEq(actor.received(), 0);
    }

    function test_callbackCanSettleAnotherOwnedCampaignOnce() public {
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.create(GOAL, DURATION);
        actor.create(3 ether, DURATION);
        _contribute(1, alice, GOAL);
        _contribute(2, bob, 3 ether);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(target.withdraw, (2));
        calls[1] = abi.encodeCall(target.withdraw, (2));
        actor.configure(1, calls, false);
        vm.warp(start + DURATION);
        actor.withdraw(1);
        assertTrue(actor.callbackSucceeded(0));
        assertFalse(actor.callbackSucceeded(1));
        assertTrue(_withdrawn(1));
        assertTrue(_withdrawn(2));
        assertEq(actor.received(), 13 ether);
        assertEq(actor.receiveCount(), 2);
        assertEq(address(target).balance, 0);
    }

    function test_refundCallbackCanClaimAnotherCampaignEntitlement() public {
        _create(GOAL, DURATION);
        _create(GOAL, DURATION);
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.contribute{value: 2 ether}(1);
        actor.contribute{value: 3 ether}(2);
        _contribute(2, bob, 1 ether);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.refund, (2));
        actor.configure(1, calls, false);
        vm.warp(start + DURATION);
        actor.refund(1);
        assertTrue(actor.callbackSucceeded(0));
        assertEq(actor.received(), 5 ether);
        assertEq(target.contributions(1, address(actor)), 0);
        assertEq(target.contributions(2, address(actor)), 0);
        assertEq(target.contributions(2, bob), 1 ether);
        assertEq(_raised(2), 1 ether);
        assertEq(address(target).balance, 1 ether);
    }

    function test_callbackCannotWithdrawSomeoneElsesCampaign() public {
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.create(GOAL, DURATION);
        uint256 other = _create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        _contribute(other, bob, GOAL);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.withdraw, (other));
        actor.configure(1, calls, false);
        vm.warp(start + DURATION);
        actor.withdraw(1);
        assertEq(actor.callbackResults(0), abi.encodeWithSelector(Crowdfunding.NotOwner.selector));
        assertFalse(_withdrawn(other));
        assertEq(_raised(other), GOAL);
        assertEq(address(target).balance, GOAL);
        vm.prank(owner);
        target.withdraw(other);
        assertEq(owner.balance, GOAL);
    }

    function test_withdrawCallbackCanRefundAnotherCampaign() public {
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.create(GOAL, DURATION);
        uint256 failed = _create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        actor.contribute{value: 2 ether}(failed);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.refund, (failed));
        actor.configure(1, calls, false);
        vm.warp(start + DURATION);
        actor.withdraw(1);
        assertTrue(actor.callbackSucceeded(0));
        assertEq(actor.received(), GOAL + 2 ether);
        assertTrue(_withdrawn(1));
        assertFalse(_withdrawn(failed));
        assertEq(target.contributions(failed, address(actor)), 0);
        assertEq(_raised(failed), 0);
        assertEq(address(target).balance, 0);
    }

    function test_bubbledCrossCampaignFailureRollsBackBothSettlements() public {
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.create(GOAL, DURATION);
        actor.create(3 ether, DURATION);
        _contribute(1, alice, GOAL);
        _contribute(2, bob, 3 ether);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(target.withdraw, (2));
        calls[1] = abi.encodeCall(target.withdraw, (1));
        actor.configure(1, calls, true);
        vm.warp(start + DURATION);
        vm.expectRevert(Crowdfunding.TransferFailed.selector);
        actor.withdraw(1);
        assertFalse(_withdrawn(1));
        assertFalse(_withdrawn(2));
        assertEq(_raised(1), GOAL);
        assertEq(_raised(2), 3 ether);
        assertEq(address(target).balance, GOAL + 3 ether);
        assertEq(actor.received(), 0);
        assertEq(actor.receiveCount(), 0);
    }

    function test_refundCallbackCannotSpendAnotherDonorsEntitlement() public {
        _create(GOAL, DURATION);
        _create(GOAL, DURATION);
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.contribute{value: 2 ether}(1);
        _contribute(2, bob, 3 ether);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.refund, (2));
        actor.configure(1, calls, false);
        vm.warp(start + DURATION);
        actor.refund(1);
        assertEq(actor.callbackResults(0), abi.encodeWithSelector(Crowdfunding.NothingToRefund.selector));
        assertEq(target.contributions(2, bob), 3 ether);
        assertEq(address(target).balance, 3 ether);
    }

    function test_failedWithdrawCanRetryWhenRecipientAccepts() public {
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        actor.setRejecting(true);
        vm.warp(start + DURATION);
        vm.expectRevert(Crowdfunding.TransferFailed.selector);
        actor.withdraw(1);
        assertFalse(_withdrawn(1));
        assertEq(address(target).balance, GOAL);
        assertEq(target.contributions(1, alice), GOAL);
        actor.setRejecting(false);
        vm.expectEmit(true, true, false, true, address(target));
        emit Withdrawn(1, address(actor), GOAL);
        actor.withdraw(1);
        assertEq(actor.received(), GOAL);
        assertTrue(_withdrawn(1));
        vm.expectRevert(Crowdfunding.AlreadyWithdrawn.selector);
        actor.withdraw(1);
    }

    function test_failedRefundDoesNotBlockOthersAndCanRetry() public {
        uint256 id = _create(GOAL, DURATION);
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.contribute{value: 2 ether}(id);
        _contribute(id, bob, 3 ether);
        actor.setRejecting(true);
        vm.warp(start + DURATION);
        vm.expectRevert(Crowdfunding.RefundFailed.selector);
        actor.refund(id);
        assertEq(target.contributions(id, address(actor)), 2 ether);
        assertEq(_raised(id), 5 ether);
        assertEq(address(target).balance, 5 ether);
        vm.prank(bob);
        target.refund(id);
        assertEq(bob.balance, 100 ether);
        assertEq(_raised(id), 2 ether);
        actor.setRejecting(false);
        vm.expectEmit(true, true, false, true, address(target));
        emit Refunded(id, address(actor), 2 ether);
        actor.refund(id);
        assertEq(actor.received(), 2 ether);
        assertEq(address(target).balance, 0);
        vm.expectRevert(Crowdfunding.NothingToRefund.selector);
        actor.refund(id);
    }

    function test_rejectingOwnerDoesNotBlockOtherCampaigns() public {
        CrowdfundingActor actor = new CrowdfundingActor(target);
        actor.create(GOAL, DURATION);
        uint256 other = _create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        _contribute(other, bob, GOAL);
        actor.setRejecting(true);
        vm.warp(start + DURATION);
        vm.expectRevert(Crowdfunding.TransferFailed.selector);
        actor.withdraw(1);
        vm.prank(owner);
        target.withdraw(other);
        assertEq(owner.balance, GOAL);
        assertEq(address(target).balance, GOAL);
        assertFalse(_withdrawn(1));
        // Contributors cannot bypass a successful campaign owner's withdrawal entitlement.
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.GoalWasReached.selector);
        target.refund(1);
    }

    function test_mixedCampaignsAndDeadlinesRemainIsolated() public {
        uint256 successful = _create(3 ether, DURATION);
        uint256 failed = _create(GOAL, DURATION);
        uint256 active = _create(GOAL, DURATION * 2);
        _contribute(successful, alice, 4 ether);
        _contribute(failed, alice, 2 ether);
        _contribute(failed, bob, 1 ether);
        _contribute(active, bob, 5 ether);
        vm.warp(start + DURATION);
        vm.prank(alice);
        target.refund(failed);
        vm.prank(owner);
        target.withdraw(successful);
        assertEq(owner.balance, 4 ether);
        assertEq(_raised(failed), 1 ether);
        assertEq(_raised(active), 5 ether);
        assertEq(target.contributions(active, bob), 5 ether);
        assertEq(address(target).balance, 6 ether);
        _contribute(active, alice, 5 ether);
        vm.prank(bob);
        target.refund(failed);
        vm.warp(start + DURATION * 2);
        vm.prank(owner);
        target.withdraw(active);
        assertEq(owner.balance, 14 ether);
        assertEq(address(target).balance, 0);
    }

    function test_forcedSurplusDoesNotIncreasePayouts() public {
        uint256 successful = _create(GOAL, DURATION);
        uint256 failed = _create(GOAL, DURATION);
        _contribute(successful, alice, GOAL);
        _contribute(failed, bob, 2 ether);
        new ForceCrowdfundingETH{value: 3 ether}(payable(address(target)));
        assertEq(address(target).balance, 15 ether);
        assertEq(_raised(successful), GOAL);
        assertEq(_raised(failed), 2 ether);
        vm.warp(start + DURATION);
        vm.prank(owner);
        target.withdraw(successful);
        vm.prank(bob);
        target.refund(failed);
        assertEq(owner.balance, GOAL);
        assertEq(bob.balance, 100 ether);
        assertEq(address(target).balance, 3 ether);
    }
}
