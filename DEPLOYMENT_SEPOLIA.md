# FundChain Sepolia deployment runbook

Status: preparation only. No public deployment, wallet setup, signature, or testnet
transaction has been performed by this change. All public-chain actions need
separate explicit approval. Never run the Anvil README's unlocked-wallet example
against a public RPC.

## Reproducible baseline

- Use WSL Ubuntu from the repository root; put Foundry on PATH in that shell.
- Foundry 1.8.1, Solc 0.8.36, EVM Osaka, optimizer off, via-IR off.
- Frontend uses Node 24.15.0 / npm 11.12.1 (Windows is supported).
- Sepolia chain ID: 11155111 (hex 0xaa36a7).
- No constructor arguments, initial ETH, admin role, proxy, or upgrade mechanism.
- Keep source paths and Solidity LF endings unchanged: metadata is part of the
  runtime identity. Never change compiler settings to make verification pass.
- Baseline must pass formatting, security/fuzz/invariant tests, frontend tests,
  ABI check, lint, build, bundle budgets, and the existing expiring audit policy.
- Exclude the five known metadata-only test modifications from any future commit.

The script takes a PUBLIC address in run(address), not a key. It checks chain ID
before creating anything, rejects the zero sender, and simulates one CREATE with
zero value. vm.startBroadcast(address) records an intended transaction during
simulation; it supplies no key and does not itself submit a network transaction.
Only a separately authorized CLI invocation can sign/broadcast.

## Secret and test-wallet preparation (future user-operated step)

Use fresh test-only accounts: deployer, owner, at least two contributors, and a
recipient. Do not reuse Anvil keys, a production seed, or accounts holding assets.
Obtain faucet ETH; do not buy test ETH or bridge mainnet assets for this exercise.

Store the deployer's encrypted Foundry keystore under ~/.foundry/keystores in WSL,
outside /mnt/c and the repository. Use restrictive Linux permissions (directory
0700, keyfile 0600), a strong password entered through the hidden local prompt,
and an offline backup. The account alias used below is fundchain-sepolia.
Create/import it personally through the interactive Foundry wallet flow only
after approval; do not give the agent a key, seed, password, or keystore contents.
No import or signing command is run during preparation.

Future signing uses --account fundchain-sepolia and the hidden password prompt.
Never use --private-key, --unsafe-password, --unlocked, password files in the repo,
or shared logs containing credentials. Confirm the keystore's PUBLIC address
matches DEPLOYER_ADDRESS before any signing. Protect MetaMask test wallets with
the same separation; approve all prompts personally.

Keep RPC URLs and explorer credentials in an owner-only local file outside the
repository. Load them privately in WSL without shell tracing or printing values:

- SEPOLIA_RPC_URL: primary HTTPS Sepolia RPC
- SEPOLIA_SECONDARY_RPC_URL: a genuinely independent provider/operator
- DEPLOYER_ADDRESS: public test-only sender address
- ETHERSCAN_API_KEY: explorer verification credential, never a VITE variable

Do not commit .env files, keys, screenshots of wallet recovery data, or unredacted
provider URLs. Foundry broadcast/cache artifacts are already ignored; keep them
private because they may contain RPC URLs. Share only sanitized public manifests.

## Offline preparation (safe now; no RPC, keystore, signing, or network writes)

From the root in WSL, with pinned Foundry binaries on PATH:

    python3 -B -m unittest discover -s tools/tests -v
    python3 -B tools/sepolia_preflight.py --mode offline
    env -u ETH_RPC_URL -u FOUNDRY_ETH_RPC_URL -u FOUNDRY_FORK_URL forge script script/DeploySepolia.s.sol:DeploySepolia --chain 11155111 --offline --sig "run(address)" 0x1111111111111111111111111111111111111111

The dummy address is public simulation data, not a funded account. The chain flag
sets the local simulation's chain ID; it does NOT choose or verify a remote RPC.
Offline mode builds using cached pinned compiler/dependencies and compares the
compiled runtime hash to frontend/src/contract.generated.ts. It fails if tools,
compiler settings, or identity differ. Missing cached tools/compiler are blockers;
nothing is installed automatically.

These commands execute only inside the local Forge VM. The simulated contract is
not deployed to Anvil, Sepolia, or any persistent blockchain.

## RPC preflight and unsigned simulation (only after separate approval)

    python3 -B tools/sepolia_preflight.py --mode rpc
    python3 -B tools/sepolia_preflight.py --mode simulate

The helper permits no arbitrary CLI passthrough, wallet argument, or broadcast
mode. It checks both chain IDs and the hash of the SAME finalized block across
both endpoints; then estimates creation gas, checks estimated fee affordability,
and reports the public sender, pending nonce, balance, gas price, and runtime
hash. The estimate has no signing authority and is not a guaranteed fee ceiling.
The simulation mode uses ETH_RPC_URL in the child environment, not a credential
URL in command arguments. Error details are suppressed to avoid credential leaks.
Neither mode sends eth_sendTransaction or eth_sendRawTransaction.

Confirm independent providers manually; distinct URLs alone do not prove operator
independence. Check current block freshness and wallet network before proceeding.
Stop on disagreement, unavailable RPC, low balance, identity mismatch, or changed
nonce. Re-run the preflight immediately before any authorized signing.

## Future deployment approval and signing procedure

Before broadcasting, present the exact source commit, public sender, chain/RPC
identity, nonce, creation bytecode hash, expected runtime hash, estimated gas,
gas limit, max fee per gas, priority fee, maximum total fee, and zero ETH value.
Approve the concrete transaction and ceiling, not just the tool installation.
The encrypted account must match the sender. Do not run with a mismatched chain
override, alternate compiler settings, skipped simulation, or unlocked node.

The unsigned keystore-based command skeleton is:

    ETH_RPC_URL="$SEPOLIA_RPC_URL" forge script script/DeploySepolia.s.sol:DeploySepolia --sig "run(address)" "$DEPLOYER_ADDRESS" --sender "$DEPLOYER_ADDRESS" --account fundchain-sepolia

Do NOT execute this during preparation: it may request a local wallet password.
Only after explicit on-chain approval may an operator add --broadcast and the
reviewed fee-ceiling flags supported by Foundry 1.8.1. Adding --verify requests
explorer source verification using the locally supplied ETHERSCAN_API_KEY.
CI never runs this keystore command and never receives wallet or RPC secrets.

Plan approximately 20-30 test transactions and re-estimate each operation.
The original 5-million-gas planning allowance is obsolete on current Sepolia:
earlier provider estimates were about 7.06 million gas for deployment alone.
These historical observations are not a current fee quote. Use a reviewed gas limit multiplied by a max fee per gas as
the maximum cost, rather than the old local simulation estimate. A provisional
0.1 test ETH across accounts is sufficient only if current estimates fit it.
Use small deposits; stop instead of increasing an approved cap.

## Receipt, source verification, and exact bytecode identity

After an approved deployment, first reconcile receipt status, destination address,
sender, nonce, chain, and actual fees. Wait for finality before recording the
deployment as accepted. Source verification is separate from successful mining:

    forge verify-contract --chain sepolia --watch "$CONTRACT_ADDRESS" src/Crowdfunding.sol:Crowdfunding

Use the pinned project settings and ETHERSCAN_API_KEY from the private environment.
No constructor args are needed. A verification timeout is NOT a reason to deploy
again. Retry verification of the existing address after diagnosing settings/API
errors; never change source or weaken identity checks.

Then verify full deployed runtime bytes, including metadata, through BOTH RPCs
at their agreed finalized block:

    python3 -B tools/sepolia_preflight.py --mode rpc --address "$CONTRACT_ADDRESS"

This fails if code is absent, different, or not yet included in the agreed
finalized block. Wait and retry on finality lag; do not strip metadata or accept
an explorer label as proof. The frontend's committed runtime hash must match.
Also check fresh state: campaignCount = 0 and balance = 0 before validation starts.

Record a sanitized public deployment manifest under deployment-records/ (docs/ is
currently ignored): network/chain, contract address, sender, transaction hash,
block/hash, nonce, source commit plus reviewed preparation diff if uncommitted,
compiler/Foundry settings, creation/runtime hashes, gas used, fee, explorer URL,
verification result, and UTC timestamp. Never include provider URLs or credentials.
No deployment manifest/address is invented by this preparation.

## Frontend configuration and real-wallet validation

After approved deployment/identity verification, set an ignored frontend/.env.local:

    VITE_CHAIN_ID=11155111
    VITE_NETWORK_NAME=Sepolia
    VITE_CONTRACT_ADDRESS=<verified address>

Vite configuration is public and compiled at build time. Restart dev server or
rebuild production; no RPC secret or wallet key belongs in VITE_* variables.
The frontend uses MetaMask's injected RPC; it has no VITE_RPC_URL configuration.
Keep chain/code checks, replacement identity checks, pending locks, custom errors,
and authorized withdrawTo/refundTo behavior intact. Changing to Sepolia does not
authorize publishing the frontend; hosting is a separate approval.

Use four tiny campaigns: successful legacy withdrawal, successful redirected
withdrawal, unsuccessful legacy refund, unsuccessful redirected refund. Include
two contributors, wrong-account/early/duplicate attempts, invalid recipients,
wallet rejection, account/network changes, replacement/cancellation, interrupted
tracking/reconnect, and confirmation with failed data refresh. Verify receipts,
events, exact claimant entitlements, and recipient balance changes accounting for
gas when sender equals recipient. The browser form requires at least one day:
plan creation and settlement sessions at least 24 hours apart. Short-duration
fixtures would be separate approved transactions, not a UI duration bypass.

Check keyboard navigation, focus/errors/live announcements, reduced motion,
320/375/768/1280 px layouts, long addresses/amounts, 4.5:1 normal-text contrast,
pagination, and lazy chunk loading/failure recovery. No connected browser or real
wallet session has yet validated these. Keep transaction state mounted during
navigation; after reload use wallet history before retrying uncertain submissions.

## Recovery and redeployment

- No receipt/timeout: check both providers, sender nonce, and known transaction
  hashes first. Do not blindly resend, restart, or use --resume.
- Reverted receipt: investigate the cause and propose a newly reviewed transaction.
- Mined but verification failed: verify the SAME address; no redeployment.
- Wrong code/config: stop frontend writes and diagnose; do not bypass runtime hash.
- RPC outage: switch only after chain/finalized-block checks; preserve tx history.
- Frontend rollback: rebuild with a previously VERIFIED configuration and artifact.
- The contract is immutable: no on-chain rollback, pause, or automatic migration.
  A replacement needs new approval, deployment, identity proof, and public record.
  Preserve access to old campaigns so rightful withdrawals/refunds remain possible.
- Keep ignored Foundry broadcast/cache records privately together on pinned 1.8.1;
  do not follow recovery instructions for newer Foundry formats without review.

## References

- https://ethereum.org/developers/docs/networks/
- https://www.getfoundry.sh/forge/scripting
- https://www.getfoundry.sh/reference/cast/wallet/import
- https://sepolia.etherscan.io/

Current online Foundry docs may describe newer releases. Pinned local CLI help and
the tested 1.8.1 commands take precedence; do not upgrade tools during deployment.

Simulation explicitly selects --rpc-url fundchain_sepolia. The alias resolves
SEPOLIA_RPC_URL from the sanitized child environment, keeping credential URLs out
of command arguments. No chain override or fallback to local Anvil is used; RPC
selection failure stops the simulation. Compiler settings are unchanged.

Gas estimates must be reconciled against both live providers. Historical RPC
estimates exceeded the pinned local simulator estimate; the cause is not
established by these offline checks. Compiler target Osaka remains unchanged
for bytecode identity; successful local simulation
is not proof that its gas allowance is sufficient on the current network. The
helper reports a mismatch and RPC estimates take precedence for budgeting. Any
gas limit and EIP-1559 fee ceiling require review and approval before signing.
