import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("preflight", Path(__file__).parents[1] / "sepolia_preflight.py")
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)
PRIMARY = "https://primary.invalid/token"
SECONDARY = "https://secondary.invalid/token"
SENDER = "0x" + "1" * 40


class PreflightTest(unittest.TestCase):
    def test_http_rpc_is_rejected_without_network_access(self):
        with patch.object(preflight, "urlopen") as network:
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                preflight.rpc("http://example.invalid", "eth_chainId", [])
            network.assert_not_called()

    def test_network_errors_do_not_expose_url(self):
        with patch.object(preflight, "urlopen", side_effect=OSError(PRIMARY)):
            with self.assertRaisesRegex(ValueError, "^RPC request failed: eth_chainId$"):
                preflight.rpc(PRIMARY, "eth_chainId", [])

    def test_same_endpoint_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "independent"):
            preflight.check_networks(PRIMARY, PRIMARY)

    def test_wrong_chain_stops_preflight(self):
        with patch.object(preflight, "rpc", return_value="0x1") as rpc:
            with self.assertRaisesRegex(ValueError, "Wrong RPC chain"):
                preflight.check_networks(PRIMARY, SECONDARY)
            self.assertEqual(rpc.call_count, 1)

    def test_finalized_block_must_match(self):
        with patch.object(preflight, "rpc", side_effect=[
            hex(preflight.CHAIN_ID), hex(preflight.CHAIN_ID),
            {"number": "0x7", "hash": "0xabc"}, {"number": "0x7", "hash": "0xdef"}
        ]):
            with self.assertRaisesRegex(ValueError, "disagree"):
                preflight.check_networks(PRIMARY, SECONDARY)

    def test_matching_networks_pass(self):
        block = {"number": "0x7", "hash": "0xabc"}
        with patch.object(preflight, "rpc", side_effect=[
            hex(preflight.CHAIN_ID), hex(preflight.CHAIN_ID), block, block
        ]):
            self.assertEqual(preflight.check_networks(PRIMARY, SECONDARY), block)

    def test_wrong_foundry_version_is_rejected(self):
        with patch.object(preflight, "command", return_value="forge Version: 1.8.2"):
            with self.assertRaisesRegex(ValueError, "1.8.1"):
                preflight.artifact_check()

    def test_offline_mode_never_contacts_rpc(self):
        with patch.object(sys, "argv", ["preflight"]), patch.object(
            preflight, "artifact_check", return_value=({}, "0xhash")
        ), patch.object(preflight, "rpc") as rpc, contextlib.redirect_stdout(io.StringIO()) as out:
            preflight.main()
            rpc.assert_not_called()
            self.assertIn('"broadcast": false', out.getvalue())

    def test_broadcast_passthrough_is_rejected_before_tools_run(self):
        with patch.object(sys, "argv", ["preflight", "--broadcast"]), patch.object(
            preflight, "artifact_check"
        ) as build, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                preflight.main()
            build.assert_not_called()

    def run_online(self, mode="rpc", address=None, code="0x6000", balance=1000,
                   simulation_output="Chain 11155111\nEstimated total gas used for script: 130"):
        artifact = {"bytecode": {"object": "0x6000"}, "deployedBytecode": {"object": "0x6000"}}
        methods = []
        def rpc(_url, method, _params):
            methods.append(method)
            return {"eth_estimateGas": "0x64", "eth_getBalance": hex(balance),
                    "eth_gasPrice": "0x2", "eth_getTransactionCount": "0x0",
                    "eth_getCode": code}[method]
        args = ["preflight", "--mode", mode] + (["--address", address] if address else [])
        with patch.object(sys, "argv", args), patch.dict(preflight.os.environ, {
            "SEPOLIA_RPC_URL": PRIMARY, "SEPOLIA_SECONDARY_RPC_URL": SECONDARY,
            "DEPLOYER_ADDRESS": SENDER, "ETH_KEYSTORE": "unused", "ETH_PASSWORD": "unused",
            "ETH_RPC_URL": "http://127.0.0.1:8545", "FOUNDRY_ETH_RPC_URL": "http://127.0.0.1:8545"
        }), patch.object(preflight, "artifact_check", return_value=(artifact, "0xhash")), patch.object(
            preflight, "check_networks", return_value={"number": "0x7"}
        ), patch.object(preflight, "rpc", side_effect=rpc), patch.object(
            preflight, "command", return_value=simulation_output
        ) as command, contextlib.redirect_stdout(io.StringIO()):
            preflight.main()
            return command.call_args_list, methods

    def test_simulation_has_no_signing_or_submission_flags(self):
        calls, methods = self.run_online(mode="simulate")
        argv = calls[0].args[0]
        for forbidden in ["--broadcast", "--account", "--private-key", "--unlocked", "--resume"]:
            self.assertNotIn(forbidden, argv)
        self.assertEqual(argv[argv.index("--rpc-url") + 1], "fundchain_sepolia")
        self.assertEqual(calls[0].args[2]["SEPOLIA_RPC_URL"], PRIMARY)
        self.assertNotIn(PRIMARY, argv)
        self.assertNotIn("ETH_RPC_URL", calls[0].args[2])
        self.assertNotIn("FOUNDRY_ETH_RPC_URL", calls[0].args[2])
        self.assertNotIn("--chain", argv)
        self.assertNotIn("ETH_KEYSTORE", calls[0].args[2])
        self.assertNotIn("ETH_PASSWORD", calls[0].args[2])
        self.assertFalse(any("send" in method.lower() for method in methods))

    def test_simulation_must_report_sepolia_not_anvil(self):
        with self.assertRaisesRegex(ValueError, "did not confirm Sepolia"):
            self.run_online(mode="simulate", simulation_output="Chain 31337")

    def test_simulation_must_report_gas_before_success(self):
        with self.assertRaisesRegex(ValueError, "gas estimate is unavailable"):
            self.run_online(mode="simulate", simulation_output="Chain 11155111")

    def test_network_gas_mismatch_is_reported_for_budgeting(self):
        with patch("builtins.print") as output:
            self.run_online(mode="simulate", simulation_output="Chain 11155111\nEstimated total gas used for script: 1")
            summary = json.loads(output.call_args.args[0])
            self.assertTrue(summary["rpcGasEstimateExceedsSimulation"])
            self.assertEqual(summary["estimatedGas"], 100)
            self.assertIn("RPC gas estimates", summary["gasBudgetNote"])

    def test_insufficient_balance_stops(self):
        with self.assertRaisesRegex(ValueError, "Insufficient"):
            self.run_online(balance=0)

    def test_identity_verification_needs_no_sender_balance_or_signing(self):
        calls, methods = self.run_online(address=SENDER, balance=0)
        self.assertEqual(calls, [])
        self.assertEqual(methods, ["eth_getCode", "eth_getCode"])

    def test_runtime_mismatch_stops(self):
        with self.assertRaisesRegex(ValueError, "bytecode mismatch"):
            self.run_online(address=SENDER, code="0x6001")


if __name__ == "__main__":
    unittest.main()
