// SPDX-License-Identifier: MIT

pragma solidity ^0.8.31;

contract Crowdfunding {
    // ==========================================
    // Custom Errors
    // ==========================================

    // The campaign does not exist
    error CampaignDoesNotExist();

    // The campaign has already ended
    error CampaignEnded();

    // The user must send some ETH
    error MustSendETH();

    // Only the campaign owner can do this
    error NotOwner();

    // The campaign did not reach the goal
    error GoalNotReached();

    // The money was already withdrawn
    error AlreadyWithdrawn();

    // Sending ETH to the owner failed
    error TransferFailed();

    // The campaign is still active
    error CampaignNotEnded();

    // The campaign reached the goal, so refund is not allowed
    error GoalWasReached();

    // The user has no money to refund
    error NothingToRefund();

    // Sending the refund failed
    error RefundFailed();

    // The goal cannot be zero
    error InvalidGoal();

    // The duration cannot be zero
    error InvalidDuration();

    // ==========================================
    // Events
    // ==========================================

    // This event is emitted when a new campaign is created
    event CampaignCreated(uint256 indexed campaignId, address indexed owner);

    // This event is emitted when someone contributes ETH
    event Contributed(uint256 indexed campaignId, address indexed contributor, uint256 amount);

    // This event is emitted when the owner withdraws the money
    event Withdrawn(uint256 indexed campaignId, address indexed owner, uint256 amount);

    // This event is emitted when a contributor gets a refund
    event Refunded(uint256 indexed campaignId, address indexed contributor, uint256 amount);

    // ==========================================
    // Campaign Struct
    // ==========================================

    // This struct stores the data of one campaign
    struct Campaign {
        address owner; // The campaign owner
        uint256 goal; // The target amount
        uint256 amountRaised; // The current amount in the campaign
        uint256 deadline; // The campaign end time
        bool withdrawn; // True if the owner withdrew the money
    }

    // ==========================================
    // Storage
    // ==========================================

    // Total number of campaigns
    // We also use it to create campaign IDs
    uint256 public campaignCount;
    // Campaign ID => Campaign data
    mapping(uint256 => Campaign) public campaigns;

    // Campaign ID => User address => Contribution amount
    mapping(uint256 => mapping(address => uint256)) public contributions;

    // ==========================================
    // 1. Create Campaign
    // ==========================================

    function createCampaign(uint256 _goal, uint256 _duration) external {
        // The goal must be greater than zero
        if (_goal == 0) {
            revert InvalidGoal();
        }

        // The duration must be greater than zero
        if (_duration == 0) {
            revert InvalidDuration();
        }

        // Create a new campaign ID
        campaignCount += 1;

        // Save the new campaign
        campaigns[campaignCount] = Campaign({
            owner: msg.sender, goal: _goal, amountRaised: 0, deadline: block.timestamp + _duration, withdrawn: false
        });

        // Record that a new campaign was created
        emit CampaignCreated(campaignCount, msg.sender);
    }

    // ==========================================
    // 2. Contribute ETH
    // ==========================================

    function contribute(uint256 _campaignId) external payable {
        // Check if the campaign exists
        if (_campaignId == 0 || _campaignId > campaignCount) {
            revert CampaignDoesNotExist();
        }

        // Get the campaign from storage
        // "storage" means we work with the original data
        Campaign storage campaign = campaigns[_campaignId];

        // Users cannot contribute after the campaign ends
        if (block.timestamp >= campaign.deadline) {
            revert CampaignEnded();
        }

        // The user must send more than 0 ETH
        if (msg.value == 0) {
            revert MustSendETH();
        }

        // Add the ETH to the campaign total
        campaign.amountRaised += msg.value;

        // Save how much this user contributed
        contributions[_campaignId][msg.sender] += msg.value;

        // Record the contribution
        emit Contributed(_campaignId, msg.sender, msg.value);
    }

    // ==========================================
    // 3. Withdraw Campaign Money
    // ==========================================

    function withdraw(uint256 _campaignId) external {
        // Check if the campaign exists
        if (_campaignId == 0 || _campaignId > campaignCount) {
            revert CampaignDoesNotExist();
        }

        // Get the campaign from storage
        Campaign storage campaign = campaigns[_campaignId];

        // Only the campaign owner can withdraw
        if (msg.sender != campaign.owner) {
            revert NotOwner();
        }

        // The campaign must be finished first
        if (block.timestamp < campaign.deadline) {
            revert CampaignNotEnded();
        }

        // The campaign must reach its goal
        if (campaign.amountRaised < campaign.goal) {
            revert GoalNotReached();
        }

        // The owner cannot withdraw twice
        if (campaign.withdrawn) {
            revert AlreadyWithdrawn();
        }

        // Save the amount before sending it
        uint256 amount = campaign.amountRaised;

        // ======================================
        // Effects
        // ======================================

        // Mark the campaign as withdrawn
        // We do this BEFORE sending ETH
        campaign.withdrawn = true;

        // Record the withdrawal
        // If the transaction reverts later,
        // this event will also be removed
        emit Withdrawn(_campaignId, campaign.owner, amount);

        // ======================================
        // Interaction
        // ======================================

        // Send the campaign money to the owner
        (bool success,) = payable(campaign.owner).call{value: amount}("");

        // Stop if the ETH transfer failed
        if (!success) {
            revert TransferFailed();
        }
    }

    // ==========================================
    // 4. Refund Contribution
    // ==========================================

    function refund(uint256 _campaignId) external {
        // Check if the campaign exists
        if (_campaignId == 0 || _campaignId > campaignCount) {
            revert CampaignDoesNotExist();
        }

        // Get the campaign from storage
        Campaign storage campaign = campaigns[_campaignId];

        // Refund is only available after the campaign ends
        if (block.timestamp < campaign.deadline) {
            revert CampaignNotEnded();
        }

        // Refund is only available if the goal was NOT reached
        if (campaign.amountRaised >= campaign.goal) {
            revert GoalWasReached();
        }

        // Get this user's contribution
        uint256 amount = contributions[_campaignId][msg.sender];

        // The user must have money to refund
        if (amount == 0) {
            revert NothingToRefund();
        }

        // ======================================
        // Effects
        // ======================================

        // Set the user's contribution to zero
        // This helps protect against reentrancy
        contributions[_campaignId][msg.sender] = 0;

        // Remove the refunded amount from the campaign total
        campaign.amountRaised -= amount;

        // Record the refund
        // If the transaction reverts later,
        // this event will also be removed
        emit Refunded(_campaignId, msg.sender, amount);

        // ======================================
        // Interaction
        // ======================================

        // Send the ETH back to the contributor
        (bool success,) = payable(msg.sender).call{value: amount}("");

        // Stop if the refund failed
        if (!success) {
            revert RefundFailed();
        }
    }
}
