// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script} from "forge-std/Script.sol";
import {Crowdfunding} from "../src/Crowdfunding.sol";

/// @notice Simulates by default. Signing and network submission are CLI decisions.
contract DeploySepolia is Script {
    uint256 public constant SEPOLIA_CHAIN_ID = 11155111;
    error WrongChain(uint256 actual);
    error InvalidDeployer();

    function run(address deployer) external returns (Crowdfunding deployed) {
        if (block.chainid != SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);
        if (deployer == address(0)) revert InvalidDeployer();

        // The public sender address supplies no key or signing authority.
        vm.startBroadcast(deployer);
        deployed = new Crowdfunding();
        vm.stopBroadcast();
    }
}
