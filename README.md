# Trading Intelligence Database V3

A deployable AI trading journal built for:

- Vercel frontend
- Railway FastAPI backend
- Neon Postgres database
- pgvector similarity search
- Cloudflare R2 permanent file storage
- OpenAI chart analysis + embeddings

This version is designed around the system you described:

1. Upload a premarket chart.
2. Upload the screenshot of the trade you actually took.
3. Upload the screenshot of the ideal trade that day.
4. Upload a CSV with the trade data.
5. Keep every detail editable.
6. Let AI analyze every piece.
7. Find similar previous days.
8. Permanently link similar days together.
9. Build a personal trading intelligence database from your own history.

---

## Folder Structure

```txt
trading_journal_v3/
  backend/
    app/
      main.py
      db.py
      ai.py
      storage.py
    requirements.txt
    .env.example
    railway.json
    Procfile
  frontend/
    src/
      main.jsx
      style.css
    package.json
    .env.example
    index.html
```

---

## What Works Now

### Editable Trading Day Records

Each day stores:

- Date
- Title
- Tickers
- Strategy
- Session
- Market bias
- Premarket notes
- Trade taken notes
- Ideal trade notes
- Lessons
- Tags
- Mood
- Rule-following score
- AI summary
- AI setup tags
- AI market structure JSON
- AI execution review JSON
- Custom fields JSON

### Uploads

Each day supports:

- Premarket screenshot
- Actual trade screenshot
- Ideal trade screenshot
- CSV trade data
- Other files

Files are stored in Cloudflare R2, not on Railway's temporary container filesystem.

### AI Intelligence

When OpenAI is enabled, the backend can:

- Analyze uploaded chart screenshots
- Extract market structure notes
- Generate setup tags
- Summarize each trading day
- Compare actual trade vs ideal trade
- Create embeddings for similarity search
- Find similar days using pgvector
- Permanently save similar-day links

### Pattern Library

The backend includes database tables and endpoints for a playbook/pattern library:

- Create patterns
- Link days to patterns
- Track confidence
- Track notes

---

# Local Setup

## 1. Backend

Open PowerShell inside the project:

```powershell
cd trading_journal_v3\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env` and fill in:

```env
DATABASE_URL=your_neon_database_url
OPENAI_API_KEY=your_openai_key
CORS_ORIGINS=http://localhost:5173
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET=trading-journal
R2_PUBLIC_BASE_URL=
```

Then run:

```powershell
uvicorn app.main:app --reload
```

Backend URL:

```txt
http://127.0.0.1:8000
```

Check health:

```txt
http://127.0.0.1:8000/health
```

You should see:

```json
{
  "ok": true,
  "ai_enabled": true,
  "r2_enabled": true
}
```

---

## 2. Frontend

Open a second PowerShell window:

```powershell
cd trading_journal_v3\frontend
npm install
copy .env.example .env
npm run dev
```

Frontend URL:

```txt
http://localhost:5173
```

---

# Neon Setup

1. Go to Neon.
2. Create a new project.
3. Copy the pooled or direct connection string.
4. Put it in backend `.env` as `DATABASE_URL`.
5. Make sure the connection string includes SSL, usually:

```txt
?sslmode=require
```

The app automatically runs:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

That enables pgvector.

Tables are created automatically when the Railway/FastAPI backend starts.

---

# Cloudflare R2 Setup

## 1. Create Bucket

1. Go to Cloudflare dashboard.
2. Go to R2 Object Storage.
3. Create a bucket named:

```txt
trading-journal
```

## 2. Get Account ID

Cloudflare R2 uses this endpoint format:

```txt
https://ACCOUNT_ID.r2.cloudflarestorage.com
```

Find your Account ID in the Cloudflare dashboard and add it to:

```env
R2_ACCOUNT_ID=
```

## 3. Create R2 API Token

Create an R2 token with access to your bucket.

You need:

```env
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

## 4. Optional Public URL

You can leave this blank:

```env
R2_PUBLIC_BASE_URL=
```

If blank, the backend generates temporary signed file URLs.

Later, if you connect a custom domain or public bucket URL, add it here.

Example:

```env
R2_PUBLIC_BASE_URL=https://files.yourdomain.com
```

---

# Railway Backend Deployment

## 1. Push Project to GitHub

From the root folder:

```powershell
git init
git add .
git commit -m "Trading Intelligence Database V3"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## 2. Create Railway Service

1. Go to Railway.
2. New Project.
3. Deploy from GitHub repo.
4. Select the repo.
5. Set the root directory to:

```txt
backend
```

## 3. Add Railway Variables

In Railway service variables, add:

```env
DATABASE_URL=your_neon_database_url
OPENAI_API_KEY=your_openai_api_key
CORS_ORIGINS=http://localhost:5173,https://your-vercel-url.vercel.app
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET=trading-journal
R2_PUBLIC_BASE_URL=
```

Deploy.

After deployment, open the Railway URL and test:

```txt
https://your-railway-app.up.railway.app/health
```

---

# Vercel Frontend Deployment

## 1. Import Project

1. Go to Vercel.
2. Add New Project.
3. Import the GitHub repo.
4. Set root directory to:

```txt
frontend
```

## 2. Set Build Settings

Vercel should detect Vite automatically.

Use:

```txt
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

## 3. Add Environment Variable

In Vercel project settings, add:

```env
VITE_API_BASE_URL=https://your-railway-app.up.railway.app
```

Deploy.

## 4. Update Railway CORS

After Vercel gives you the final frontend URL, update Railway:

```env
CORS_ORIGINS=http://localhost:5173,https://your-vercel-url.vercel.app
```

Redeploy Railway.

---

# How to Use the App

## Daily Workflow

1. Create a new trading day.
2. Fill in date, tickers, bias, strategy, notes, tags.
3. Save.
4. Upload premarket screenshot.
5. Upload actual trade screenshot.
6. Upload ideal trade screenshot.
7. Upload trade CSV.
8. Click `Run Intelligence`.
9. Click `Find Similar Days`.
10. Review linked similar days.

---

# What AI Looks At

The AI layer references:

- Manual notes
- Premarket screenshot description
- Actual trade screenshot description
- Ideal trade screenshot description
- CSV rows
- Tags
- Lessons
- Market bias
- Prior AI summaries
- Similar-day embeddings

---

# Important Notes

## This is not financial advice

The AI is only helping organize and compare your own journal history. It should not be treated as a signal provider or trading recommendation engine.

## Screenshots are stored in R2

That means your files are not lost when Railway redeploys.

## Neon stores your metadata

Neon stores the database records, AI observations, embeddings, CSV rows, and similar-day links.

## OpenAI costs money

Screenshot analysis and embeddings use the OpenAI API. If you leave `OPENAI_API_KEY` blank, the app still works as a manual journal, but AI analysis and similarity search will be limited.

---

# Future Upgrades

Recommended next upgrades:

1. Login/authentication.
2. Private user accounts.
3. Advanced trade statistics dashboard.
4. R-multiple calculations.
5. Equity curve.
6. Calendar heatmap.
7. CSV broker-specific normalization.
8. Manual chart annotation tools.
9. Pattern library UI.
10. AI coach chat that references your entire journal.
11. Export/backup button.
12. Mobile-first upload flow.
13. Screenshot side-by-side: premarket vs actual vs ideal.
14. Similar-day graph view.
15. Mistake recurrence tracker.

---

# Troubleshooting

## `/health` says r2_enabled false

Your R2 variables are missing or incorrect.

Check:

```env
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

## `/health` says ai_enabled false

Your OpenAI key is missing.

Check:

```env
OPENAI_API_KEY
```

## Upload fails

Usually this means:

- R2 token does not have bucket access
- Bucket name is wrong
- Account ID is wrong
- Railway variables were added but app was not redeployed

## Frontend cannot reach backend

Check:

- `VITE_API_BASE_URL` in Vercel
- `CORS_ORIGINS` in Railway
- Railway backend URL is correct
- Backend `/health` URL works

## Neon connection fails

Check:

- `DATABASE_URL` is correct
- SSL mode is included
- The Neon database is active
- Password has no unescaped special characters

