// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {Crowdfunding} from "../src/Crowdfunding.sol";

// ==========================================
// Helper Contract 1: Rejecting Owner
// ==========================================

contract RejectingOwner {
    Crowdfunding public crowdfunding;

    constructor(Crowdfunding _crowdfunding) {
        crowdfunding = _crowdfunding;
    }

    function createCampaign(uint256 goal, uint256 duration) external {
        crowdfunding.createCampaign(goal, duration);
    }

    function withdraw(uint256 campaignId) external {
        crowdfunding.withdraw(campaignId);
    }

    receive() external payable {
        revert("ETH rejected");
    }
}

// ==========================================
// Helper Contract 2: Rejecting Contributor
// ==========================================

contract RejectingContributor {
    Crowdfunding public crowdfunding;

    constructor(Crowdfunding _crowdfunding) {
        crowdfunding = _crowdfunding;
    }

    function contribute(uint256 campaignId) external payable {
        crowdfunding.contribute{value: msg.value}(campaignId);
    }

    function refund(uint256 campaignId) external {
        crowdfunding.refund(campaignId);
    }

    receive() external payable {
        revert("Refund rejected");
    }
}

// ==========================================
// Main Test Contract
// ==========================================

contract CrowdfundingTest is Test {
    // ==========================================
    // 1. Test Variables
    // ==========================================

    Crowdfunding crowdfunding;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant GOAL = 10 ether;
    uint256 constant DURATION = 7 days;

    // ==========================================
    // 2. Setup
    // ==========================================

    function setUp() public {
        crowdfunding = new Crowdfunding();

        vm.deal(owner, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ==========================================
    // 3. Create Campaign Tests
    // ==========================================

    function test_createCampaign() public {
        vm.prank(owner);
        crowdfunding.createCampaign(GOAL, DURATION);

        assertEq(crowdfunding.campaignCount(), 1);

        (address campaignOwner, uint256 goal, uint256 amountRaised, uint256 deadline, bool withdrawn) =
            crowdfunding.campaigns(1);

        assertEq(campaignOwner, owner);
        assertEq(goal, GOAL);
        assertEq(amountRaised, 0);
        assertEq(deadline, block.timestamp + DURATION);
        assertFalse(withdrawn);
    }

    function test_createCampaign_invalidGoal() public {
        vm.expectRevert(Crowdfunding.InvalidGoal.selector);

        crowdfunding.createCampaign(0, DURATION);
    }

    function test_createCampaign_invalidDuration() public {
        vm.expectRevert(Crowdfunding.InvalidDuration.selector);

        crowdfunding.createCampaign(GOAL, 0);
    }

    function test_createMultipleCampaigns() public {
        crowdfunding.createCampaign(GOAL, DURATION);
        crowdfunding.createCampaign(5 ether, 3 days);

        assertEq(crowdfunding.campaignCount(), 2);
    }

    // ==========================================
    // 4. Contribute Tests
    // ==========================================

    function test_contribute() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: 3 ether}(1);

        assertEq(crowdfunding.contributions(1, alice), 3 ether);

        (,, uint256 amountRaised,,) = crowdfunding.campaigns(1);

        assertEq(amountRaised, 3 ether);

        assertEq(address(crowdfunding).balance, 3 ether);
    }

    function test_multipleContributors() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: 3 ether}(1);

        vm.prank(bob);
        crowdfunding.contribute{value: 4 ether}(1);

        assertEq(crowdfunding.contributions(1, alice), 3 ether);

        assertEq(crowdfunding.contributions(1, bob), 4 ether);

        (,, uint256 amountRaised,,) = crowdfunding.campaigns(1);

        assertEq(amountRaised, 7 ether);
    }

    function test_contribute_invalidCampaign() public {
        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);

        crowdfunding.contribute{value: 1 ether}(99);
    }

    function test_contribute_zeroETH() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.expectRevert(Crowdfunding.MustSendETH.selector);

        crowdfunding.contribute(1);
    }

    function test_contribute_afterDeadline() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.warp(block.timestamp + DURATION);

        vm.expectRevert(Crowdfunding.CampaignEnded.selector);

        crowdfunding.contribute{value: 1 ether}(1);
    }

    // ==========================================
    // 5. Withdraw Tests
    // ==========================================

    function test_withdraw() public {
        vm.prank(owner);
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: GOAL}(1);

        vm.warp(block.timestamp + DURATION + 1);

        uint256 balanceBefore = owner.balance;

        vm.prank(owner);
        crowdfunding.withdraw(1);

        assertEq(owner.balance, balanceBefore + GOAL);

        assertEq(address(crowdfunding).balance, 0);

        (,,,, bool withdrawn) = crowdfunding.campaigns(1);

        assertTrue(withdrawn);
    }

    function test_withdraw_notOwner() public {
        vm.prank(owner);
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: GOAL}(1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(bob);

        vm.expectRevert(Crowdfunding.NotOwner.selector);

        crowdfunding.withdraw(1);
    }

    function test_withdraw_beforeDeadline() public {
        vm.prank(owner);
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: GOAL}(1);

        vm.prank(owner);

        vm.expectRevert(Crowdfunding.CampaignNotEnded.selector);

        crowdfunding.withdraw(1);
    }

    function test_withdraw_goalNotReached() public {
        vm.prank(owner);
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: 3 ether}(1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(owner);

        vm.expectRevert(Crowdfunding.GoalNotReached.selector);

        crowdfunding.withdraw(1);
    }

    function test_withdraw_twice() public {
        vm.prank(owner);
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: GOAL}(1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.startPrank(owner);

        crowdfunding.withdraw(1);

        vm.expectRevert(Crowdfunding.AlreadyWithdrawn.selector);

        crowdfunding.withdraw(1);

        vm.stopPrank();
    }

    // ==========================================
    // 6. Refund Tests
    // ==========================================

    function test_refund() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: 3 ether}(1);

        vm.warp(block.timestamp + DURATION + 1);

        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        crowdfunding.refund(1);

        assertEq(alice.balance, balanceBefore + 3 ether);

        assertEq(crowdfunding.contributions(1, alice), 0);

        (,, uint256 amountRaised,,) = crowdfunding.campaigns(1);

        assertEq(amountRaised, 0);
    }

    function test_refund_beforeDeadline() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: 3 ether}(1);

        vm.prank(alice);

        vm.expectRevert(Crowdfunding.CampaignNotEnded.selector);

        crowdfunding.refund(1);
    }

    function test_refund_goalReached() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: GOAL}(1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(alice);

        vm.expectRevert(Crowdfunding.GoalWasReached.selector);

        crowdfunding.refund(1);
    }

    function test_refund_noContribution() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(bob);

        vm.expectRevert(Crowdfunding.NothingToRefund.selector);

        crowdfunding.refund(1);
    }

    function test_refund_twice() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: 3 ether}(1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.startPrank(alice);

        crowdfunding.refund(1);

        vm.expectRevert(Crowdfunding.NothingToRefund.selector);

        crowdfunding.refund(1);

        vm.stopPrank();
    }

    function test_multipleRefunds() public {
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: 3 ether}(1);

        vm.prank(bob);
        crowdfunding.contribute{value: 2 ether}(1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(alice);
        crowdfunding.refund(1);

        vm.prank(bob);
        crowdfunding.refund(1);

        assertEq(crowdfunding.contributions(1, alice), 0);

        assertEq(crowdfunding.contributions(1, bob), 0);

        assertEq(address(crowdfunding).balance, 0);
    }

    // ==========================================
    // 7. Additional Coverage Tests
    // ==========================================

    function test_withdraw_invalidCampaign() public {
        vm.prank(owner);

        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);

        crowdfunding.withdraw(999);
    }

    function test_refund_invalidCampaign() public {
        vm.prank(alice);

        vm.expectRevert(Crowdfunding.CampaignDoesNotExist.selector);

        crowdfunding.refund(999);
    }

    function test_withdraw_transferFailed() public {
        RejectingOwner rejectingOwner = new RejectingOwner(crowdfunding);

        rejectingOwner.createCampaign(GOAL, DURATION);

        vm.prank(alice);
        crowdfunding.contribute{value: GOAL}(1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.expectRevert(Crowdfunding.TransferFailed.selector);

        rejectingOwner.withdraw(1);

        assertEq(address(crowdfunding).balance, GOAL);

        (,, uint256 amountRaised,, bool withdrawn) = crowdfunding.campaigns(1);

        assertEq(amountRaised, GOAL);
        assertFalse(withdrawn);
    }

    function test_refund_transferFailed() public {
        RejectingContributor rejectingContributor = new RejectingContributor(crowdfunding);

        vm.prank(owner);
        crowdfunding.createCampaign(GOAL, DURATION);

        vm.deal(address(rejectingContributor), 3 ether);

        rejectingContributor.contribute{value: 3 ether}(1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.expectRevert(Crowdfunding.RefundFailed.selector);

        rejectingContributor.refund(1);

        assertEq(crowdfunding.contributions(1, address(rejectingContributor)), 3 ether);

        assertEq(address(crowdfunding).balance, 3 ether);

        (,, uint256 amountRaised,,) = crowdfunding.campaigns(1);

        assertEq(amountRaised, 3 ether);
    }
}
