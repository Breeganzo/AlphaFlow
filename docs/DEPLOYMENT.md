# AlphaFlow — Deployment Guide (100% Free)

Step-by-step instructions to deploy AlphaFlow with **zero cost**. Anyone can
follow this from a fresh clone. Total time: ~30 minutes.

**Final architecture:**

| Component | Platform | Cost |
|-----------|----------|------|
| Database | Neon Postgres | Free (0.5 GB) |
| Backend (FastAPI) | Render.com web service | Free (sleeps after 15 min idle) |
| Frontend (React) | Render.com static site | Free |
| CI + Scheduling | GitHub Actions | Free (public repo) |

---

## Prerequisites (free accounts, no credit card)

1. [GitHub](https://github.com) account
2. [Neon](https://neon.tech) account (Postgres)
3. [Render](https://render.com) account
4. [Groq](https://console.groq.com) API key (required — the LLM narrative layer)
5. [Alpaca](https://alpaca.markets) paper account (optional — for live data + paper trading)

---

## Step 1 — Create the Neon Postgres database

1. Sign in to [neon.tech](https://neon.tech) → **New Project**.
2. Name it `alphaflow`, pick a region close to Render (e.g. **US East**).
3. After it's created, go to **Connection Details**.
4. Toggle **Connection pooling ON** and copy the **pooled** connection string.
   It looks like:
   ```
   postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech:5432/neondb?sslmode=require
   ```
   > ⚠️ Use the **-pooler** URL (has `-pooler` in the hostname). This is your
   > `DATABASE_URL`. Save it somewhere safe.

---

## Step 2 — Push the code to GitHub

```bash
cd AlphaFlow
git init
git add .
git commit -m "Initial commit — AlphaFlow"
```

Then create a **public** repo on GitHub and push:
```bash
git remote add origin https://github.com/YOUR_USERNAME/AlphaFlow.git
git branch -M main
git push -u origin main
```

> Public repo = unlimited free GitHub Actions minutes. A private repo works too
> but is capped at 2,000 min/month.

---

## Step 3 — Deploy the backend on Render

1. In Render → **New** → **Blueprint**.
2. Connect your GitHub repo. Render reads `render.yaml` and shows two services
   (`alphaflow-backend`, `alphaflow-frontend`).
3. Click **Apply**. The backend build starts.
4. Go to **alphaflow-backend** → **Environment** and add these variables:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | your Neon pooler URL from Step 1 |
   | `GROQ_API_KEY` | your Groq key |
   | `GROQ_API_KEY_2` | (optional) second Groq key |
   | `ALPACA_API_KEY` | your Alpaca paper key |
   | `ALPACA_SECRET_KEY` | your Alpaca paper secret |

   `SCHEDULER_ENABLED` is already `false` and `ALPACA_BASE_URL` is already set
   in `render.yaml` — leave them.
5. Click **Manual Deploy** → **Deploy latest commit**. On startup, `init_db()`
   creates all tables in Neon automatically.
6. When live, copy the backend URL (e.g. `https://alphaflow-backend.onrender.com`).
7. Verify: open `https://alphaflow-backend.onrender.com/health` — you should see
   `{"status":"ok",...}`.

---

## Step 4 — Point the frontend at the backend

1. In Render → **alphaflow-frontend** → **Environment**.
2. Set `VITE_API_URL` to your backend URL from Step 3.6.
3. **Manual Deploy** → **Deploy latest commit** (env vars are baked in at build
   time for static sites, so a rebuild is required).
4. Open the frontend URL — the dashboard should load and show **API Online**.

---

## Step 5 — Enable scheduling via GitHub Actions

1. In GitHub → your repo → **Settings** → **Secrets and variables** → **Actions**.
2. Add a repository secret:

   | Name | Value |
   |------|-------|
   | `RENDER_BACKEND_URL` | your backend URL (no trailing slash) |

3. (Optional, for CI Postgres tests you don't need to set anything — CI spins up
   its own throwaway Postgres container.)
4. Go to the **Actions** tab. You'll see `Scheduled Signals` and `Keepalive`.
5. Open **Scheduled Signals** → **Run workflow** (manual trigger) to test it.
   It will wake the backend and trigger a pipeline run. Check the backend logs
   in Render to confirm.

That's it. The schedule now runs automatically on weekdays:

| Job | Time (ET) |
|-----|-----------|
| Daily signals | 9:35 AM |
| Hourly signals | 10:35 AM – 4:35 PM |
| Position check | every 10 min during market hours |
| Data refresh | 9:30 PM |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Backend `/health` fails | Check Render logs. Usually a missing env var or a bad `DATABASE_URL`. |
| Frontend shows "API Offline" | `VITE_API_URL` wrong or not rebuilt after setting it (Step 4.3). |
| Cron workflow does nothing | `RENDER_BACKEND_URL` secret missing or has a trailing slash. |
| Scheduled workflow disabled | GitHub disables after 60 days idle — the `keepalive.yml` job prevents this; if it triggered, re-enable in the Actions tab. |
| First cron run slow | Expected. Render cold start (~1 min) + Neon wake (~0.5s). The workflow pre-pings `/health` and waits before triggering. |
| DB tables missing | They're created by `init_db()` on backend startup. Redeploy the backend. |

---

## Local development (no deployment needed)

```bash
pip install -r requirements.txt
cp .env.example .env          # add Groq + Alpaca keys; leave DATABASE_URL unset
uvicorn backend.main:app --reload --port 8002
# second terminal:
cd frontend && npm install && npm run dev
```

With `DATABASE_URL` unset, it runs on local SQLite — no Neon account needed to
develop. Set `SCHEDULER_ENABLED=true` in `.env` for in-process cron locally.
