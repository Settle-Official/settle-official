# Stellaramp Quick Start Guide

Get up and running with Stellaramp in 5 minutes.

## Prerequisites

- Node.js 18+ installed
- npm or yarn
- Paycrest account ([Sign up here](https://sender.paycrest.io))
- Base wallet with some USDC

## Step 1: Clone & Install

```bash
git clone https://github.com/yourusername/stellaramp-next.git
cd stellaramp-next
npm install
```

## Step 2: Get API Credentials

### Paycrest Setup
1. Go to [Paycrest Sender Dashboard](https://sender.paycrest.io)
2. Sign up and complete KYB
3. Go to Settings → API Keys
4. Copy your API Key
5. Generate a Webhook Secret

### Base Wallet Setup
1. Create a new wallet (MetaMask, etc.)
2. Get the private key
3. Fund it with Base USDC
4. Copy the wallet address

## Step 3: Configure Environment

```bash
# Copy template
cp .env.example .env.local

# Edit with your credentials
nano .env.local
```

Add your credentials:
```bash
PAYCREST_API_KEY=pk_live_xxxxx
PAYCREST_WEBHOOK_SECRET=whsec_xxxxx
BASE_PRIVATE_KEY=0xyour_private_key
BASE_RETURN_ADDRESS=0xyour_wallet_address
BASE_RPC_URL=https://mainnet.base.org
```

## Step 4: Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Step 5: Test the Flow

### Test Quote Generation
1. Enter amount (e.g., "100")
2. See NGN estimate appear
3. Check rate and fees

### Test Account Verification
1. Enter account number (10 digits)
2. Select bank from dropdown
3. See account name appear

### Test API Directly

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

## Step 6: Deploy to Production

### Option A: Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Add environment variables
vercel env add PAYCREST_API_KEY
vercel env add PAYCREST_WEBHOOK_SECRET
vercel env add BASE_PRIVATE_KEY
vercel env add BASE_RETURN_ADDRESS
vercel env add BASE_RPC_URL

# Deploy
vercel --prod
```

### Option B: Docker

```bash
# Build
docker build -t stellaramp .

# Run
docker run -p 3000:3000 \
  -e PAYCREST_API_KEY=xxx \
  -e PAYCREST_WEBHOOK_SECRET=xxx \
  -e BASE_PRIVATE_KEY=xxx \
  -e BASE_RETURN_ADDRESS=xxx \
  -e BASE_RPC_URL=https://mainnet.base.org \
  stellaramp
```

## Step 7: Configure Webhook

1. Go to [Paycrest Dashboard](https://sender.paycrest.io)
2. Navigate to Settings → Webhooks
3. Add webhook URL: `https://yourdomain.com/api/webhooks/paycrest`
4. Save

## Common Issues

### "PAYCREST_API_KEY not configured"
- Check `.env.local` exists
- Restart dev server: `npm run dev`

### "Invalid signature" on webhook
- Verify webhook secret matches dashboard
- Check URL is correct

### "Token transfer failed"
- Check Base wallet has USDC
- Verify private key is correct
- Check RPC URL is accessible

## Next Steps

- Read [Architecture Guide](./OFFRAMP_ARCHITECTURE.md)
- Check [Operations Guide](./OFFRAMP_OPERATIONS.md)
- Review [API Documentation](./README.md#api-endpoints)
- Implement Stellar wallet integration

## Need Help?

- Check [Troubleshooting](./OFFRAMP_OPERATIONS.md#troubleshooting)
- Open a GitHub issue
- Contact support@paycrest.io

## Security Checklist

Before going live:
- [ ] Private keys in server-only env vars
- [ ] Webhook signature verification enabled
- [ ] HTTPS enabled
- [ ] Rate limiting configured
- [ ] Error logging set up
- [ ] Wallet balance monitoring active

## Development Tips

### Hot Reload
Changes to files automatically reload the dev server.

### API Testing
Use tools like Postman or Insomnia for API testing.

### Debugging
Check console logs and Network tab in browser DevTools.

### Environment Variables
Changes to `.env.local` require server restart.

## Resources

- [Paycrest Docs](https://docs.paycrest.io)
- [Allbridge Docs](https://docs-core.allbridge.io)
- [Next.js Docs](https://nextjs.org/docs)
- [Stellar Docs](https://developers.stellar.org)

Happy building! 🚀
