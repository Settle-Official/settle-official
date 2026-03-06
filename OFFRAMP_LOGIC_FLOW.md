# Offramp Logic Flow and Service Map

This document reverse-engineers the current offramp implementation in this repository so you can replicate the logic in another project and swap the API providers later.

## 1. Where the active offramp flow lives

### Primary entry and orchestration
- `packages/nextjs/app/page.tsx`
  - Renders the offramp UI via `<StarknetOffRamp />`.
- `packages/nextjs/components/Form.tsx`
  - Main offramp state machine and orchestration.
  - Contains:
    - user input steps,
    - quote/payout calculations,
    - LayerSwap swap creation + status polling,
    - Starknet transaction submission,
    - Paycrest order creation + status polling,
    - Base token transfer to Paycrest `receiveAddress`.

### Supporting API routes actually used by the UI flow
- `packages/nextjs/app/api/proxy/route.ts`
  - Server-side proxy used by the frontend services in `Form.tsx`.
  - Routes requests to either LayerSwap or Paycrest based on endpoint prefix.

### Supporting utilities and types used by the active flow
- `packages/nextjs/utils/polling.ts`
  - Generic polling helper (`pollWithTimeout`).
- `packages/nextjs/types/layerswap.ts`
  - LayerSwap status union and response type.
- `packages/nextjs/hooks/useAccount.ts`
  - Wrapped Starknet account hook used in `Form.tsx`.

## 2. Additional offramp-related files (not in active UI path)

### Alternative backend route (currently not used by UI)
- `packages/nextjs/app/api/initiate-gasless-offramp/route.ts`
  - End-to-end backend pipeline for:
    - fetch LayerSwap swap,
    - execute Starknet transfer,
    - poll LayerSwap,
    - create Paycrest order,
    - execute Base USDC transfer,
    - poll Paycrest.
  - Important: `executeStarknetTransfer()` here is a placeholder/stub returning a fake hash.

### Shared offramp DTOs
- `packages/nextjs/types/offramp.ts`
  - Request and response-related types for the backend route and webhook payload.

### Paycrest webhook endpoint
- `packages/nextjs/app/api/webhooks/paycrest/route.ts`
  - Verifies webhook signature and logs status transitions.
  - Does not update persistent storage yet.

### Wallet client helper for Base
- `packages/nextjs/utils/wallet.ts`
  - Helpers for creating `viem` public/wallet clients from private key.

## 3. Active offramp flow: exact sequence

## A) User reaches UI and connects wallet
1. `app/page.tsx` renders `StarknetOffRamp`.
2. `StarknetOffRamp` (`Form.tsx`) uses:
   - `useCustomAccount()` from `hooks/useAccount.ts` for wallet/account state,
   - `useSendTransaction()` from `@starknet-react/core` for Starknet tx execution.

## B) Step 1: beneficiary setup
1. On mount, `loadCurrencies()` calls:
   - `paycrestService.getCurrencies()` -> `GET /api/proxy?endpoint=/currencies`.
2. When fiat currency changes:
   - `loadInstitutions()` calls `GET /api/proxy?endpoint=/institutions/{currency}`.
3. When account number reaches min length and bank exists:
   - `verifyAccount()` calls `POST /api/proxy?endpoint=/verify-account` with
     - `institution`,
     - `accountIdentifier`.
   - Returned account name is stored in form state.

## C) Step 2: amount/quote calculation (`calculatePayout`)
Two modes are supported.

### Mode 1: crypto input (`isFiatInput = false`)
1. User enters crypto amount (USDC/USDT).
2. Create LayerSwap swap:
   - `POST /api/proxy?endpoint=/swaps`
   - payload includes:
     - source network: `STARKNET_MAINNET`,
     - destination network: `BASE_MAINNET`,
     - destination address: `CONFIG.BASE_ADDRESS`,
     - source token and amount.
3. Read quote from swap response (`min_receive_amount`).
4. Get Paycrest fiat rate for that bridged amount:
   - `GET /api/proxy?endpoint=/rates/{token}/{min_receive_amount}/{currency}`.
5. Compute estimated payout:
   - `estimatedPayout = min_receive_amount * rate * 0.993`
   - (`0.993` models a 0.7% fee deduction).
6. Save to state:
   - swap data,
   - `estimatedLayerSwapInput`,
   - `estimatedPaycrestOrderInput`,
   - `estimatedPayout`,
   - `rate`.

### Mode 2: fiat input (`isFiatInput = true`)
1. User enters desired fiat amount.
2. Fetch rate for 1 token:
   - `GET /api/proxy?endpoint=/rates/{token}/1/{currency}`.
3. Compute Paycrest order token amount:
   - `paycrestAmount = fiatAmount / (rate * 0.993)`.
4. Compute LayerSwap source amount estimate:
   - if `paycrestAmount <= 10`: divide by `0.983` (code/comment mismatch nearby),
   - else divide by `0.997`.
5. Create LayerSwap swap again using computed source amount.
6. Save same consolidated state fields as Mode 1.

## D) Step 3: execution (`handleTrade`)

### 1. Pre-checks
- Requires connected Starknet account + address + existing `swapId`.

### 2. Fetch deposit action and build Starknet calls
1. Get latest swap details:
   - `GET /api/proxy?endpoint=/swaps/{swapId}`.
2. Parse `deposit_actions[0].call_data` JSON.
3. Transform into Starknet call array expected by `sendAsync`.

### 3. Execute Starknet transfer
- Calls `sendAsync(calls)` from `@starknet-react/core`.
- Captures `transaction_hash`.
- Gasless/paymaster path exists as comments only (not active).

### 4. Monitor LayerSwap status
- Uses `pollLayerSwapOrderStatus()` in `Form.tsx`.
- Internally polls `layerSwapService.getSwapDetails(swapId)` every 5s up to 5 min.
- Terminal states: `completed`, `failed`, `cancelled`, `expired`.
- If not `completed`, flow errors and stops.

### 5. Create Paycrest sender order
- Builds `orderData` with:
  - `amount`: `estimatedPaycrestOrderInput`,
  - `token`,
  - `rate`,
  - `network: "base"`,
  - `recipient`: institution/account/accountName/currency/memo,
  - `returnAddress`: `CONFIG.BASE_ADDRESS`.
- Calls `POST /api/proxy?endpoint=/sender/orders`.
- Stores returned order id/status in UI state.

### 6. Transfer Base tokens to Paycrest receive address
- Calls `transferTokensToPaycrest(paycrestOrder, token)`.
- In this function:
  1. validates order fields and expiry,
  2. reads `NEXT_PUBLIC_BASE_PRIVATE_KEY`,
  3. creates `viem` Base clients,
  4. picks token contract from `CONFIG.BASE_TOKENS`,
  5. parses `paycrestOrder.amount` with token decimals,
  6. calls ERC20 `transfer(receiveAddress, parsedAmount)` on Base.
- Returns transfer tx hash.

### 7. Monitor Paycrest order status
- Uses `pollPaycrestOrderStatus(orderId)`.
- Polls every 10s up to 10 min.
- Terminal states: `validated`, `settled`, `refunded`, `expired`.
- Marks trade success for `validated/settled`; otherwise treated as non-success terminal.

## E) UI feedback channel
- `Form.tsx` includes tx modal + timeline logs (`txLogs`) + countdown.
- Every major stage pushes explicit log messages for user visibility.

## 4. Service boundaries and replace points

If you are replicating the logic in another project but replacing providers later, preserve these boundaries.

### Boundary 1: Bridge provider adapter (currently LayerSwap)
Current methods (in `Form.tsx`):
- `createSwap(sourceToken, amount)`
- `getSwapDetails(swapId)`
- `pollLayerSwapOrderStatus(swapId)`

Replace with a generic interface like:
- `createBridgeTransfer()`
- `getBridgeTransferStatus()`
- `pollBridgeCompletion()`

### Boundary 2: Fiat payout provider adapter (currently Paycrest)
Current methods (in `Form.tsx`):
- `getCurrencies()`
- `getInstitutions(currency)`
- `verifyAccount(institution, accountIdentifier)`
- `getRate(token, amount, currency)`
- `createOrder(orderData)`
- `getOrderDetails(orderId)`
- `pollPaycrestOrderStatus(orderId)`

Replace with generic:
- `listPayoutCurrencies()`
- `listInstitutions(currency)`
- `resolveBeneficiary()`
- `quoteFiatRate()`
- `createPayoutOrder()`
- `getPayoutOrderStatus()`

### Boundary 3: Chain execution adapters
Current split:
- Starknet user transfer: wallet-signed (`sendAsync` in browser).
- Base transfer: hot-wallet signed (`viem` with private key in frontend code path).

For replication, isolate:
- `executeSourceChainTransfer(calls)`
- `executeDestinationChainTransfer(order)`

## 5. Endpoint and dependency map

### Frontend -> internal API
Used by active flow (`Form.tsx`):
- `GET /api/proxy?endpoint=/currencies`
- `GET /api/proxy?endpoint=/institutions/{currency}`
- `POST /api/proxy?endpoint=/verify-account`
- `GET /api/proxy?endpoint=/rates/{token}/{amount}/{currency}`
- `POST /api/proxy?endpoint=/swaps`
- `GET /api/proxy?endpoint=/swaps/{swapId}`
- `POST /api/proxy?endpoint=/sender/orders`
- `GET /api/proxy?endpoint=/sender/orders/{orderId}`

### Internal API -> external services
From `app/api/proxy/route.ts`:
- LayerSwap base URL: `https://api.layerswap.io/api/v2`
- Paycrest base URL: `https://api.paycrest.io/v1`

## 6. Data models you should carry over

### Swap status model
- `types/layerswap.ts`:
  - `user_transfer_pending`,
  - `ls_transfer_pending`,
  - `completed`,
  - `failed`,
  - `cancelled`,
  - `expired`.

### Offramp backend DTOs
- `types/offramp.ts`:
  - `OffRampRequest`,
  - `LayerSwapResponse`,
  - `PaycrestRate`,
  - `PaycrestOrder`,
  - `PaycrestOrderStatus`,
  - `PaycrestWebhookBody`.

## 7. Important implementation notes and caveats

1. `Form.tsx` is the real production path right now.
   - It performs most orchestration client-side.
2. `app/api/initiate-gasless-offramp/route.ts` is a separate server-side orchestration path but currently not called by `Form.tsx`.
3. In `Form.tsx`, `baseService.completeTrade` references `/api/complete-base-trade`, but this route does not exist in the repo and is not used by the current trade path.
4. Rate limiter is currently a placeholder:
   - `utils/rateLimit.ts` returns resolved promise (no actual throttling).
5. Sensitive key handling concern:
   - `Form.tsx` uses `NEXT_PUBLIC_BASE_PRIVATE_KEY` for Base transfer logic. This is publicly exposed by Next.js conventions and should be moved server-side in any serious replication.
6. There are fee-comment inconsistencies in `calculatePayout` around low-amount LayerSwap math (`0.983` used while nearby text references different values). Preserve behavior intentionally if you need exact parity.

## 8. Minimal extraction checklist for your new project

1. Copy and adapt state machine from `StarknetOffRamp`:
   - step progression,
   - quote recalculation triggers,
   - execution sequence.
2. Replace service calls behind adapters:
   - bridge adapter,
   - fiat payout adapter.
3. Keep polling abstraction (`pollWithTimeout`) and status-driven gates.
4. Move destination-chain transfer signing fully server-side.
5. Keep webhook endpoint pattern for asynchronous finality updates.

## 9. File index (quick copy map)

- `packages/nextjs/app/page.tsx` -> offramp page entry
- `packages/nextjs/components/Form.tsx` -> main offramp logic/state/orchestration
- `packages/nextjs/app/api/proxy/route.ts` -> provider proxy gateway
- `packages/nextjs/utils/polling.ts` -> generic polling primitive
- `packages/nextjs/types/layerswap.ts` -> bridge status types
- `packages/nextjs/hooks/useAccount.ts` -> wallet account wrapper
- `packages/nextjs/types/offramp.ts` -> backend DTOs
- `packages/nextjs/app/api/initiate-gasless-offramp/route.ts` -> alternate backend orchestration
- `packages/nextjs/app/api/webhooks/paycrest/route.ts` -> payout status webhook handler
- `packages/nextjs/utils/wallet.ts` -> base chain viem client helpers

