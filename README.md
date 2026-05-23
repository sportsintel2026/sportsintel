# SportsIntel — Production App

A subscription sports intelligence platform with live scores, H2H stats, player matchups, and weather analysis.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TailwindCSS |
| Backend | Node.js + Express |
| Database | PostgreSQL (via Supabase) |
| Auth | Supabase Auth |
| Payments | Stripe |
| Sports Data | Sportradar API |
| Hosting (Frontend) | Vercel |
| Hosting (Backend) | Railway or Render |

## Project Structure

```
sportsintel/
├── frontend/          # React web app
│   └── src/
│       ├── components/  # UI components
│       ├── pages/       # Route pages
│       ├── hooks/       # Custom React hooks
│       └── lib/         # API clients, helpers
├── backend/           # Node.js API server
│   ├── routes/          # API endpoints
│   ├── middleware/      # Auth, rate limiting
│   └── services/        # Sports data, Stripe, DB
└── docs/              # Architecture & API docs
```

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/yourname/sportsintel
cd sportsintel

# Install backend deps
cd backend && npm install

# Install frontend deps
cd ../frontend && npm install
```

### 2. Set Environment Variables

**Backend** (`backend/.env`):
```
DATABASE_URL=your_supabase_postgres_url
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
SPORTRADAR_API_KEY=your_sportradar_key
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
JWT_SECRET=your_random_secret_string
PORT=4000
```

**Frontend** (`frontend/.env`):
```
VITE_API_URL=http://localhost:4000
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### 3. Set Up Database
```bash
cd backend
npm run db:migrate
```

### 4. Run Locally
```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

App runs at `http://localhost:5173`

## Subscription Tiers

| Tier | Price | Features |
|------|-------|---------|
| Free | $0 | Today's scores, basic standings |
| Pro | $4.99/mo | H2H records, player stats vs opponent, weather |
| Elite | $9.99/mo | All leagues, betting lines, push notifications, no ads |

## Deployment

### Frontend → Vercel
```bash
cd frontend
npx vercel --prod
```

### Backend → Railway
1. Connect GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push

## API Keys You Need

1. **Sportradar** — https://developer.sportradar.com (free trial available)
2. **Stripe** — https://dashboard.stripe.com
3. **Supabase** — https://supabase.com (free tier available)
