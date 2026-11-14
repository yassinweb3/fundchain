// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {Crowdfunding} from "../src/Crowdfunding.sol";
import {CrowdfundingActor} from "./helpers/CrowdfundingActors.sol";

contract CrowdfundingPayoutsTest is Test {
    Crowdfunding private target;
    address private owner;
    address private alice;
    address private bob;
    uint256 private constant GOAL = 10 ether;
    uint256 private constant DURATION = 100;

    event Withdrawn(uint256 indexed campaignId, address indexed owner, uint256 amount);
    event Refunded(uint256 indexed campaignId, address indexed contributor, uint256 amount);
    event PayoutRedirected(
        uint256 indexed campaignId, address indexed claimant, address indexed recipient, uint256 amount, bool isRefund
    );

    function setUp() public {
        target = new Crowdfunding();
        owner = makeAddr("payout owner");
        alice = makeAddr("payout alice");
        bob = makeAddr("payout bob");
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(address(this), 100 ether);
        vm.warp(1_000_000);
    }

    function _create() private {
        vm.prank(owner);
        target.createCampaign(GOAL, DURATION);
    }

    function _contribute(uint256 id, address donor, uint256 amount) private {
        vm.prank(donor);
        target.contribute{value: amount}(id);
    }

    function _withdrawn(uint256 id) private view returns (bool value) {
        (,,,, value) = target.campaigns(id);
    }

    function _raised(uint256 id) private view returns (uint256 value) {
        (,, value,,) = target.campaigns(id);
    }

    function test_permanentlyRejectingOwnerRedirectsPayment() public {
        CrowdfundingActor claimant = new CrowdfundingActor(target);
        claimant.setRejecting(true);
        claimant.create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        vm.warp(block.timestamp + DURATION);
        vm.expectRevert(Crowdfunding.TransferFailed.selector);
        claimant.withdraw(1);

        vm.expectEmit(true, true, false, true, address(target));
        emit Withdrawn(1, address(claimant), GOAL);
        vm.expectEmit(true, true, true, true, address(target));
        emit PayoutRedirected(1, address(claimant), bob, GOAL, false);
        claimant.withdrawTo(1, payable(bob));
        assertTrue(_withdrawn(1));
        assertEq(bob.balance, 100 ether + GOAL);
        assertEq(address(claimant).balance, 0);
        assertTrue(claimant.rejecting());
        (address actualOwner,,,,) = target.campaigns(1);
        assertEq(actualOwner, address(claimant));
        assertEq(_raised(1), GOAL);
        vm.expectRevert(Crowdfunding.AlreadyWithdrawn.selector);
        claimant.withdraw(1);
        vm.expectRevert(Crowdfunding.AlreadyWithdrawn.selector);
        claimant.withdrawTo(1, payable(alice));
    }

    function test_rejectingContributorRedirectsOnlyItsOwnEntitlement() public {
        _create();
        CrowdfundingActor claimant = new CrowdfundingActor(target);
        claimant.contribute{value: 2 ether}(1);
        claimant.setRejecting(true);
        _contribute(1, bob, 3 ether);
        vm.warp(block.timestamp + DURATION);
        vm.expectRevert(Crowdfunding.RefundFailed.selector);
        claimant.refund(1);
        vm.expectEmit(true, true, false, true, address(target));
        emit Refunded(1, address(claimant), 2 ether);
        vm.expectEmit(true, true, true, true, address(target));
        emit PayoutRedirected(1, address(claimant), bob, 2 ether, true);
        claimant.refundTo(1, payable(bob));
        assertEq(target.contributions(1, address(claimant)), 0);
        assertEq(target.contributions(1, bob), 3 ether);
        assertEq(_raised(1), 3 ether);
        assertEq(address(target).balance, 3 ether);
        assertEq(address(claimant).balance, 0);
        assertEq(bob.balance, 99 ether);
        vm.prank(bob);
        target.refund(1);
        assertEq(bob.balance, 102 ether);
        vm.expectRevert(Crowdfunding.NothingToRefund.selector);
        claimant.refund(1);
        vm.expectRevert(Crowdfunding.NothingToRefund.selector);
        claimant.refundTo(1, payable(alice));
    }

    function test_withdrawToRequiresOriginalOwnerEvenForInvalidRecipient() public {
        _create();
        _contribute(1, alice, GOAL);
        vm.warp(block.timestamp + DURATION);
        vm.prank(bob);
        vm.expectRevert(Crowdfunding.NotOwner.selector);
        target.withdrawTo(1, payable(bob));
        vm.prank(bob);
        vm.expectRevert(Crowdfunding.NotOwner.selector);
        target.withdrawTo(1, payable(address(0)));
        assertFalse(_withdrawn(1));
        assertEq(address(target).balance, GOAL);
    }

    function test_refundToCannotClaimAnotherContributorsFunds() public {
        _create();
        _contribute(1, alice, 2 ether);
        vm.warp(block.timestamp + DURATION);
        vm.prank(bob);
        vm.expectRevert(Crowdfunding.NothingToRefund.selector);
        target.refundTo(1, payable(bob));
        assertEq(target.contributions(1, alice), 2 ether);
        assertEq(address(target).balance, 2 ether);
    }

    function test_invalidWithdrawalRecipientsPreserveEntitlement() public {
        _create();
        _contribute(1, alice, GOAL);
        vm.warp(block.timestamp + DURATION);
        address[2] memory invalid = [address(0), address(target)];
        for (uint256 i; i < invalid.length; ++i) {
            vm.prank(owner);
            vm.expectRevert(Crowdfunding.InvalidRecipient.selector);
            target.withdrawTo(1, payable(invalid[i]));
            assertFalse(_withdrawn(1));
            assertEq(_raised(1), GOAL);
            assertEq(address(target).balance, GOAL);
        }
        vm.prank(owner);
        target.withdraw(1);
        assertEq(owner.balance, GOAL);
    }

    function test_invalidRefundRecipientsPreserveEntitlement() public {
        _create();
        _contribute(1, alice, 2 ether);
        vm.warp(block.timestamp + DURATION);
        address[2] memory invalid = [address(0), address(target)];
        for (uint256 i; i < invalid.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(Crowdfunding.InvalidRecipient.selector);
            target.refundTo(1, payable(invalid[i]));
            assertEq(target.contributions(1, alice), 2 ether);
            assertEq(_raised(1), 2 ether);
            assertEq(address(target).balance, 2 ether);
        }
        vm.prank(alice);
        target.refund(1);
        assertEq(alice.balance, 100 ether);
    }

    function test_rejectedWithdrawalDestinationAllowsLegacyRetry() public {
        _create();
        _contribute(1, alice, GOAL);
        CrowdfundingActor recipient = new CrowdfundingActor(target);
        recipient.setRejecting(true);
        vm.warp(block.timestamp + DURATION);
        vm.prank(owner);
        vm.expectRevert(Crowdfunding.TransferFailed.selector);
        target.withdrawTo(1, payable(address(recipient)));
        assertFalse(_withdrawn(1));
        assertEq(_raised(1), GOAL);
        assertEq(address(target).balance, GOAL);
        assertEq(address(recipient).balance, 0);
        vm.prank(owner);
        target.withdraw(1);
        assertEq(owner.balance, GOAL);
    }

    function test_rejectedRefundDestinationAllowsLegacyRetry() public {
        _create();
        _contribute(1, alice, 2 ether);
        CrowdfundingActor recipient = new CrowdfundingActor(target);
        recipient.setRejecting(true);
        vm.warp(block.timestamp + DURATION);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.RefundFailed.selector);
        target.refundTo(1, payable(address(recipient)));
        assertEq(target.contributions(1, alice), 2 ether);
        assertEq(_raised(1), 2 ether);
        assertEq(address(target).balance, 2 ether);
        assertEq(address(recipient).balance, 0);
        vm.prank(alice);
        target.refund(1);
        assertEq(alice.balance, 100 ether);
    }

    function test_legacyAndExplicitSelfPayoutsEmitOnlyLegacyEvents() public {
        _create();
        _create();
        _contribute(1, alice, GOAL);
        _contribute(2, alice, 2 ether);
        vm.warp(block.timestamp + DURATION);
        vm.recordLogs();
        vm.prank(owner);
        target.withdrawTo(1, payable(owner));
        assertEq(vm.getRecordedLogs().length, 1);
        vm.recordLogs();
        vm.prank(alice);
        target.refundTo(2, payable(alice));
        assertEq(vm.getRecordedLogs().length, 1);
    }

    function test_newEndpointsPreserveCampaignAndTimeChecks() public {
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);
        target.withdrawTo(0, payable(bob));
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);
        target.refundTo(0, payable(bob));
        _create();
        _contribute(1, alice, 2 ether);
        vm.prank(owner);
        vm.expectRevert(Crowdfunding.CampaignNotEnded.selector);
        target.withdrawTo(1, payable(bob));
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.CampaignNotEnded.selector);
        target.refundTo(1, payable(bob));
        vm.warp(block.timestamp + DURATION);
        vm.prank(owner);
        vm.expectRevert(Crowdfunding.GoalNotReached.selector);
        target.withdrawTo(1, payable(bob));
        vm.prank(alice);
        target.refundTo(1, payable(bob));
        assertEq(bob.balance, 102 ether);
    }

    function test_successfulCampaignCannotRefundToAnotherAddress() public {
        _create();
        _contribute(1, alice, GOAL);
        vm.warp(block.timestamp + DURATION);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.GoalWasReached.selector);
        target.refundTo(1, payable(bob));
        assertEq(address(target).balance, GOAL);
    }

    function test_withdrawCallbackCannotDoubleClaimThroughEitherAPI() public {
        CrowdfundingActor claimant = new CrowdfundingActor(target);
        claimant.create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(target.withdraw, (1));
        calls[1] = abi.encodeCall(target.withdrawTo, (1, payable(bob)));
        calls[2] = abi.encodeCall(target.refund, (1));
        calls[3] = abi.encodeCall(target.refundTo, (1, payable(bob)));
        claimant.configure(1, calls, false);
        vm.warp(block.timestamp + DURATION);
        claimant.withdrawTo(1, payable(address(claimant)));
        assertTrue(claimant.observedWithdrawn());
        for (uint256 i; i < calls.length; ++i) {
            assertFalse(claimant.callbackSucceeded(i));
            bytes4 expected = i < 2 ? Crowdfunding.AlreadyWithdrawn.selector : Crowdfunding.GoalWasReached.selector;
            assertEq(claimant.callbackResults(i), abi.encodeWithSelector(expected));
        }
        assertEq(claimant.received(), GOAL);
        assertEq(bob.balance, 100 ether);
        assertEq(address(target).balance, 0);
    }

    function test_refundCallbackCannotDoubleClaimThroughEitherAPI() public {
        _create();
        CrowdfundingActor claimant = new CrowdfundingActor(target);
        claimant.contribute{value: 2 ether}(1);
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(target.refund, (1));
        calls[1] = abi.encodeCall(target.refundTo, (1, payable(bob)));
        calls[2] = abi.encodeCall(target.withdraw, (1));
        calls[3] = abi.encodeCall(target.withdrawTo, (1, payable(bob)));
        claimant.configure(1, calls, false);
        vm.warp(block.timestamp + DURATION);
        claimant.refundTo(1, payable(address(claimant)));
        assertEq(claimant.observedContribution(), 0);
        for (uint256 i; i < calls.length; ++i) {
            assertFalse(claimant.callbackSucceeded(i));
            bytes4 expected = i < 2 ? Crowdfunding.NothingToRefund.selector : Crowdfunding.NotOwner.selector;
            assertEq(claimant.callbackResults(i), abi.encodeWithSelector(expected));
        }
        assertEq(claimant.received(), 2 ether);
        assertEq(bob.balance, 100 ether);
        assertEq(address(target).balance, 0);
    }

    function test_legacyWithdrawCallbackCannotClaimThroughNewAPI() public {
        CrowdfundingActor claimant = new CrowdfundingActor(target);
        claimant.create(GOAL, DURATION);
        _contribute(1, alice, GOAL);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.withdrawTo, (1, payable(bob)));
        claimant.configure(1, calls, false);
        vm.warp(block.timestamp + DURATION);
        claimant.withdraw(1);
        assertTrue(claimant.observedWithdrawn());
        assertEq(claimant.callbackResults(0), abi.encodeWithSelector(Crowdfunding.AlreadyWithdrawn.selector));
        assertEq(claimant.received(), GOAL);
        assertEq(bob.balance, 100 ether);
    }

    function test_legacyRefundCallbackCannotClaimThroughNewAPI() public {
        _create();
        CrowdfundingActor claimant = new CrowdfundingActor(target);
        claimant.contribute{value: 2 ether}(1);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.refundTo, (1, payable(bob)));
        claimant.configure(1, calls, false);
        vm.warp(block.timestamp + DURATION);
        claimant.refund(1);
        assertEq(claimant.observedContribution(), 0);
        assertEq(claimant.callbackResults(0), abi.encodeWithSelector(Crowdfunding.NothingToRefund.selector));
        assertEq(claimant.received(), 2 ether);
        assertEq(bob.balance, 100 ether);
    }

    function test_differentRecipientGetsNoClaimantAuthority() public {
        _create();
        CrowdfundingActor recipient = new CrowdfundingActor(target);
        _contribute(1, alice, GOAL);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(target.withdrawTo, (1, payable(bob)));
        calls[1] = abi.encodeCall(target.withdraw, (1));
        recipient.configure(1, calls, false);
        vm.warp(block.timestamp + DURATION);
        vm.prank(owner);
        target.withdrawTo(1, payable(address(recipient)));
        assertTrue(recipient.observedWithdrawn());
        assertEq(recipient.callbackResults(0), abi.encodeWithSelector(Crowdfunding.NotOwner.selector));
        assertEq(recipient.callbackResults(1), abi.encodeWithSelector(Crowdfunding.NotOwner.selector));
        assertEq(recipient.received(), GOAL);
        assertEq(owner.balance, 0);
        assertEq(bob.balance, 100 ether);
    }

    function test_redirectedRecipientCannotRefundClaimantsClearedBalance() public {
        _create();
        CrowdfundingActor recipient = new CrowdfundingActor(target);
        _contribute(1, alice, 2 ether);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(target.refund, (1));
        calls[1] = abi.encodeCall(target.refundTo, (1, payable(bob)));
        recipient.configure(1, calls, false);
        vm.warp(block.timestamp + DURATION);
        vm.prank(alice);
        target.refundTo(1, payable(address(recipient)));
        assertEq(target.contributions(1, alice), 0);
        assertEq(recipient.callbackResults(0), abi.encodeWithSelector(Crowdfunding.NothingToRefund.selector));
        assertEq(recipient.callbackResults(1), abi.encodeWithSelector(Crowdfunding.NothingToRefund.selector));
        assertEq(recipient.received(), 2 ether);
    }

    function test_bubbledRedirectedCallbackFailureRollsBackBothEntitlements() public {
        _create();
        _create();
        CrowdfundingActor recipient = new CrowdfundingActor(target);
        _contribute(1, alice, 2 ether);
        recipient.contribute{value: 3 ether}(2);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(target.refundTo, (2, payable(bob)));
        calls[1] = abi.encodeCall(target.refundTo, (1, payable(bob)));
        recipient.configure(1, calls, true);
        vm.warp(block.timestamp + DURATION);
        vm.prank(alice);
        vm.expectRevert(Crowdfunding.RefundFailed.selector);
        target.refundTo(1, payable(address(recipient)));
        assertEq(target.contributions(1, alice), 2 ether);
        assertEq(target.contributions(2, address(recipient)), 3 ether);
        assertEq(_raised(1), 2 ether);
        assertEq(_raised(2), 3 ether);
        assertEq(address(target).balance, 5 ether);
        assertEq(bob.balance, 100 ether);
        assertEq(recipient.received(), 0);
    }

    function test_redirectedRecipientCanSettleItsOwnOtherEntitlement() public {
        _create();
        _create();
        CrowdfundingActor recipient = new CrowdfundingActor(target);
        _contribute(1, alice, 2 ether);
        recipient.contribute{value: 3 ether}(2);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(target.refundTo, (2, payable(bob)));
        recipient.configure(1, calls, false);
        vm.warp(block.timestamp + DURATION);
        vm.prank(alice);
        target.refundTo(1, payable(address(recipient)));
        assertTrue(recipient.callbackSucceeded(0));
        assertEq(target.contributions(1, alice), 0);
        assertEq(target.contributions(2, address(recipient)), 0);
        assertEq(recipient.received(), 2 ether);
        assertEq(bob.balance, 103 ether);
        assertEq(address(target).balance, 0);
    }
}
