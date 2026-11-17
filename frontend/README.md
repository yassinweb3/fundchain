# FundChain frontend

Use Node 24.15.0 and npm 11.12.1. The Solidity tooling remains in WSL.

```powershell
cd frontend
npm.cmd ci
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run check:bundle
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
Campaign reads are bounded to 12 campaigns per page (at most 25 contract calls,
plus block and identity requests). Every page snapshot uses a single block. Existing moderate tooling findings are governed
by the root `TOOLING_RISK_EXCEPTION.md`; do not bypass its audit policy.

## Architecture and pagination

The entry shell has no runtime wallet/ethers imports. Connect Wallet loads the
workspace with a visible loading state and retry on load failure. No wallet
connection is requested until that module is available. Once mounted, the
workspace keeps wallet, campaign, and transaction controllers above session-keyed
forms; paging cannot unmount transaction tracking.

Campaign IDs descend from a stable page boundary. Refresh and background polling
keep that boundary even when new campaigns appear. Previous/Next navigate at most
12 campaigns; View newest campaigns explicitly discovers recent campaigns.
Account/network changes reset pagination and drafts. A slow old page/session
response cannot replace current data. Polling pauses while the tab is hidden;
returning triggers a deduplicated refresh. Confirmation always requests a fresh
snapshot of the current page. Stale snapshots remain visible with a warning on
refresh failure. A newly created campaign is available through View newest
campaigns, without silently moving the page being reviewed.

Total Campaigns is the global on-chain count. Current funds on this page sums only
the displayed campaigns, using bigint formatting; refunds decrease this amount.
It is not lifetime fundraising or the contract's ETH balance.

## Performance and accessibility checks

Build output includes a manifest. `npm.cmd run check:bundle` traverses static entry
imports (excluding dynamic imports) and enforces 100,000 bytes initial gzip,
190,000 bytes total JavaScript gzip, and 500,000 bytes per minified JS chunk.
CI runs the same budget check. Splitting delays wallet code; it does not eliminate
the eventual download. Gzip sizes are reproducible build estimates, not a browser
latency benchmark.

Forms provide associated errors and move focus to invalid fields. Campaign
progress has an accessible name/value, refresh failures do not hide form errors,
and controls have visible keyboard focus. Responsive layout and reduced-motion
styles are retained. Automated jsdom tests do not verify rendered contrast or
layout. Final manual checks require a connected browser: keyboard-only use,
320/375/768/1280 px widths, long addresses/amounts, and 4.5:1 normal-text contrast.
