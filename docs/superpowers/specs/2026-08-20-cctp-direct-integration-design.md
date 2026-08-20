# Direct Circle CCTP integration for onramp + offramp bridging

## Problem

Both bridge legs currently depend on Allbridge, and both have proven fragile:

- **Offramp** (Stellar USDC → Base USDC → Paycrest payout) routes through Allbridge Next
  (`api.next.allbridge.io`), an undocumented, reverse-engineered REST API (see
  `2026-07-22-offramp-bridge-allbridge-next-route-design.md`). Since that integration shipped,
  Allbridge has twice changed behavior under us without notice: first switching this route's
  messenger to `near-intents` (breaking the relayer-fee assumption baked into our request, fixed
  by making relayer fees optional and adding a `refundTo` field), and as of this investigation
  their `/tx/create` endpoint is returning a hard `502` from their own origin server — an outage
  on their side we cannot work around.
- **Onramp** (fiat → Base USDC custodial hold → Stellar delivery) routes through Allbridge
  **Core** (`@allbridge/bridge-core-sdk`) via `src/lib/onramp/base-bridge.ts`. Core has already
  been confirmed non-functional for the Stellar↔Base pair on the offramp side (400/404 on
  `/receive-fee`, `transferTime: null` in its own chain metadata) — onramp has not been
  independently reconfirmed broken, but depends on the same product for the same chain pair.

Both problems trace back to depending on a third party's aggregator product for a chain pair
(Stellar↔Base) that Circle's own CCTP protocol supports natively. This spec replaces both legs
with a direct CCTP integration — no Allbridge dependency for bridging, in either direction.

## Decision: full cutover, no live fallback

Considered keeping Allbridge as a live fallback path if CCTP fails. Ruled out: CCTP is a
burn-and-mint protocol, not a bridge with a cancelable in-flight state. Once a burn transaction
is broadcast on the source chain, those funds are gone from that chain unless the destination-side
mint completes (guaranteed eventually via attestation/re-attestation, never instantly reversible).
Allbridge has no mechanism to adopt or refund a transfer CCTP already burned — different protocol,
different escrowed funds. A live fallback would only ever be able to trigger *before* a burn is
broadcast, which adds meaningful complexity for limited benefit given CCTP is Circle's own
permanent, documented protocol (unlike Allbridge Next's undocumented API).

**Decision, per explicit product direction:** full cutover to CCTP for both legs. Existing
Allbridge code (`allbridge-next-adapter.ts`, `allbridge-adapter.ts`, the Allbridge-SDK parts of
`base-bridge.ts`) is left in place but unwired, as a rollback reference — same pattern already
established when Core was replaced by Next. CCTP failure handling (retries, re-attestation,
alerting) is handled within CCTP's own flow — see Error handling below. Not designed here:
resuming a live Allbridge fallback path — tracked as explicit future work only if needed.

## Protocol facts (verified against Circle's docs directly, 2026-08-20)

Verified by fetching raw markdown (not AI-summarized HTML — hex addresses are exactly the kind of
string a summarizing pass can corrupt, and this is a real-funds integration) from
developers.circle.com.

- **Domains:** Stellar = 27, Base = 6. Both are CCTP **V2**. A direct Stellar↔Base transfer does
  not need to route through Arc or any other intermediary chain — domains are peer-to-peer.
- **Stellar side** (Soroban contracts, mainnet):
  - `TokenMessengerMinter`: `CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL`
    — consolidates burn+mint (equivalent to EVM's `TokenMessengerV2` + `TokenMinterV2`).
  - `MessageTransmitter`: `CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV`
    — message emission/verification layer.
  - `CctpForwarder`: `CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T`
    — CCTP treats `mintRecipient` as a **contract address** on Stellar. Minting to a plain user
    G-address requires burning with `deposit_for_burn_with_hook`, `mintRecipient` = this
    forwarder, and `hook_data` encoding the real recipient as a `forwardRecipient` strkey. The
    forwarder's `mint_and_forward(message, attestation)` mints and forwards atomically in one
    Soroban invocation — no partial-mint-but-unforwarded state is possible ("any failure
    reverts", per Circle's docs).
  - Testnet equivalents also published (`TokenMessengerMinter`:
    `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP`, `MessageTransmitter`:
    `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY`, `CctpForwarder`:
    `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ`) — used for the testnet phase of
    rollout.
- **Base side** (standard EVM CCTP V2 contracts, same address on every EVM chain, mainnet):
  - `TokenMessengerV2`: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`
  - `MessageTransmitterV2`: `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`
  - `TokenMinterV2`: `0xfd78EE919681417d192449715b2594ab58f5D002`
  - Base recipients are plain EOAs — no forwarder/hook needed minting *into* Base.
- **Attestation:** Circle's Iris service. Mainnet `https://iris-api.circle.com`, testnet
  `https://iris-api-sandbox.circle.com`. Burn → poll `GET /v2/messages` (by domain + tx hash)
  until attestation status is `complete` → submit on destination. `POST /v2/reattest/{nonce}`
  recovers an expired/stuck attestation (Fast/unfinalized messages embed a 24h expiration on
  the destination chain) — this is the mechanism that makes CCTP failures recoverable rather
  than fund-losing. `GET /v2/burn/USDC/fees` gives a real, live fee quote instead of guessing.
- **Bridge Kit** (Circle's higher-level SDK) was investigated and ruled out: it redirects to
  `docs.arc.io/app-kit/bridge`, meaning it's coupled to Circle's own Arc chain, not a
  general-purpose relayer-as-a-service for arbitrary domain pairs. This needs a direct
  integration against the raw CCTP contracts + Iris API.

## Architecture

One new shared adapter, `src/lib/cctp/cctp-adapter.ts` — chain-agnostic core exposing:

- Domain/contract constants (mainnet + testnet, selected via env override, mirroring the
  `ALLBRIDGE_NEXT_API_URL`-style override already used in `allbridge-next-adapter.ts`).
- `getBurnFeeQuote({ sourceDomain, destDomain, amount })` → `GET /v2/burn/USDC/fees`.
- `buildStellarBurnTx(...)` → unsigned `deposit_for_burn` (offramp, Base recipient, no hook) XDR.
- `buildBaseBurnTx(...)` → `depositForBurnWithHook` calldata (onramp, Stellar `CctpForwarder`
  recipient + hook-encoded final Stellar address).
- `pollAttestation({ domain, txHash })` → `GET /v2/messages`, with re-attest fallback.
- `submitBaseMint(message, attestation)` → `MessageTransmitterV2.receiveMessage` via the
  existing Base hot wallet.
- `submitStellarMintAndForward(message, attestation)` → `CctpForwarder.mint_and_forward` via
  the new Stellar hot wallet.

CCTP's burn→attest→mint flow cannot be a single synchronous request/response — attestation can
take anywhere from ~8-20s (Fast) up to minutes, and the mint step must be submitted by us (a
permissionless call, but someone has to pay gas). This requires **durable state + a background
relay**, not a request-scoped timeout:

- **Persistence:** a new Redis-backed record (`cctp-store.ts`), one shape shared by both
  directions:

  ```
  CctpTransferRecord {
    id, direction: "offramp" | "onramp",
    sourceDomain, destDomain, burnTxHash, mintRecipient,
    status: "burned" | "attesting" | "attested" | "minting" | "completed" | "failed",
    attestationMessage?, attestationSignature?, mintTxHash?,
    attempts, lastError?, createdAt, updatedAt,
    paycrestOrderId?, // links back to the order driving this transfer
  }
  ```

  Plus a pending-ids index so the relay tick doesn't scan all keys. Mirrors the existing
  crash-safety intent already documented in `onramp-store.ts`.

- **Relay:** a Vercel Cron job hitting `/api/cctp/relay` roughly every minute. Each tick advances
  every pending record one phase: poll attestation if waiting, submit mint if attested, confirm
  mint if submitted. A failed/timed-out tick just gets retried next minute — no separate retry
  logic needed beyond "leave it pending." Cron auth via a `CRON_SECRET`-checked Authorization
  header, standard Vercel Cron practice.

- **User-facing flow stays synchronous only for the burn step.** Offramp: build tx → Freighter
  signs → submit, same UX as today. Onramp: unchanged from the user's perspective — already
  custodial/webhook-triggered, no user action for the bridge leg either way. Completion is
  signaled the same way it already is today: Paycrest's webhook for offramp payout, existing
  onramp status polling for onramp — neither waits on the CCTP mint directly.

## Offramp flow (Stellar → Base → Paycrest)

1. Paycrest order creation unchanged → `settlementAddress` (plain Base EVM address).
2. `build-tx` route calls the CCTP adapter instead of Allbridge Next: real fee quote from Iris,
   then build unsigned `deposit_for_burn` (no hook — Base recipients aren't subject to Stellar's
   contract-recipient quirk) with `mintRecipient = settlementAddress`. Simulate + assemble via
   the existing `soroban-tx-builder.ts` machinery, unchanged.
3. User signs & submits via Freighter — unchanged `submit-soroban` route.
4. On successful submit, write a `CctpTransferRecord` (`direction: "offramp"`, `status: "burned"`).
5. Relay polls Iris, then submits `receiveMessage` on Base via the **existing** Base hot wallet
   (`ONRAMP_HOT_WALLET_PRIVATE_KEY`, `base-bridge.ts`'s client pattern) — new capability on that
   wallet, no new secret.
6. Record marked `completed` on mint confirmation. Purely for our own observability/retry —
   Paycrest's webhook remains the real payout-completion signal, unchanged.

**UI side effect:** CCTP's fee is one real, non-zero USDC amount deducted from the transferred
amount — not a separate XLM charge. The "pay gas fee with USDC vs XLM" toggle in `FormCard.tsx`
(built around Allbridge's now-defunct relayer-fee split) goes away; there's just one real fee,
shown once. The user still separately pays Stellar's own small XLM network fee to submit the burn
tx, same as always — unrelated to CCTP, unchanged.

## Onramp flow (Base → Stellar)

Fiat settlement and USDC landing in the Base hot wallet are unchanged (Paycrest's own
settlement mechanism, not bridging — out of scope). Only the bridging step changes:

1. Instead of Allbridge's `rawTxBuilder.send`, call the CCTP adapter's Base-side burn builder —
   `depositForBurnWithHook`, still signed by the existing Base hot wallet — with `mintRecipient`
   and `destinationCaller` both set to Stellar's `CctpForwarder`, and `hookData` encoding the
   real end user's Stellar G-address as `forwardRecipient`.
2. `onramp-store.ts`'s existing record gets `bridgeTxHash` populated same as today, plus new
   attestation-tracking fields (via the shared `CctpTransferRecord`, linked by order id).
3. Relay polls Iris, then submits `mint_and_forward` on `CctpForwarder` using the **new** Stellar
   hot wallet.
4. `stellarTxHash` set on completion — same field onramp already tracks, now populated by CCTP.

## New secrets / config

- New Stellar hot wallet secret (server-only, e.g. `CCTP_STELLAR_HOT_WALLET_SECRET`) for the
  onramp mint-and-forward step. Needs XLM funding for gas; same floor-check-before-submit pattern
  `base-bridge.ts` already applies to its ETH balance (`ONRAMP_MIN_GAS_ETH`) — refuse to submit
  rather than risk stranding, applied symmetrically here.
- Existing `ONRAMP_HOT_WALLET_PRIVATE_KEY` gains a new capability (submitting `receiveMessage`)
  — no new secret, but its operational surface grows; worth noting for whoever reviews wallet
  permissions/monitoring later.
- Iris API base URL as an env-overridable constant (mainnet default, testnet override), same
  override pattern already used for `ALLBRIDGE_NEXT_API_URL`.
- `CRON_SECRET` for the relay route's Authorization check.

## Error handling

- Burn-tx build/submit failures surface through existing error-handling paths (same shape as
  today's `build-tx` route try/catch).
- Attestation/mint failures are the relay's problem, not the user's: a stuck record just stays
  `attesting`/`attested` and gets retried next tick. `attempts`/`lastError` are tracked per
  record for visibility.
- After a configurable attempt ceiling, mark the record `failed` and route into the **existing**
  Telegram alerting already built for offramp events (`db6a2fd`) rather than building new
  notification plumbing — a stuck CCTP transfer needs a human, and that channel already exists.
- Expired Fast/unfinalized attestations are recovered via `POST /v2/reattest/{nonce}` before
  giving up — not an immediate failure.

## Testing / rollout

1. Build and fully exercise **both directions against testnet** first — Circle publishes testnet
   CCTP contracts for both Stellar and Base Sepolia (addresses above), so the complete
   burn→attest→mint round trip is testable with zero real funds at risk.
2. Only after clean testnet round-trips both ways: one small real mainnet transfer (~1 USDC) per
   direction before calling this done — same practice already established for the Allbridge Next
   rollout (verify funds actually land, don't trust the integration blind).

## Files touched

**New:** `src/lib/cctp/cctp-adapter.ts`, `src/lib/cctp/cctp-store.ts`,
`src/app/api/cctp/relay/route.ts` + cron config entry.

**Changed:** `src/app/api/offramp/bridge/build-tx/route.ts`,
`src/app/api/offramp/bridge/gas-fee-options/route.ts`,
`src/app/api/offramp/bridge/status/[txHash]/route.ts`, `src/app/api/offramp/quote/route.ts`
(offramp side, swap Allbridge Next calls for the CCTP adapter); `src/lib/onramp/base-bridge.ts`
(swap Allbridge SDK calls for the CCTP adapter), `src/lib/onramp/onramp-store.ts` (extend record
fields); `src/components/FormCard.tsx` (fee display simplification — one real fee, no
USDC/XLM toggle).

**Unchanged:** `src/app/api/offramp/bridge/submit-soroban/route.ts`, Paycrest order
creation/webhook plumbing, wallet-signing UX, `allbridge-next-adapter.ts` /
`allbridge-adapter.ts` (left in place, unwired, as rollback reference).
