// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console2} from "forge-std/console2.sol";
import {Crowdfunding} from "../../src/Crowdfunding.sol";
import {ForceCrowdfundingETH} from "../helpers/CrowdfundingActors.sol";

/// @dev Independent model; only successful, preconditioned transitions update ghost accounting.
/// Unexpected reverts/assertions propagate to the invariant runner (fail_on_revert=true).
contract CrowdfundingHandler is Test {
    struct Model {
        address owner;
        uint256 goal;
        uint256 deadline;
        uint256 deposits;
        uint256 refunded;
        uint256 paid;
        uint256 withdrawalCount;
    }

    Crowdfunding public immutable target;
    address[4] public actors;
    Model[] private models;
    mapping(uint256 => mapping(address => uint256)) public deposited;
    mapping(uint256 => mapping(address => uint256)) public returned;
    uint256 public totalDeposits;
    uint256 public totalRefunds;
    uint256 public totalPayouts;
    uint256 public forcedSurplus;
    uint256 public successfulCreates;
    uint256 public successfulContributions;
    uint256 public successfulWithdrawals;
    uint256 public successfulRefunds;
    uint256 public redirectedWithdrawals;
    uint256 public redirectedRefunds;
    uint256 public checkedRejections;
    uint256 public skippedActions;

    constructor(Crowdfunding contract_) {
        target = contract_;
        for (uint256 i; i < actors.length; ++i) {
            actors[i] = makeAddr(string.concat("invariant actor ", vm.toString(i)));
        }
    }

    function modelCount() external view returns (uint256) {
        return models.length;
    }

    function model(uint256 index) external view returns (Model memory) {
        return models[index];
    }

    function create(uint256 actorSeed, uint96 goalSeed, uint32 durationSeed) public {
        if (models.length == 12) {
            skippedActions++;
            return;
        }
        address owner = actors[actorSeed % actors.length];
        uint256 goal = bound(goalSeed, 1, 10 ether);
        uint256 duration = bound(durationSeed, 1, 3 days);
        vm.prank(owner);
        target.createCampaign(goal, duration);
        models.push(Model(owner, goal, block.timestamp + duration, 0, 0, 0, 0));
        successfulCreates++;
        assertEq(target.campaignCount(), models.length);
    }

    function contribute(uint256 campaignSeed, uint256 actorSeed, uint96 amountSeed) public {
        if (models.length == 0) {
            skippedActions++;
            return;
        }
        // Scan for a viable campaign rather than turning most calls into no-ops.
        for (uint256 i; i < models.length; ++i) {
            uint256 index = addmod(campaignSeed, i, models.length);
            Model storage m = models[index];
            if (block.timestamp >= m.deadline) continue;
            address donor = actors[actorSeed % actors.length];
            uint256 amount = bound(amountSeed, 1, 5 ether);
            vm.deal(donor, donor.balance + amount); // Never mint ETH directly into the target.
            uint256 beforeBalance = donor.balance;
            vm.prank(donor);
            target.contribute{value: amount}(index + 1);
            m.deposits += amount;
            deposited[index + 1][donor] += amount;
            totalDeposits += amount;
            successfulContributions++;
            assertEq(donor.balance, beforeBalance - amount);
            assertModel();
            return;
        }
        skippedActions++;
    }

    function advanceTime(uint32 secondsSeed) public {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 1 days));
        assertModel();
    }

    function withdraw(uint256 campaignSeed) public {
        _withdraw(campaignSeed, 0, false);
    }

    function withdrawTo(uint256 campaignSeed, uint256 recipientSeed) public {
        _withdraw(campaignSeed, recipientSeed, true);
    }

    function _withdraw(uint256 campaignSeed, uint256 recipientSeed, bool redirect) private {
        for (uint256 i; i < models.length; ++i) {
            uint256 index = addmod(campaignSeed, i, models.length);
            Model storage m = models[index];
            if (block.timestamp < m.deadline || m.deposits < m.goal || m.withdrawalCount != 0) continue;
            address recipient = redirect ? actors[recipientSeed % actors.length] : m.owner;
            uint256 beforeBalance = recipient.balance;
            uint256 ownerBefore = m.owner.balance;
            vm.prank(m.owner);
            if (redirect) target.withdrawTo(index + 1, payable(recipient));
            else target.withdraw(index + 1);
            m.paid = m.deposits;
            m.withdrawalCount++;
            totalPayouts += m.paid;
            successfulWithdrawals++;
            if (redirect) redirectedWithdrawals++;
            assertEq(recipient.balance, beforeBalance + m.paid);
            if (recipient != m.owner) assertEq(m.owner.balance, ownerBefore);
            assertModel();
            return;
        }
        skippedActions++;
    }

    function refund(uint256 campaignSeed, uint256 actorSeed) public {
        _refund(campaignSeed, actorSeed, 0, false);
    }

    function refundTo(uint256 campaignSeed, uint256 actorSeed, uint256 recipientSeed) public {
        _refund(campaignSeed, actorSeed, recipientSeed, true);
    }

    function _refund(uint256 campaignSeed, uint256 actorSeed, uint256 recipientSeed, bool redirect) private {
        for (uint256 i; i < models.length; ++i) {
            uint256 index = addmod(campaignSeed, i, models.length);
            Model storage m = models[index];
            if (block.timestamp < m.deadline || m.deposits >= m.goal) continue;
            for (uint256 j; j < actors.length; ++j) {
                address donor = actors[addmod(actorSeed, j, actors.length)];
                uint256 amount = deposited[index + 1][donor] - returned[index + 1][donor];
                if (amount == 0) continue;
                address recipient = redirect ? actors[recipientSeed % actors.length] : donor;
                uint256 beforeBalance = recipient.balance;
                uint256 donorBefore = donor.balance;
                vm.prank(donor);
                if (redirect) target.refundTo(index + 1, payable(recipient));
                else target.refund(index + 1);
                returned[index + 1][donor] += amount;
                m.refunded += amount;
                totalRefunds += amount;
                successfulRefunds++;
                if (redirect) redirectedRefunds++;
                assertEq(recipient.balance, beforeBalance + amount);
                if (recipient != donor) assertEq(donor.balance, donorBefore);
                assertModel();
                return;
            }
        }
        skippedActions++;
    }

    function forceSurplus(uint96 amountSeed) public {
        uint256 amount = bound(amountSeed, 1, 1 ether);
        vm.deal(address(this), amount);
        new ForceCrowdfundingETH{value: amount}(payable(address(target)));
        forcedSurplus += amount;
        assertModel();
    }

    function probeRejectedTransitions(uint256 campaignSeed, uint256 actorSeed) public {
        if (models.length == 0) return;
        uint256 index = campaignSeed % models.length;
        Model memory m = models[index];
        address outsider = actors[actorSeed % actors.length];
        if (outsider == m.owner) outsider = actors[addmod(actorSeed, 1, actors.length)];
        uint256 beforeBalance = address(target).balance;
        _reject(outsider, abi.encodeCall(target.withdraw, (index + 1)), Crowdfunding.NotOwner.selector);
        _reject(
            outsider, abi.encodeCall(target.withdrawTo, (index + 1, payable(outsider))), Crowdfunding.NotOwner.selector
        );
        if (block.timestamp < m.deadline) {
            _reject(m.owner, abi.encodeCall(target.withdraw, (index + 1)), Crowdfunding.CampaignNotEnded.selector);
            _reject(outsider, abi.encodeCall(target.refund, (index + 1)), Crowdfunding.CampaignNotEnded.selector);
            _reject(
                m.owner,
                abi.encodeCall(target.withdrawTo, (index + 1, payable(outsider))),
                Crowdfunding.CampaignNotEnded.selector
            );
            _reject(
                outsider,
                abi.encodeCall(target.refundTo, (index + 1, payable(m.owner))),
                Crowdfunding.CampaignNotEnded.selector
            );
        } else {
            vm.deal(outsider, outsider.balance + 1);
            vm.prank(outsider);
            (bool success, bytes memory result) =
                address(target).call{value: 1}(abi.encodeCall(target.contribute, (index + 1)));
            assertFalse(success);
            assertEq(result, abi.encodeWithSelector(Crowdfunding.CampaignEnded.selector));
            checkedRejections++;
            if (m.withdrawalCount != 0) {
                _reject(m.owner, abi.encodeCall(target.withdraw, (index + 1)), Crowdfunding.AlreadyWithdrawn.selector);
                _reject(
                    m.owner,
                    abi.encodeCall(target.withdrawTo, (index + 1, payable(outsider))),
                    Crowdfunding.AlreadyWithdrawn.selector
                );
            }
            if (m.deposits >= m.goal) {
                _reject(outsider, abi.encodeCall(target.refund, (index + 1)), Crowdfunding.GoalWasReached.selector);
                _reject(
                    outsider,
                    abi.encodeCall(target.refundTo, (index + 1, payable(m.owner))),
                    Crowdfunding.GoalWasReached.selector
                );
            } else if (deposited[index + 1][outsider] == returned[index + 1][outsider]) {
                _reject(outsider, abi.encodeCall(target.refund, (index + 1)), Crowdfunding.NothingToRefund.selector);
                _reject(
                    outsider,
                    abi.encodeCall(target.refundTo, (index + 1, payable(m.owner))),
                    Crowdfunding.NothingToRefund.selector
                );
            }
        }
        assertEq(address(target).balance, beforeBalance);
        assertModel();
    }

    function _reject(address sender, bytes memory callData, bytes4 expectedError) private {
        vm.prank(sender);
        (bool success, bytes memory result) = address(target).call(callData);
        assertFalse(success);
        assertEq(result, abi.encodeWithSelector(expectedError));
        checkedRejections++;
    }

    function assertModel() public view {
        assertEq(target.campaignCount(), models.length);
        for (uint256 i; i < models.length; ++i) {
            Model memory m = models[i];
            (address owner, uint256 goal, uint256 raised, uint256 deadline, bool withdrawn) = target.campaigns(i + 1);
            assertEq(owner, m.owner);
            assertEq(goal, m.goal);
            assertEq(deadline, m.deadline);
            assertEq(raised, m.deposits - m.refunded);
            assertEq(withdrawn, m.withdrawalCount == 1);
            assertLe(m.withdrawalCount, 1);
            assertLe(m.refunded, m.deposits);
            if (m.withdrawalCount != 0) {
                assertGe(block.timestamp, m.deadline);
                assertGe(m.deposits, m.goal);
                assertEq(m.paid, m.deposits);
                assertEq(m.refunded, 0);
            }
            if (m.refunded != 0) {
                assertGe(block.timestamp, m.deadline);
                assertLt(m.deposits, m.goal);
                assertEq(m.paid, 0);
            }
            uint256 contributionSum;
            for (uint256 j; j < actors.length; ++j) {
                uint256 contribution = deposited[i + 1][actors[j]] - returned[i + 1][actors[j]];
                assertEq(target.contributions(i + 1, actors[j]), contribution);
                contributionSum += contribution;
            }
            assertEq(contributionSum, raised);
        }
    }
}

contract CrowdfundingInvariantTest is StdInvariant, Test {
    Crowdfunding private target;
    CrowdfundingHandler private handler;

    function setUp() public {
        vm.warp(1_000_000);
        target = new Crowdfunding();
        handler = new CrowdfundingHandler(target);
        // Seed every transition type so reachability is checked before randomized sequences.
        handler.create(0, uint96(1 ether), 100);
        handler.create(1, uint96(10 ether), 100);
        handler.contribute(0, 2, uint96(2 ether));
        handler.contribute(1, 3, uint96(1 ether));
        handler.advanceTime(100);
        handler.withdraw(0);
        handler.refund(1, 3);
        handler.create(2, uint96(5 ether), uint32(3 days));
        handler.contribute(2, 0, uint96(1 ether));
        handler.create(0, uint96(1 ether), 100);
        handler.create(1, uint96(10 ether), 100);
        handler.contribute(3, 2, uint96(2 ether));
        handler.contribute(4, 3, uint96(1 ether));
        handler.advanceTime(100);
        handler.withdrawTo(3, 3);
        handler.refundTo(4, 3, 0);
        handler.probeRejectedTransitions(0, 3);
        handler.probeRejectedTransitions(2, 1);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = handler.create.selector;
        selectors[1] = handler.contribute.selector;
        selectors[2] = handler.advanceTime.selector;
        selectors[3] = handler.withdraw.selector;
        selectors[4] = handler.refund.selector;
        selectors[5] = handler.forceSurplus.selector;
        selectors[6] = handler.probeRejectedTransitions.selector;
        selectors[7] = handler.withdrawTo.selector;
        selectors[8] = handler.refundTo.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_campaignAccountingAndIsolation() public view {
        handler.assertModel();
    }

    function invariant_balanceCoversOutstandingLiabilities() public view {
        uint256 liabilities;
        for (uint256 i; i < handler.modelCount(); ++i) {
            CrowdfundingHandler.Model memory m = handler.model(i);
            liabilities += m.deposits - m.refunded - m.paid;
        }
        assertGe(address(target).balance, liabilities);
        assertEq(address(target).balance, liabilities + handler.forcedSurplus());
    }

    function invariant_ethConservation() public view {
        assertEq(
            handler.totalDeposits() + handler.forcedSurplus(),
            address(target).balance + handler.totalPayouts() + handler.totalRefunds()
        );
    }

    function invariant_settlementPathsAreReachable() public view {
        assertGe(handler.successfulCreates(), 3);
        assertGe(handler.successfulContributions(), 3);
        assertGe(handler.successfulWithdrawals(), 1);
        assertGe(handler.successfulRefunds(), 1);
        assertGt(handler.checkedRejections(), 0);
        assertGe(handler.redirectedWithdrawals(), 1);
        assertGe(handler.redirectedRefunds(), 1);
    }

    function afterInvariant() public view {
        // Report successful/ skipped calls alongside Forge's selector statistics.
        console2.log("successful creates", handler.successfulCreates());
        console2.log("successful contributions", handler.successfulContributions());
        console2.log("successful withdrawals", handler.successfulWithdrawals());
        console2.log("successful refunds", handler.successfulRefunds());
        console2.log("redirected withdrawals", handler.redirectedWithdrawals());
        console2.log("redirected refunds", handler.redirectedRefunds());
        console2.log("checked rejected transitions", handler.checkedRejections());
        console2.log("skipped actions", handler.skippedActions());
    }
}
