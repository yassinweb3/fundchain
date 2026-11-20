"""Preparation only: never signs, loads a keystore, or submits transactions."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CHAIN_ID = 11155111
FORGE = shutil.which("forge") or str(Path.home() / ".foundry/bin/forge")
CAST = shutil.which("cast") or str(Path.home() / ".foundry/bin/cast")


def command(args, label, env=None):
    result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True, timeout=180)
    if result.returncode:
        # Tool errors may contain credential-bearing URLs; do not echo them.
        raise ValueError(label + " failed; inspect locally without sharing credentials")
    return result.stdout.strip()


def rpc(url, method, params):
    if urlparse(url).scheme != "https" or not urlparse(url).hostname:
        raise ValueError("RPC URLs must use HTTPS")
    request = Request(url, data=json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params
    }).encode(), headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except Exception:
        raise ValueError("RPC request failed: " + method) from None
    if not isinstance(payload, dict) or payload.get("error") or "result" not in payload:
        raise ValueError("RPC rejected request: " + method)
    return payload["result"]


def check_networks(primary, secondary):
    if primary == secondary:
        raise ValueError("Use two independent RPC providers")
    for endpoint in (primary, secondary):
        if int(rpc(endpoint, "eth_chainId", []), 16) != CHAIN_ID:
            raise ValueError("Wrong RPC chain; Sepolia is required")
    block = rpc(primary, "eth_getBlockByNumber", ["finalized", False])
    if not isinstance(block, dict) or not block.get("hash") or not block.get("number"):
        raise ValueError("Primary RPC has no finalized block")
    other = rpc(secondary, "eth_getBlockByNumber", [block["number"], False])
    if not isinstance(other, dict) or other.get("hash") != block["hash"]:
        raise ValueError("RPC providers disagree on finalized block")
    return block


def artifact_check():
    version = command([FORGE, "--version"], "Foundry version")
    if not re.search(r"Version: 1\.8\.1(?:\s|$)", version):
        raise ValueError("Foundry 1.8.1 is required")
    config = json.loads(command([FORGE, "config", "--json"], "Foundry configuration"))
    if (config.get("solc") != "0.8.36" or config.get("evm_version") != "osaka"
            or config.get("optimizer") is not False or config.get("via_ir") is not False):
        raise ValueError("Pinned compiler settings differ")
    command([FORGE, "build", "--offline"], "Offline Solidity build")
    artifact = json.loads((ROOT / "out/Crowdfunding.sol/Crowdfunding.json").read_text())
    metadata = artifact["metadata"]
    if (metadata["compiler"]["version"].split("+")[0] != "0.8.36"
            or metadata["settings"]["evmVersion"] != "osaka"
            or metadata["settings"]["optimizer"]["enabled"]
            or metadata["settings"].get("viaIR", False)):
        raise ValueError("Artifact compiler settings differ")
    runtime = artifact["deployedBytecode"]["object"]
    runtime_hash = command([CAST, "keccak", runtime], "Runtime hash")
    frontend = (ROOT / "frontend/src/contract.generated.ts").read_text()
    match = re.search(r'EXPECTED_RUNTIME_HASH = "(0x[0-9a-f]{64})"', frontend)
    if not match or match[1] != runtime_hash:
        raise ValueError("Frontend runtime hash differs from compiled contract")
    artifact["_creationHash"] = command([CAST, "keccak", artifact["bytecode"]["object"]], "Creation hash")
    return artifact, runtime_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["offline", "rpc", "simulate"], default="offline")
    parser.add_argument("--address", help="Optional deployed address to verify read-only")
    args = parser.parse_args()
    if args.address and args.mode != "rpc":
        raise ValueError("Address verification requires RPC mode")
    artifact, runtime_hash = artifact_check()
    summary = {"mode": args.mode, "chainId": CHAIN_ID, "runtimeHash": runtime_hash,
               "creationBytecodeHash": artifact.get("_creationHash"),
               "signing": False, "broadcast": False}
    if args.mode != "offline":
        primary = os.environ.get("SEPOLIA_RPC_URL", "")
        secondary = os.environ.get("SEPOLIA_SECONDARY_RPC_URL", "")
        block = check_networks(primary, secondary)
        summary["finalizedBlock"] = block["number"]
        if args.address:
            if not re.fullmatch(r"0x[0-9a-fA-F]{40}", args.address):
                raise ValueError("Invalid deployment address")
            for endpoint in (primary, secondary):
                code = rpc(endpoint, "eth_getCode", [args.address, block["number"]])
                if not isinstance(code, str) or code.lower() != artifact["deployedBytecode"]["object"].lower():
                    raise ValueError("Deployed bytecode mismatch at finalized block")
            summary["verifiedAddress"] = args.address
            print(json.dumps(summary, indent=2))
            return
        sender = os.environ.get("DEPLOYER_ADDRESS", "")
        if not re.fullmatch(r"0x[0-9a-fA-F]{40}", sender) or int(sender, 16) == 0:
            raise ValueError("DEPLOYER_ADDRESS must be a nonzero public address")
        gas = int(rpc(primary, "eth_estimateGas", [{
            "from": sender, "data": artifact["bytecode"]["object"], "value": "0x0"
        }]), 16)
        balance = int(rpc(primary, "eth_getBalance", [sender, "latest"]), 16)
        gas_price = int(rpc(primary, "eth_gasPrice", []), 16)
        summary.update({"finalizedBlock": block["number"], "sender": sender,
                        "estimatedGas": gas, "gasPriceWei": gas_price,
                        "estimatedFeeWei": gas * gas_price, "balanceWei": balance,
                        "nonce": int(rpc(primary, "eth_getTransactionCount", [sender, "pending"]), 16)})
        if balance < gas * gas_price:
            raise ValueError("Insufficient test ETH for the current estimated deployment fee")
        if args.mode == "simulate":
            # Do not inherit wallet/password/key or RPC/chain override variables.
            env = {key: os.environ[key] for key in (
                "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "LANG", "LC_ALL"
            ) if key in os.environ}
            env["SEPOLIA_RPC_URL"] = primary
            output = command([FORGE, "script", "script/DeploySepolia.s.sol:DeploySepolia",
                     "--rpc-url", "fundchain_sepolia", "--offline", "--sender", sender,
                     "--sig", "run(address)", sender], "Unsigned RPC simulation", env)
            reported_chain = re.search(r"Chain\s+(\d+)\b", output)
            if not reported_chain or int(reported_chain[1]) != CHAIN_ID:
                raise ValueError("Unsigned simulation did not confirm Sepolia; no local fallback is allowed")
            reported_gas = re.search(r"Estimated total gas used for script:\s*(\d+)", output)
            if not reported_gas:
                raise ValueError("Unsigned simulation gas estimate is unavailable")
            summary["simulationGasEstimate"] = int(reported_gas[1])
            summary["rpcGasEstimateExceedsSimulation"] = gas > int(reported_gas[1])
            summary["simulation"] = "passed (no signing or submission)"
            if summary["rpcGasEstimateExceedsSimulation"]:
                summary["gasBudgetNote"] = "Use current RPC gas estimates; the pinned simulator underestimates network gas."
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.TimeoutExpired, KeyError, TypeError) as error:
        # Avoid traceback details that could reveal RPC credentials.
        print("Preflight stopped: " + (str(error) if isinstance(error, ValueError)
                                     else type(error).__name__), file=sys.stderr)
        sys.exit(1)
