# Getting Started with Stellaramp

## What You Need

1. **Paycrest Account**
   - Sign up at [sender.paycrest.io](https://sender.paycrest.io)
   - Get your API key
   - Generate webhook secret

2. **Base Wallet**
   - Create a wallet (MetaMask, etc.)
   - Get private key
   - Fund with Base USDC
   - Copy wallet address

3. **Node.js 18+**

## Setup (3 Steps)

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```bash
# Get from Paycrest dashboard
PAYCREST_API_KEY=pk_live_xxxxx
PAYCREST_WEBHOOK_SECRET=whsec_xxxxx

# Your Base wallet (keep private!)
BASE_PRIVATE_KEY=0xyour_private_key_here
BASE_RETURN_ADDRESS=0xyour_wallet_address_here

# RPC endpoint
BASE_RPC_URL=https://mainnet.base.org

# Public (safe to expose)
NEXT_PUBLIC_BASE_RETURN_ADDRESS=0xyour_wallet_address_here
```

### Step 3: Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Test the Flow

1. **Install Wallet**
   - Install [Freighter](https://www.freighter.app/) or [Lobstr](https://lobstr.co/) browser extension
   - Create/import Stellar wallet
   - Fund with Stellar USDC

2. **Connect Wallet**
   - Click "Connect Wallet" button
   - Approve connection in wallet popup

3. **Get Quote**
   - Enter amount (e.g., "100")
   - See NGN estimate

4. **Verify Account**
   - Enter Nigerian bank account number
   - Select bank from dropdown
   - See account name appear

5. **Execute Offramp**
   - Click "Initiate Offramp"
   - Sign transaction in wallet
   - Watch status updates
   - Wait for completion

## Transaction History

Your transactions are stored in browser localStorage:
- View past transactions
- Filter by wallet address
- Persists across page refreshes
- Last 50 transactions kept

## API Testing

Test endpoints directly:

```bash
# Get quote
curl -X POST http://localhost:3000/api/offramp/quote \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "100",
    "token": "USDC",
    "currency": "NGN",
    "network": "base",
    "isFiatInput": false
  }'

# Verify account
curl -X POST http://localhost:3000/api/offramp/verify-account \
  -H "Content-Type: application/json" \
  -d '{
    "institution": "GTB",
    "accountIdentifier": "1234567890"
  }'

# Get banks
curl http://localhost:3000/api/offramp/institutions/NGN
```

## Deploy to Production

### Vercel (Easiest)

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

Add environment variables in Vercel dashboard:
- Settings → Environment Variables
- Add all variables from `.env.local`

### Configure Webhook

1. Go to Paycrest dashboard
2. Settings → Webhooks
3. Add URL: `https://yourdomain.com/api/webhooks/paycrest`
4. Save

## Troubleshooting

### "PAYCREST_API_KEY not configured"
- Check `.env.local` exists
- Restart dev server

### "Wallet not detected"
- Install Freighter or Lobstr extension
- Refresh page

### "Transaction failed"
- Check wallet has USDC
- Check Base wallet has USDC
- Verify private key is correct

### "Invalid signature" on webhook
- Verify webhook secret matches dashboard
- Check URL is correct

## Next Steps

- Read [SIMPLIFIED_ARCHITECTURE.md](./SIMPLIFIED_ARCHITECTURE.md) for architecture details
- Check [OFFRAMP_OPERATIONS.md](./OFFRAMP_OPERATIONS.md) for operations guide
- Review API endpoints in [README.md](./README.md)

## Need Help?

- Paycrest: support@paycrest.io
- Allbridge: [docs-core.allbridge.io](https://docs-core.allbridge.io)
- Stellar: [developers.stellar.org](https://developers.stellar.org)

Happy building! 🚀
