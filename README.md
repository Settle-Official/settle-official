# Stellaramp - Stellar to Naira Offramp

Convert Stellar USDC to Nigerian Naira seamlessly.

## Features

- 🌟 Stellar wallet support (Freighter & Lobstr)
- 🌉 Allbridge integration (Stellar → Base)
- 💰 Paycrest integration (Base USDC → NGN)
- 📱 No database required - localStorage for transaction history
- 🔒 Secure server-side token transfers
- ⚡ Real-time status updates

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```bash
PAYCREST_API_KEY=pk_live_xxxxx
PAYCREST_WEBHOOK_SECRET=whsec_xxxxx
BASE_PRIVATE_KEY=0xyour_private_key
BASE_RETURN_ADDRESS=0xyour_wallet_address
NEXT_PUBLIC_BASE_RETURN_ADDRESS=0xyour_wallet_address
```

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Architecture

**Stateless, API-driven** - No database required!

- Frontend: React + Next.js
- Wallet: Freighter/Lobstr integration
- Bridge: Allbridge (Stellar → Base)
- Payout: Paycrest (Base USDC → NGN)
- Storage: Browser localStorage

See [SIMPLIFIED_ARCHITECTURE.md](./SIMPLIFIED_ARCHITECTURE.md) for details.

## Flow

1. Connect Stellar wallet
2. Enter amount and beneficiary details
3. Build and sign Allbridge transaction
4. Submit to Stellar network
5. Poll bridge status
6. Execute payout (server-side)
7. Poll payout status
8. Complete! 🎉

## API Endpoints

### Public
- `POST /api/offramp/quote` - Generate quote
- `POST /api/offramp/verify-account` - Verify bank account
- `GET /api/offramp/currencies` - List currencies
- `GET /api/offramp/institutions/[currency]` - List banks

### Bridge
- `POST /api/offramp/bridge/build-tx` - Build transaction
- `GET /api/offramp/bridge/status/[txHash]` - Check status

### Payout
- `POST /api/offramp/execute-payout` - Execute payout
- `GET /api/offramp/status/[orderId]` - Check status

### Webhooks
- `POST /api/webhooks/paycrest` - Paycrest webhook

## Transaction Storage

Transactions stored in browser localStorage:
- Last 50 transactions per user
- Filtered by wallet address
- Persists across page refreshes
- No server required

To add database persistence later, see [SIMPLIFIED_ARCHITECTURE.md](./SIMPLIFIED_ARCHITECTURE.md).

## Deployment

### Vercel (Recommended)

```bash
vercel --prod
```

Add environment variables in Vercel dashboard.

### Other Platforms

Works on any serverless platform (Netlify, Railway, etc.)

## Security

- ✅ Private keys server-side only
- ✅ Server-side token transfers
- ✅ Webhook signature verification
- ✅ Input validation

## Development

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Lint code
```

## Documentation

- [SIMPLIFIED_ARCHITECTURE.md](./SIMPLIFIED_ARCHITECTURE.md) - Architecture overview
- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [OFFRAMP_OPERATIONS.md](./OFFRAMP_OPERATIONS.md) - Operations guide

## Support

- Paycrest: [docs.paycrest.io](https://docs.paycrest.io)
- Allbridge: [docs-core.allbridge.io](https://docs-core.allbridge.io)
- Stellar: [developers.stellar.org](https://developers.stellar.org)

## License

MIT
