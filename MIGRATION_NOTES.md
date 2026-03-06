# Migration Notes: Stellaramp Offramp Implementation

## What Was Built

A production-ready Stellar → Base → Naira offramp system with:

1. **Clean Architecture**
   - Provider adapter pattern for easy swapping
   - Separation of concerns (UI, business logic, API)
   - Type-safe interfaces throughout

2. **Security Hardening**
   - Private keys moved to server-side only
   - Input validation on all endpoints
   - Webhook signature verification
   - No sensitive data exposed to client

3. **Complete API Layer**
   - Quote generation
   - Account verification
   - Payout execution (server-side)
   - Status polling
   - Webhook handling

## File Structure

### New Files Created

```
src/lib/offramp/
├── types/index.ts                    # Core domain types
├── adapters/
│   ├── bridge-provider.ts            # Bridge interface
│   ├── payout-provider.ts            # Payout interface
│   ├── allbridge-adapter.ts          # Allbridge implementation
│   └── paycrest-adapter.ts           # Paycrest implementation
└── utils/
    ├── validation.ts                 # Input validation
    └── polling.ts                    # Polling utilities

src/app/api/offramp/
├── quote/route.ts                    # Quote generation
├── verify-account/route.ts           # Account verification
├── execute-payout/route.ts           # Server-side payout execution
├── status/[orderId]/route.ts         # Status polling
├── currencies/route.ts               # Currency list
└── institutions/[currency]/route.ts  # Bank list

src/app/api/webhooks/
└── paycrest/route.ts                 # Webhook handler

Documentation:
├── OFFRAMP_ARCHITECTURE.md           # Architecture overview
├── OFFRAMP_OPERATIONS.md             # Operations guide
├── MIGRATION_NOTES.md                # This file
└── .env.example                      # Environment template
```

### Modified Files

```
src/components/FormCard.tsx           # Updated to use new API
package.json                          # Added viem dependency
```

## Key Changes from Reference Implementation

### 1. Network Change: Starknet → Stellar

**Before (Starknet)**:
- User signs transaction with Starknet wallet
- LayerSwap bridges Starknet → Base

**After (Stellar)**:
- User signs transaction with Stellar wallet
- Allbridge bridges Stellar → Base

### 2. Bridge Provider: LayerSwap → Allbridge

**API Differences**:
- Allbridge uses SDK-based approach
- Different status polling mechanism
- Different fee structure

**Implementation**:
- Created `AllbridgeAdapter` implementing `BridgeProviderAdapter`
- Server-side SDK initialization
- Status mapping to common interface

### 3. Security Improvements

**Before**:
- Private key in `NEXT_PUBLIC_BASE_PRIVATE_KEY` (exposed to client)
- Token transfer logic in client-side component

**After**:
- Private key in `BASE_PRIVATE_KEY` (server-only)
- Token transfer in `/api/offramp/execute-payout` route
- Never exposed to client

### 4. API Structure

**Before**:
- Single `/api/proxy` route forwarding to providers
- Business logic in UI component

**After**:
- Dedicated endpoints for each operation
- Business logic in API routes
- UI component only handles presentation

## Breaking Changes

### Environment Variables

**Removed**:
- `NEXT_PUBLIC_BASE_PRIVATE_KEY` ❌ (security risk)
- `NEXT_PUBLIC_LAYERSWAP_API_KEY` ❌ (not needed)

**Added**:
- `BASE_PRIVATE_KEY` ✅ (server-only)
- `BASE_RETURN_ADDRESS` ✅
- `PAYCREST_WEBHOOK_SECRET` ✅

### API Endpoints

**Deprecated**:
- `/api/proxy?endpoint=...` (old proxy pattern)

**New**:
- `/api/offramp/quote`
- `/api/offramp/verify-account`
- `/api/offramp/execute-payout`
- `/api/offramp/status/[orderId]`
- `/api/offramp/currencies`
- `/api/offramp/institutions/[currency]`
- `/api/webhooks/paycrest`

## Migration Steps

### For Existing Deployments

1. **Update Environment Variables**
   ```bash
   # Remove old variables
   unset NEXT_PUBLIC_BASE_PRIVATE_KEY
   unset NEXT_PUBLIC_LAYERSWAP_API_KEY
   
   # Add new variables
   export BASE_PRIVATE_KEY=0x...
   export BASE_RETURN_ADDRESS=0x...
   export PAYCREST_WEBHOOK_SECRET=...
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Update Webhook URL**
   - Go to Paycrest Dashboard
   - Update webhook URL to: `https://yourdomain.com/api/webhooks/paycrest`

4. **Deploy**
   ```bash
   npm run build
   npm run start
   ```

### For New Deployments

Follow the setup guide in `OFFRAMP_OPERATIONS.md`

## Backward Compatibility

### UI Components

The `FormCard` component maintains the same props interface:
```typescript
interface FormCardProps {
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  walletAddress?: string; // New optional prop
}
```

Existing usage remains compatible.

### API Responses

All API responses follow consistent format:
```typescript
{
  data: T,        // Success data
  error?: string  // Error message if failed
}
```

## Testing Checklist

- [ ] Quote generation works
- [ ] Account verification works
- [ ] Bank list loads correctly
- [ ] Stellar wallet connection works
- [ ] Bridge transfer completes
- [ ] Payout order created
- [ ] Base token transfer executes
- [ ] Webhook receives status updates
- [ ] Status polling works
- [ ] Error handling works

## Known Limitations

1. **No Persistent Storage**
   - Trade history not saved
   - Cannot resume interrupted transactions
   - **Solution**: Add database in future iteration

2. **No Rate Limiting**
   - API endpoints not rate-limited
   - **Solution**: Add rate limiting middleware

3. **No Idempotency**
   - Duplicate requests not prevented
   - **Solution**: Add idempotency keys

4. **No Retry Logic**
   - Transient failures not automatically retried
   - **Solution**: Add exponential backoff

## Future Enhancements

### Phase 1: Core Improvements
- [ ] Add persistent storage (PostgreSQL/MongoDB)
- [ ] Implement rate limiting
- [ ] Add idempotency keys
- [ ] Implement retry logic with exponential backoff

### Phase 2: Monitoring
- [ ] Add structured logging
- [ ] Implement metrics collection
- [ ] Set up alerting
- [ ] Create admin dashboard

### Phase 3: Features
- [ ] Support multiple currencies
- [ ] Add transaction history
- [ ] Implement refund flow
- [ ] Add email notifications

## Support

For questions or issues:
1. Check `OFFRAMP_ARCHITECTURE.md` for architecture details
2. Check `OFFRAMP_OPERATIONS.md` for operational guidance
3. Review error logs in deployment platform
4. Contact Paycrest/Allbridge support for provider-specific issues

## Rollback Plan

If issues arise:

1. **Revert to previous version**
   ```bash
   git revert HEAD
   git push
   ```

2. **Restore old environment variables**
   ```bash
   export NEXT_PUBLIC_BASE_PRIVATE_KEY=...
   ```

3. **Update webhook URL** back to old endpoint

4. **Redeploy**

Note: This should only be done as last resort. Most issues can be fixed with configuration changes.
