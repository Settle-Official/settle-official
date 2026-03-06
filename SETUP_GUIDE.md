# Stellaramp Setup Guide

## Quick Setup (5 minutes)

### 1. Install Dependencies ✅

```bash
npm install
```

### 2. Setup Database

You have two options:

#### Option A: Use SQLite (Quick Testing)

For quick testing without PostgreSQL:

```bash
# Update prisma/schema.prisma
# Change: provider = "postgresql"
# To: provider = "sqlite"
# Change: url = env("DATABASE_URL")
# To: url = "file:./dev.db"

# Then run:
npx prisma migrate dev --name init
```

#### Option B: Use PostgreSQL (Production)

1. **Install PostgreSQL** (if not installed):
   ```bash
   # Ubuntu/Debian
   sudo apt install postgresql postgresql-contrib
   
   # macOS
   brew install postgresql
   brew services start postgresql
   ```

2. **Create Database**:
   ```bash
   # Connect to PostgreSQL
   psql postgres
   
   # Create database
   CREATE DATABASE stellaramp;
   
   # Create user (optional)
   CREATE USER stellaramp_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE stellaramp TO stellaramp_user;
   
   # Exit
   \q
   ```

3. **Configure Environment**:
   ```bash
   # Add to .env.local
   DATABASE_URL="postgresql://stellaramp_user:your_password@localhost:5432/stellaramp"
   ```

4. **Run Migrations**:
   ```bash
   npx prisma migrate dev --name init
   ```

### 3. Configure Environment Variables

Create `.env.local`:

```bash
# Paycrest API
PAYCREST_API_KEY=your_paycrest_api_key
PAYCREST_WEBHOOK_SECRET=your_webhook_secret

# Base Network (Server-side only)
BASE_PRIVATE_KEY=0xyour_base_private_key
BASE_RETURN_ADDRESS=0xyour_base_return_address
BASE_RPC_URL=https://mainnet.base.org

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/stellaramp"

# Public (Client-side)
NEXT_PUBLIC_BASE_RETURN_ADDRESS=0xyour_base_return_address
```

### 4. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Testing the System

### 1. Install Stellar Wallet

Choose one:
- **Freighter**: https://freighter.app
- **Lobstr**: https://lobstr.co

### 2. Get Test USDC

For testing on Stellar testnet:
1. Create testnet account: https://laboratory.stellar.org/#account-creator
2. Get test USDC from friendbot

### 3. Test the Flow

1. **Connect Wallet**
   - Click "Connect Wallet"
   - Approve in Freighter/Lobstr

2. **Enter Details**
   - Amount: 100 USDC
   - Account Number: 1234567890
   - Select Bank: GTB

3. **Initiate Offramp**
   - Click "Initiate Offramp"
   - Sign transaction in wallet
   - Watch status updates

## Database Management

### View Data

```bash
npm run db:studio
```

Opens Prisma Studio at http://localhost:5555

### Reset Database

```bash
npx prisma migrate reset
```

### Create New Migration

```bash
npx prisma migrate dev --name your_migration_name
```

## Troubleshooting

### "Prisma Client not generated"

```bash
npx prisma generate
```

### "Database connection failed"

Check:
- PostgreSQL is running: `sudo service postgresql status`
- DATABASE_URL is correct
- Database exists: `psql -l`

### "Wallet not found"

Install wallet extension:
- Freighter: https://freighter.app
- Lobstr: https://lobstr.co

### "Failed to build transaction"

Check:
- Wallet is connected
- Amount is valid
- Allbridge SDK is installed

## Production Deployment

### 1. Setup Production Database

Use managed PostgreSQL:
- **Supabase**: https://supabase.com (Free tier available)
- **Railway**: https://railway.app
- **Neon**: https://neon.tech

Get connection string and add to environment variables.

### 2. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

### 3. Add Environment Variables

In Vercel dashboard, add all variables from `.env.local`

### 4. Run Migrations

```bash
# After deployment
vercel env pull .env.production
npx prisma migrate deploy
```

### 5. Configure Webhook

In Paycrest dashboard:
- Webhook URL: `https://yourdomain.vercel.app/api/webhooks/paycrest`

## Development Tips

### Hot Reload

Changes to files automatically reload the dev server.

### API Testing

Use curl or Postman:

```bash
# Test quote
curl -X POST http://localhost:3000/api/offramp/quote \
  -H "Content-Type: application/json" \
  -d '{"amount":"100","token":"USDC","currency":"NGN","network":"base","isFiatInput":false}'

# Test account verification
curl -X POST http://localhost:3000/api/offramp/verify-account \
  -H "Content-Type: application/json" \
  -d '{"institution":"GTB","accountIdentifier":"1234567890"}'
```

### View Logs

```bash
# Development
npm run dev

# Check console for logs
```

### Database Queries

```bash
# Open Prisma Studio
npm run db:studio

# Or use psql
psql stellaramp
SELECT * FROM "Trade";
```

## Next Steps

1. ✅ Setup complete
2. ✅ Database configured
3. ✅ Wallet installed
4. ✅ Test offramp flow
5. 🚀 Deploy to production

## Support

- **Documentation**: Check README.md and other docs
- **Issues**: Open GitHub issue
- **Paycrest**: support@paycrest.io
- **Allbridge**: https://docs-core.allbridge.io

Happy building! 🚀
