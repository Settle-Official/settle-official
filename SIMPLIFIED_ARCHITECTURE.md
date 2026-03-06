# Stellaramp - Simplified Architecture

## Overview

Stellaramp is a **stateless, API-driven** offramp system that converts Stellar USDC to Nigerian Naira without requiring a database server. All transaction history is stored client-side using browser localStorage.

## Architecture Principles

1. **No Database Required** - Pure API-driven architecture
2. **Client-Side State** - Transaction history stored in localStorage
3. **Direct API Calls** - Call Allbridge and Paycrest APIs directly
4. **Minimal Backend** - Only for secure operations (private key signing)

## Flow

```
User → Connect Wallet (Freighter/Lobstr)
  ↓
Enter Amount & Beneficiary Details
  ↓
Build Allbridge Transaction (API call)
  ↓
Sign with Wallet
  ↓
Submit to Stellar Network
  ↓
Poll Bridge Status (API call)
  ↓
Execute Payout (API call - server-side signing)
  ↓
Poll Payout Status (API call)
  ↓
Complete ✅
```

## Components

### Frontend
- **StellarampDashboard** - Main UI component
- **useStellarWallet** - Wallet connection hook (Freighter/Lobstr)
- **TransactionStorage** - localStorage wrapper for transaction history

### API Routes (Server-Side)
- `POST /api/offramp/quote` - Get quote from Paycrest
- `POST /api/offramp/verify-account` - Verify bank account
- `GET /api/offramp/currencies` - List supported currencies
- `GET /api/offramp/institutions/[currency]` - List banks
- `POST /api/offramp/bridge/build-tx` - Build Allbridge transaction
- `GET /api/offramp/bridge/status/[txHash]` - Check bridge status
- `POST /api/offramp/execute-payout` - Execute payout (server-side signing)
- `GET /api/offramp/status/[orderId]` - Check payout status
- `POST /api/webhooks/paycrest` - Paycrest webhook handler

### Adapters
- **AllbridgeAdapter** - Stellar → Base bridging
- **PaycrestAdapter** - Base USDC → NGN conversion

## Transaction Storage

Transactions are stored in browser localStorage:

```typescript
interface Transaction {
  id: string;
  timestamp: number;
  userAddress: string;
  amount: string;
  stellarTxHash?: string;
  bridgeStatus?: string;
  payoutOrderId?: string;
  payoutStatus?: string;
  beneficiary: { ... };
  status: "pending" | "completed" | "failed";
}
```

### Storage Features
- Stores last 50 transactions per browser
- Filtered by user wallet address
- Persists across page refreshes
- No server required

## Security

- Private keys stored server-side only (never NEXT_PUBLIC_)
- Server-side token transfers on Base network
- Webhook signature verification
- Input validation on all endpoints

## Environment Variables

```bash
# Paycrest
PAYCREST_API_KEY=pk_live_xxxxx
PAYCREST_WEBHOOK_SECRET=whsec_xxxxx

# Base Network (Server-side only)
BASE_PRIVATE_KEY=0xyour_private_key
BASE_RETURN_ADDRESS=0xyour_wallet_address
BASE_RPC_URL=https://mainnet.base.org

# Public
NEXT_PUBLIC_BASE_RETURN_ADDRESS=0xyour_wallet_address
```

## Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials

# Run
npm run dev
```

## Deployment

Deploy to Vercel, Netlify, or any serverless platform:

```bash
vercel --prod
```

Add environment variables in your platform's dashboard.

## Future Enhancements

When you need persistent storage:
- Add a simple database (PostgreSQL, MongoDB, etc.)
- Create API endpoints for transaction CRUD
- Keep localStorage as fallback/cache
- Sync localStorage with database

## Benefits

✅ No database setup required  
✅ Fast deployment  
✅ Lower infrastructure costs  
✅ Simple architecture  
✅ Easy to understand and maintain  
✅ Works offline (for viewing history)  

## Limitations

⚠️ Transaction history per browser (not synced across devices)  
⚠️ Limited to 50 transactions per user  
⚠️ Clearing browser data loses history  
⚠️ No admin dashboard for monitoring  

For production with multiple users and devices, consider adding a database later.
