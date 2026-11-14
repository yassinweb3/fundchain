// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Crowdfunding} from "../../src/Crowdfunding.sol";

/// @dev Test-only recipient that can reject ETH or call back into the crowdfunding contract.
contract CrowdfundingActor {
    Crowdfunding public immutable crowdfunding;
    bool public rejecting;
    bool private entered;
    bool private bubbleFailure;
    uint256 private observedId;
    bytes[] private callbacks;
    bool[] public callbackSucceeded;
    bytes[] public callbackResults;
    uint256 public received;
    uint256 public receiveCount;
    bool public observedWithdrawn;
    uint256 public observedContribution;
    uint256 public observedRaised;

    constructor(Crowdfunding target) {
        crowdfunding = target;
    }

    function setRejecting(bool value) external {
        rejecting = value;
    }

    function configure(uint256 campaignId, bytes[] memory calls, bool propagateFailure) external {
        observedId = campaignId;
        bubbleFailure = propagateFailure;
        delete callbacks;
        delete callbackSucceeded;
        delete callbackResults;
        for (uint256 i; i < calls.length; ++i) {
            callbacks.push(calls[i]);
        }
    }

    function create(uint256 goal, uint256 duration) external {
        crowdfunding.createCampaign(goal, duration);
    }

    function contribute(uint256 campaignId) external payable {
        crowdfunding.contribute{value: msg.value}(campaignId);
    }

    function withdraw(uint256 campaignId) external {
        crowdfunding.withdraw(campaignId);
    }

    function refund(uint256 campaignId) external {
        crowdfunding.refund(campaignId);
    }

    function withdrawTo(uint256 campaignId, address payable recipient) external {
        crowdfunding.withdrawTo(campaignId, recipient);
    }

    function refundTo(uint256 campaignId, address payable recipient) external {
        crowdfunding.refundTo(campaignId, recipient);
    }

    receive() external payable {
        require(!rejecting, "test recipient rejects ETH");
        received += msg.value;
        receiveCount++;
        if (entered) return;
        entered = true;
        (,, observedRaised,, observedWithdrawn) = crowdfunding.campaigns(observedId);
        observedContribution = crowdfunding.contributions(observedId, address(this));
        for (uint256 i; i < callbacks.length; ++i) {
            (bool success, bytes memory result) = address(crowdfunding).call(callbacks[i]);
            callbackSucceeded.push(success);
            callbackResults.push(result);
            if (!success && bubbleFailure) {
                assembly ("memory-safe") {
                    revert(add(result, 32), mload(result))
                }
            }
        }
        entered = false;
    }
}

/// @dev Force surplus ETH without calling the recipient; creation and destruction share a transaction.
contract ForceCrowdfundingETH {
    constructor(address payable recipient) payable {
        selfdestruct(recipient);
    }
}
