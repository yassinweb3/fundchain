# Temporary tooling risk exception

Status: approved for this scoped baseline; not a permanent waiver.
Owner: repository maintainer.
Reviewed: November 20, 2026.
Expires: December 13, 2026, end of day Asia/Riyadh
(`2026-12-14T00:00:00+03:00`). Renewal requires explicit review and approval.

## Scope and evidence

Advisory: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Installed minimatch 10.2.6 can consume excessive CPU/memory when processing
attacker-controlled glob patterns. The current audit reports nine moderate affected
package entries, all arising from this one advisory:

- minimatch
- @eslint/config-array
- eslint
- @typescript-eslint/typescript-estree
- @typescript-eslint/parser
- @typescript-eslint/type-utils
- @typescript-eslint/utils
- @typescript-eslint/eslint-plugin
- typescript-eslint

These are development lint-tool dependencies. No exploit in the production
frontend has been demonstrated; this does not remove developer/CI denial-of-service
risk. Treat untrusted source/configuration and pull requests as untrusted input.
Do not expose CI secrets to untrusted code or run unreviewed configurations locally.

The verified baseline has zero high/critical audit entries after updating Vite to
8.3.3, source-map-js to 1.2.2, and Zod to 4.6.6. ESLint 10.11.0 and
TypeScript-ESLint 8.70.1 remain unchanged. The installed minimatch remains 10.2.6; the advisory lists 11.0.1 as patched.
The November 20 audit now reports fixes available for all nine entries. This
changes the earlier remediation assessment: review compatible parent-package
updates and their lockfile diff in a separate dependency change, then rerun all
checks. No dependency remediation was applied during this final review. Registry metadata
identifies ESLint 10.15.0 (minimatch ^11.0.5) and TypeScript-ESLint 8.73.0 as
follow-up candidates; their Node engine ranges admit Node 24.15.0, but the
combined dependency tree and behavior still require installation approval and
compatibility testing. `npm audit --omit=dev` currently reports zero findings. A forced major override or automated
lint-tool downgrade is not authorized by this exception.

## Enforcement and exit criteria

The frontend CI job evaluates the complete npm audit JSON report. It permits only
the advisory above and its listed moderate dependency entries, with at most ten
affected entries, before expiry. It rejects new advisory roots, unrelated affected
packages, high/critical findings, expired exceptions, malformed reports, and audit
service/process errors. The full audit report is printed for review. A clean audit
passes without relying on this exception.

Review earlier when a compatible upstream fix becomes available or dependency
paths, exposure, or severity change. Remove the exception when an approved update
eliminates the advisory. Verify the resulting tree with npm ls, audit, lint, and
production build; record the reviewed lockfile diff. Do not use
`npm audit fix --force` to satisfy this policy.

## Reproducible environment and validation limits

Use Foundry v1.8.1 and Solc 0.8.36 in WSL/Linux. Use Node 24.15.0 (root .nvmrc)
and npm 11.12.1 (frontend packageManager and CI version assertion).
The npm pin is installed explicitly by CI; packageManager alone is not enforcement.
Foundry's effective Osaka EVM target, disabled optimizer, and disabled via-IR are
preserved. This is not approval to deploy to a network without Osaka support.

Verified on November 20, 2026: formatting/build and 82 Solidity tests pass under
WSL Ubuntu with the security profile, including 1,000 runs per fuzz test and
256 invariant runs of depth 128. The invariant group checks four properties.
All 109 frontend tests, lint, ABI identity, production build, bundle budgets, and
Chromium responsive tests pass on Windows. Hosted Linux execution is enforced
by the workflow; its result must be checked for the final pushed commit.
