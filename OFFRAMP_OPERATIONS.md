# Stellaramp Operations Guide

## Environment Setup

### Required Environment Variables

Create a `.env.local` file in the project root with the following variables:

```bash
# Paycrest API Credentials
PAYCREST_API_KEY=your_api_key_from_paycrest_dashboard
PAYCREST_WEBHOOK_SECRET=your_webhook_secret_from_paycrest_dashboard

# Base Network Configuration (CRITICAL: Server-side only)
BASE_PRIVATE_KEY=0x_your_base_wallet_private_key
BASE_RETURN_ADDRESS=0x_your_base_wallet_address
BASE_RPC_URL=https://mainnet.base.org

# Optional: Custom Stellar RPC
STELLAR_RPC_URL=https://horizon.stellar.org
```

### Getting API Credentials

#### Paycrest Setup
1. Visit [Paycrest Sender Dashboard](https://sender.paycrest.io)
2. Sign up as a "sender" and complete KYB process
3. Navigate to Settings to get your API Key
4. Generate a Webhook Secret for signature verification
5. Configure your webhook URL: `https://yourdomain.com/api/webhooks/paycrest`

#### Base Wallet Setup
1. Create a new wallet for server-side operations
2. Fund it with Base USDC for payouts
3. **NEVER** expose this private key to the client
4. Store it securely in environment variables

## Deployment

### Vercel Deployment

1. **Add Environment Variables**
   ```bash
   vercel env add PAYCREST_API_KEY
   vercel env add PAYCREST_WEBHOOK_SECRET
   vercel env add BASE_PRIVATE_KEY
   vercel env add BASE_RETURN_ADDRESS
   vercel env add BASE_RPC_URL
   ```

2. **Deploy**
   ```bash
   vercel --prod
   ```

3. **Configure Webhook**
   - Go to Paycrest Dashboard → Settings
   - Set Webhook URL to: `https://your-domain.vercel.app/api/webhooks/paycrest`

### Security Checklist

- [ ] Private keys are in server-only environment variables
- [ ] No `NEXT_PUBLIC_` prefix on sensitive variables
- [ ] Webhook secret is configured
- [ ] Base wallet is funded with USDC
- [ ] Webhook URL is configured in Paycrest dashboard
- [ ] HTTPS is enabled (required for webhooks)

## Monitoring

### Key Metrics to Track

1. **Quote Generation**
   - Success rate
   - Average response time
   - Error types

2. **Bridge Transfers**
   - Completion rate
   - Average time
   - Failure reasons

3. **Payout Orders**
   - Success rate
   - Average settlement time
   - Refund rate

### Logging

All critical operations are logged:
- Quote generation
- Account verification
- Order creation
- Token transfers
- Status updates

Check logs in your deployment platform (Vercel, etc.)

## Webhook Testing

### Local Testing with ngrok

1. **Start ngrok**
   ```bash
   ngrok http 3000
   ```

2. **Update Paycrest webhook URL**
   - Use ngrok URL: `https://your-ngrok-url.ngrok.io/api/webhooks/paycrest`

3. **Test webhook**
   ```bash
   curl -X POST https://your-ngrok-url.ngrok.io/api/webhooks/paycrest \
     -H "Content-Type: application/json" \
     -H "X-Paycrest-Signature: test_signature" \
     -d '{"event":"payment_order.validated","data":{"id":"test_order"}}'
   ```

## Troubleshooting

### Common Issues

#### 1. "PAYCREST_API_KEY not configured"
- Ensure environment variable is set
- Restart development server after adding env vars
- Check `.env.local` file exists

#### 2. "Invalid signature" on webhook
- Verify webhook secret matches Paycrest dashboard
- Check signature calculation in webhook handler
- Ensure request body is not modified before verification

#### 3. "Token transfer failed"
- Check Base wallet has sufficient USDC
- Verify BASE_PRIVATE_KEY is correct
- Check Base RPC URL is accessible

#### 4. Account verification fails
- Verify bank code is correct
- Check account number is 10 digits
- Ensure Paycrest API key has proper permissions

### Debug Mode

Enable detailed logging:
```typescript
// In API routes
console.log("Debug:", { request, response, error });
```

## Maintenance

### Regular Tasks

1. **Monitor Base Wallet Balance**
   - Check USDC balance weekly
   - Top up when below threshold
   - Set up alerts for low balance

2. **Review Failed Transactions**
   - Check logs for errors
   - Investigate patterns
   - Update error handling as needed

3. **Update Dependencies**
   ```bash
   npm update
   npm audit fix
   ```

4. **Test Webhook Endpoint**
   - Verify webhook is receiving events
   - Check signature verification
   - Monitor response times

### Backup & Recovery

1. **Backup Private Keys**
   - Store securely offline
   - Use hardware wallet if possible
   - Never commit to version control

2. **Database Backups** (when implemented)
   - Regular automated backups
   - Test restore procedures
   - Keep multiple versions

## Support

### Getting Help

1. **Paycrest Support**
   - Email: support@paycrest.io
   - Documentation: https://docs.paycrest.io

2. **Allbridge Support**
   - Documentation: https://docs-core.allbridge.io
   - GitHub: https://github.com/allbridge-public/allbridge-core-js-sdk

### Reporting Issues

When reporting issues, include:
- Error message
- Request/response logs
- Environment (production/staging)
- Steps to reproduce
- Expected vs actual behavior
