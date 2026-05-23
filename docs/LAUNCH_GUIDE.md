# SportsIntel — Launch Guide
## From Zero to Live App in 7 Steps

---

## STEP 1 — Create Your Accounts (Free)

You need accounts at these 4 services:

| Service | URL | What It Does |
|---------|-----|-------------|
| **Supabase** | supabase.com | Database + user auth (free tier) |
| **Stripe** | stripe.com | Payment processing |
| **Sportradar** | developer.sportradar.com | Live sports data |
| **Vercel** | vercel.com | Host the frontend (free tier) |
| **Railway** | railway.app | Host the backend (~$5/mo) |

---

## STEP 2 — Set Up Supabase (Database)

1. Go to **supabase.com** → Create new project
2. Name it `sportsintel`
3. Save your **database password**
4. Go to **SQL Editor** → paste the entire contents of `backend/schema.sql` → Run
5. Go to **Settings → API** and copy:
   - `Project URL` → this is your `SUPABASE_URL`
   - `anon public` key → this is your `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → this is your `SUPABASE_SERVICE_KEY`

---

## STEP 3 — Set Up Stripe (Payments)

1. Go to **stripe.com** → Create account
2. Go to **Products** → Create 4 products:

   | Name | Price | Billing |
   |------|-------|---------|
   | SportsIntel Pro | $4.99 | Monthly |
   | SportsIntel Pro | $3.99 | Yearly |
   | SportsIntel Elite | $9.99 | Monthly |
   | SportsIntel Elite | $7.99 | Yearly |

3. Copy each **Price ID** (starts with `price_...`)
4. Go to **Developers → API Keys** and copy your **Secret Key** (`sk_live_...`) and **Publishable Key** (`pk_live_...`)
5. Go to **Developers → Webhooks** → Add endpoint:
   - URL: `https://your-backend-url.railway.app/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`
   - Copy the **Webhook Secret** (`whsec_...`)

---

## STEP 4 — Get Sportradar API Key

1. Go to **developer.sportradar.com**
2. Sign up → Create an app
3. Subscribe to:
   - **MLB Trial** (free)
   - **NBA Trial** (free)
4. Copy your **API Key**

> Note: Trial keys have rate limits. When you have paying users, upgrade to paid plan (~$150-500/mo depending on usage).

---

## STEP 5 — Deploy the Backend (Railway)

1. Push your code to GitHub
2. Go to **railway.app** → New Project → Deploy from GitHub
3. Select the `sportsintel` repo → set **Root Directory** to `backend`
4. Add all environment variables in Railway dashboard:

```
DATABASE_URL=          (from Supabase → Settings → Database → Connection string)
SUPABASE_URL=          (from Step 2)
SUPABASE_SERVICE_KEY=  (from Step 2)
SPORTRADAR_API_KEY=    (from Step 4)
STRIPE_SECRET_KEY=     sk_live_...
STRIPE_WEBHOOK_SECRET= whsec_...
STRIPE_PRO_MONTHLY_PRICE_ID=    price_...
STRIPE_PRO_YEARLY_PRICE_ID=     price_...
STRIPE_ELITE_MONTHLY_PRICE_ID=  price_...
STRIPE_ELITE_YEARLY_PRICE_ID=   price_...
FRONTEND_URL=          https://sportsintel.vercel.app
JWT_SECRET=            (any random 32-character string)
```

5. Railway will give you a URL like `https://sportsintel-production.railway.app`

---

## STEP 6 — Deploy the Frontend (Vercel)

1. Go to **vercel.com** → New Project → Import from GitHub
2. Set **Root Directory** to `frontend`
3. Add environment variables:

```
VITE_API_URL=               https://sportsintel-production.railway.app
VITE_SUPABASE_URL=          (from Step 2)
VITE_SUPABASE_ANON_KEY=     (from Step 2)
VITE_STRIPE_PUBLISHABLE_KEY= pk_live_...
```

4. Deploy → Vercel gives you a URL like `https://sportsintel.vercel.app`
5. Go back to Railway → update `FRONTEND_URL` to your Vercel URL

---

## STEP 7 — Custom Domain (Optional but Recommended)

1. Buy a domain at **Namecheap** or **Google Domains** (~$12/yr)
   - Suggested: `sportsintel.app`, `getsportsintel.com`
2. In Vercel → Domains → Add your domain
3. Follow DNS instructions

---

## You're Live! 🚀

Your app now has:
- ✅ User signup & login
- ✅ Free tier (scores only)
- ✅ Pro tier ($4.99/mo) — H2H, players, weather
- ✅ Elite tier ($9.99/mo) — all features
- ✅ Stripe checkout & billing portal
- ✅ Automatic daily game refresh
- ✅ Live score updates every 5 min

---

## Revenue Projections

| Users | Free | Pro | Elite | Monthly Revenue |
|-------|------|-----|-------|----------------|
| 100 | 80 | 15 | 5 | ~$125 |
| 500 | 350 | 100 | 50 | ~$1,000 |
| 2,000 | 1,200 | 600 | 200 | ~$5,000 |
| 10,000 | 5,000 | 3,500 | 1,500 | ~$32,500 |

---

## Next Features to Build (v2)

- [ ] Mobile app (React Native)
- [ ] Push notifications for game starts & score alerts
- [ ] Betting lines & odds integration (The Odds API)
- [ ] NHL & Soccer leagues
- [ ] Favorite team dashboard
- [ ] Social sharing (share a game card)
- [ ] Fantasy sports integration

---

## Need Help?

Have a developer? Share this entire `sportsintel/` folder with them.
Everything is wired up — they just need to add the API keys and deploy.

Estimated developer time to launch: **4–8 hours**.
