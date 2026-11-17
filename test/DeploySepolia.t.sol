// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DeploySepolia} from "../script/DeploySepolia.s.sol";
import {Crowdfunding} from "../src/Crowdfunding.sol";

contract DeploySepoliaTest is Test {
    DeploySepolia internal deployScript;
    address internal constant DEPLOYER = address(0x1111);

    function setUp() public {
        deployScript = new DeploySepolia();
    }

    function test_wrongChainRejectsBeforeCreating() public {
        vm.chainId(1);
        uint64 nonce = vm.getNonce(DEPLOYER);
        vm.expectRevert(abi.encodeWithSelector(DeploySepolia.WrongChain.selector, 1));
        deployScript.run(DEPLOYER);
        assertEq(vm.getNonce(DEPLOYER), nonce);
    }

    function test_zeroSenderRejectsWithoutCreating() public {
        vm.chainId(11155111);
        vm.expectRevert(DeploySepolia.InvalidDeployer.selector);
        deployScript.run(address(0));
    }

    function test_sepoliaSimulationCreatesExactRuntimeWithEmptyState() public {
        vm.chainId(11155111);
        vm.deal(DEPLOYER, 1 ether);
        uint64 nonce = vm.getNonce(DEPLOYER);
        Crowdfunding deployed = deployScript.run(DEPLOYER);
        assertEq(address(deployed).code, type(Crowdfunding).runtimeCode);
        assertEq(deployed.campaignCount(), 0);
        assertEq(address(deployed).balance, 0);
        assertEq(DEPLOYER.balance, 1 ether);
        assertEq(vm.getNonce(DEPLOYER), nonce + 1);
    }

    function testFuzz_nonSepoliaChainsCannotCreate(uint64 chainId) public {
        vm.assume(chainId != 11155111);
        vm.chainId(chainId);
        vm.expectRevert(abi.encodeWithSelector(DeploySepolia.WrongChain.selector, uint256(chainId)));
        deployScript.run(DEPLOYER);
    }
}
