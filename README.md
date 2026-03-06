# Stellaramp

Stellaramp is a Next.js offramp app that converts **Stellar USDC** to **Naira bank payout** using:
- **Allbridge** for bridge flow (Stellar -> Base)
- **Paycrest** for fiat payout orchestration (USDC -> NGN)
- **Freighter/Lobstr** for Stellar wallet signing

This project is API-driven and currently stores transaction history in browser `localStorage` (no database required).

## Tech Stack

- Next.js 15 (App Router)
- React 19 + TypeScript
- Tailwind CSS v4
- Stellar SDK + Freighter API
- Allbridge Bridge Core SDK
- viem (Base chain transfer)

## Features

- Connect Stellar wallet (Freighter auto-detect first, Lobstr fallback)
- Get USDC -> NGN quote
- Build and sign bridge transaction (XDR)
- Submit Stellar tx and poll bridge status
- Execute payout from server (Base USDC transfer + Paycrest order)
- Poll payout status
- Track user transactions locally in browser storage

## Getting Started

### 1. Install

```bash
npm install
```

### 2. Configure env

```bash
cp .env.example .env.local
```

Set values in `.env.local`:

- `PAYCREST_API_KEY`
- `PAYCREST_WEBHOOK_SECRET`
- `BASE_PRIVATE_KEY`
- `BASE_RETURN_ADDRESS`
- `BASE_RPC_URL` (optional, defaults to `https://mainnet.base.org`)
- `STELLAR_SOROBAN_RPC_URL` (optional, defaults to `https://soroban-rpc.mainnet.stellar.gateway.fm`)
- `STELLAR_HORIZON_URL` (optional, defaults to `https://horizon.stellar.org`)
- `STELLAR_RPC_URL` (legacy optional fallback)
- `NEXT_PUBLIC_BASE_RETURN_ADDRESS`

### 3. Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Current Flow

1. User connects wallet in UI.
2. User enters amount and beneficiary details in the form.
3. App requests quote and estimated payout.
4. App calls `POST /api/offramp/bridge/build-tx`.
5. User signs transaction in wallet.
6. Client submits tx to Stellar Horizon.
7. App polls `GET /api/offramp/bridge/status/[txHash]`.
8. App calls `POST /api/offramp/execute-payout`.
9. App polls `GET /api/offramp/status/[orderId]` until terminal status.

## API Routes

### Offramp

- `POST /api/offramp/quote`
- `GET /api/offramp/currencies`
- `GET /api/offramp/institutions/[currency]`
- `POST /api/offramp/verify-account`
- `POST /api/offramp/execute-payout`
- `GET /api/offramp/status/[orderId]`

### Bridge

- `POST /api/offramp/bridge/build-tx`
- `GET /api/offramp/bridge/status/[txHash]`

### Webhook

- `POST /api/webhooks/paycrest`

## Storage Model

- Transaction records are stored in browser `localStorage`
- Key: `stellaramp_transactions`
- Max retained records: `50`
- Scoped in UI by connected wallet address

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Notes

- This implementation is production-oriented in flow, but still uses local browser storage instead of a backend DB.
- Keep `.env.local`, `.next`, and `node_modules` out of version control (already covered by `.gitignore`).
