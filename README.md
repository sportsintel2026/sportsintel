# WizePicks — Production App

A subscription sports analytics platform with model edges, live scores, H2H stats, player matchups, weather analysis, and expert picks. WizePicks provides sports data and statistical analysis for informational purposes only — it is not a sportsbook and does not accept wagers.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite (inline styles) |
| Backend | Node.js + Express |
| Database | PostgreSQL (via Supabase) |
| Auth | Supabase Auth |
| Payments | Stripe |
| Sports Data | ESPN APIs, The Odds API, MLB StatsAPI |
| Hosting (Frontend) | Vercel |
| Hosting (Backend) | Railway |

## Project Structure
```
wizepicks/
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
git clone https://github.com/sportsintel2026/sportsintel
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
ODDS_API_KEY=your_odds_api_key
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

## Subscription
| Tier | Price | Features |
|------|-------|---------|
| Free | $0 | Today's scores, basic standings, locked previews |
| All-Access | $7/mo | All model edges, HR props, full game analysis, expert picks, all leagues, no ads |

Admins are auto-surfaced as full-access ("elite") via the subscriptions table.

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
1. **The Odds API** — https://the-odds-api.com (betting lines)
2. **Stripe** — https://dashboard.stripe.com
3. **Supabase** — https://supabase.com (free tier available)

Note: ESPN public APIs and MLB StatsAPI require no key.
