# Offramp bridge: route Stellar→Base USDC through Allbridge Next (CCTP) instead of Allbridge Core

## Problem

The offramp flow (Stellar USDC → Base USDC → Paycrest fiat payout) is broken:

- `GET /api/offramp/bridge/gas-fee-options` returns HTTP 500.
- The Settlement Breakdown's "Payout Total" never resolves (stuck on "Calculating…" then "₦ --").

## Root cause

Allbridge's **Core** product (`core.api.allbridgecoreapi.net`, used via the installed
`@allbridge/bridge-core-sdk`) no longer supports the Stellar (SRB) ↔ Base (BAS) route for
any of the three messengers our SDK version knows about (ALLBRIDGE, WORMHOLE, CCTP):

- `/receive-fee` (called by `sdk.getGasFeeOptions`) returns 400/404 for this chain pair
  regardless of messenger.
- `sdk.chainDetailsMap()`'s own token metadata shows `transferTime` as `null` for this pair
  across all messengers — Allbridge's own data confirms the route is inactive on Core.

This breaks both symptoms from a single cause: `gas-fee-options` calls `getGasFeeOptions`
directly (→ 500), and the client's quote calculation calls `sdk.getAverageTransferTime()`
which returns `null` for this route — a `null` fails strict quote validation in
`FormCard.tsx` and the quote is silently discarded (`setQuote(null)`), with no visible error.

## What actually works: Allbridge Next

Allbridge's newer aggregator frontend, `next.allbridge.io`, successfully quotes and (per its
own client code) transacts this exact pair — but via a **different, undocumented REST API**
(`api.next.allbridge.io`), using Circle's CCTP as the underlying messenger, not Core's
liquidity-pool/messenger-fee system. Confirmed by inspecting live network traffic and the
app's JS bundle:

- `POST /quote` → returns a working quote for `SRB:USDC → BAS:USDC` with `messenger: "cctp"`,
  a relayer fee, and `estimatedTime: 150` (seconds).
- `POST /tx/create` → the app's own client code takes the response's `tx` field and hands it
  straight to a wallet to sign and submit — the same "server builds unsigned tx → wallet
  signs → submit to RPC" shape our app already uses for Core.
- `GET /transfer/status` → transfer status polling, analogous to Core's status endpoint.

This is **not a public/documented API** — no SDK, no docs, discovered by reading the Next
web app's network calls and minified JS. It could change or be blocked without notice.

## Roadmap

1. **Now**: Route the offramp bridge through Allbridge Next's REST API (this doc), so the
   product keeps working.
2. **Later**: Build a direct Circle CCTP integration (no Allbridge dependency at all), trial
   it alongside Next, and — once its fees/latency/reliability are validated — make it the
   primary route. Not designed here; tracked as follow-up work.

## Scope

- Only the **offramp** Stellar→Base leg. Onramp (Base→Stellar) uses the same
  `allbridge-adapter.ts` exports (`initializeAllbridgeSdk`, `getAllbridgeTokens`,
  `getAllbridgeQuote`) via separate call sites (`src/lib/onramp/base-bridge.ts`,
  `StellarampDashboard.tsx` onramp mode) — those exports and call sites are **not modified**.
  Whether onramp is independently affected by the same Core-route issue is unconfirmed and
  out of scope here.
- Only the `SRB:USDC → BAS:USDC` pair — the app doesn't support any other pair today, so no
  route-selection/fallback logic is needed; the implementation for this pair is simply
  replaced.

## Architecture

New file: `src/lib/offramp/adapters/allbridge-next-adapter.ts` — a thin REST client against
`api.next.allbridge.io`, exposing only what we need:

- `getNextQuote({ amountFloat })` → `POST /quote` with hardcoded token IDs (`SRB:USDC`,
  `BAS:USDC`; no need to call `/tokens` or `/prices` — reduces surface area on an API we
  don't control). Returns `{ messenger, amountOut, amountOutMin, relayerFees, estimatedTime }`.
- `getNextGasFeeOptions({ amountFloat })` → derives fee-option(s) generically from whatever
  `relayerFees` the quote actually contains (see Open Question below — do not hardcode an
  assumption that both native and stablecoin options exist).
- `createNextBridgeTx({ quote, amountFloat, sourceAddress, destinationAddress })` →
  `POST /tx/create`, body built by spreading the quote response plus the addresses/amount
  (mirrors the Next app's own `buildTxRequestData`). Returns the raw `tx` payload to sign.
- `getNextTransferStatus(txHash)` → `GET /transfer/status`.

Amount conversion reuses the existing `floatToInt` helper (Stellar USDC = 7 decimals) from
`soroban-tx-builder.ts` — export it instead of duplicating.

**Existing Core-based code is left in place but unused**, not deleted:
`buildSwapAndBridgeTx`, `getAllbridgeGasFeeOptions`, `getBridgeFeeForMethod` in
`soroban-tx-builder.ts` stop being called by the offramp routes but remain in the file as a
one-import rollback path, since the Core outage is an external condition that could change.
(Flagged as a judgment call, not a hard rule — reasonable to revisit at cleanup time.)

This keeps a clean seam for the Option 2 swap later: only the 4 route files below depend on
`allbridge-next-adapter.ts`; when Circle-CCTP-direct is ready, it becomes a second adapter
with equivalent function shapes and only these route files change.

## Call sites changed

1. **`src/app/api/offramp/bridge/gas-fee-options/route.ts`** — call
   `getNextGasFeeOptions()` instead of `initializeAllbridgeSdk` + `getAllbridgeGasFeeOptions`.
2. **`src/app/api/offramp/bridge/build-tx/route.ts`** — call `getNextQuote()` +
   `createNextBridgeTx()` instead of `getAllbridgeGasFeeOptions` + `buildSwapAndBridgeTx`.
   Returns the `tx` payload the same way it returns `xdr` today.
3. **`src/app/api/offramp/bridge/status/[txHash]/route.ts`** — call
   `getNextTransferStatus()` instead of `getAllbridgeTransferStatus`. Low risk either way:
   this polling is already best-effort and does not gate success (Paycrest's own payout
   detection is the real completion gate, per `StellarampDashboard.tsx`'s `payoutResult`
   being the awaited/blocking call, `bridgeResult` being fire-and-forget).
4. **`src/app/api/offramp/quote/route.ts`** — swap its Allbridge Core calls for
   `getNextQuote()`.
5. **`src/components/FormCard.tsx`** — remove the client-side SDK usage
   (`getAllbridgeContext`, `getAllbridgeQuote`, `getAllbridgeTokens`, `initializeAllbridgeSdk`
   imports and the local quote-computation effect) and instead call the now-updated
   `/api/offramp/quote` route, same as the architecture already intends elsewhere. This
   fixes the previously-flagged "SDK running in the browser" anti-pattern as a side effect,
   at no extra cost since this exact code path is already being rewritten.

`submit-soroban/route.ts` and the client-side signing/submission code in
`StellarampDashboard.tsx` (build → sign → submit → poll) are **unchanged** — they operate on
a generic signed XDR string regardless of which contract produced it.

## Error handling

No fallback/dual-path logic between Core and Next for this pair (Core is confirmed 100%
non-functional for it — trying it first would just add latency for a guaranteed failure).
Errors from the Next API bubble up through the existing error-handling paths already in
place (500 with message in the API routes, `setQuote(null)`/`isValidQuote` in the client) —
no new error-handling design needed beyond what exists, except relaxing the fee-options
assumption noted below.

## Open question to resolve during implementation (not blocking design approval)

The one live `/quote` response captured only included a **native (XLM) relayer fee**, not a
stablecoin one — Core offered both. `getNextGasFeeOptions()` must be written generically
(map over whatever `relayerFees` contains) rather than assuming both payment methods exist.
If only native-XLM fee payment turns out to be available, `FormCard.tsx`'s "pay gas with
USDC vs XLM" toggle will need to collapse to XLM-only for this route — exact UI handling
decided once this is confirmed against a real API response.

## Testing / rollout

Because `api.next.allbridge.io` is undocumented, the exact request/response shape for
`/tx/create` is a best-effort reconstruction from minified JS, not a verified contract.
Before this is considered done: perform one real, small-amount (~1 USDC) end-to-end test on
mainnet — build tx, sign with a real wallet, submit, confirm funds actually land on the
Base destination address — rather than trusting the reverse-engineered shape blind.
