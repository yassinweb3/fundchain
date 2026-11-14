# FundChain frontend

Use Node 24.15.0 and npm 11.12.1. The Solidity tooling remains in WSL.

```powershell
cd frontend
npm.cmd ci
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Tests require the current `out/Crowdfunding.sol/Crowdfunding.json` artifact. Build
the pinned contract in WSL first (`~/.foundry/bin/forge build` from the repository
root). No blockchain deployment is needed for tests. CI downloads the artifact
from its Solidity job before checking the ABI and running the frontend tests.

## Configuration and contract identity

Copy `.env.example` to an ignored `.env.local` when overriding the local defaults.
Vite variables are public: never put private keys or API secrets in them. Restart
Vite after changing configuration. Chain ID must be a positive decimal integer;
the default is Anvil 31337. The configured address must contain the exact reviewed
runtime, not merely any contract on the right chain.

`npm.cmd run contract:sync` generates `src/contract.generated.ts` from the current
Solidity artifact. `npm.cmd run contract:check` verifies the committed ABI/runtime
hash against that artifact and its source/compiler settings. Regenerate only after
reviewing the contract change. No deployment address or private key is generated.
The frontend verifies chain and code on connection and before every signature
request. Older deployments fail this verification. Deploying the updated contract
is separate work requiring approval; the frontend never upgrades an existing one.

## Wallet and transaction behavior

Account/network changes and disconnects invalidate the session. Reconnect before
continuing. Old reads cannot restore another account's data. Polling and manual
refresh share one request, and snapshots use one block number and timestamp.

Transaction status records the originating account, chain, and hash independently
of the current session. Confirmation remains successful if refreshing campaigns
fails. Tracking errors are not proof of failure: new submissions stay blocked
until receipt tracking succeeds. Reconnect the originating account/network to
check status. A lost wallet response or a mismatched transaction requires checking
wallet history before explicitly acknowledging that the requested action was not
sent. This acknowledgement never broadcasts or cancels a transaction. Status is
held in memory; after a reload consult wallet history before resubmitting.

Repricing is accepted only when sender, chain, destination, calldata, and value
still match the intended operation. Other replacements/cancellations are reported
as such rather than claiming the original action succeeded.

## Payout recovery

Leave the optional recipient empty for ordinary Withdraw/Refund. A valid explicit
recipient uses `withdrawTo`/`refundTo` and is displayed in full before submission.
Zero and FundChain's own address are rejected. Only the connected account's own
eligible claim can be redirected. An EOA cannot claim on behalf of a contract;
contract wallets must expose a supported way to authorize the call.

## Validation limits

Automated tests use controlled EIP-1193 RPC responses and React component tests.
They do not constitute a real MetaMask signing session or a public-network test.
Campaign reads have bounded concurrency but still load all campaigns; pagination
remains a separate improvement. Existing moderate tooling findings are governed
by the root `TOOLING_RISK_EXCEPTION.md`; do not bypass its audit policy.
