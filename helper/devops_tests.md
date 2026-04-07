# DevOps / Infrastructure Tests
**Aggie Dining Tracker — Build4Good**

This document is the handoff guide for the Infrastructure & Bypassing team.
It lists every test, how to run it, what passing looks like, how to troubleshoot
it, and exactly what to share back when asking for help.

---

## 0 — Quick Reference: Files Added This Sprint

| File | Purpose |
|---|---|
| `dining-tracker/Dockerfile` | Multi-stage build using the official Puppeteer base image (Chrome included) |
| `dining-tracker/.dockerignore` | Keeps secrets and node_modules out of the image |
| `dining-tracker/docker-compose.yml` | Runs `app` + `cron` containers sharing a SQLite volume |
| `dining-tracker/fly.toml` | One-file Fly.io deployment config (region: `dfw`) |
| `dining-tracker/server/cron-prescrape.js` | 5 AM CST pre-scraper for the Big 3 dining halls |
| `dining-tracker/server/scraper.js` | Updated with proxy rotation + 12-UA pool |

---

## Test T-01 — Docker Image Builds Successfully

**What it tests:** The `Dockerfile` resolves all dependencies and Chrome is reachable.

**Command:**
```bash
cd dining-tracker
docker build -t aggie-dining-tracker .
```

**Passing output (last few lines):**
```
Successfully built <image-id>
Successfully tagged aggie-dining-tracker:latest
```

**Failure modes & fixes:**

| Symptom | Likely Cause | Fix |
|---|---|---|
| `COPY failed: file not found` | Running the build from the wrong directory | Must `cd dining-tracker` first |
| `npm ci` fails with 401 | Private registry credentials needed | None needed — all packages are public |
| `ghcr.io/puppeteer/puppeteer:22: pull access denied` | Docker not logged into GHCR | Run `docker login ghcr.io` with a GitHub PAT, or switch to `FROM node:20-slim` and install Chrome manually |
| Build exits with error about `better-sqlite3` | Native addon needs `python3` / `make` | These are in the base image; if still failing, confirm `NODE_ENV` is not `production` during build or use `--ignore-scripts=false` |

**What to share back:**
```
Full terminal output of the failed `docker build` command (the last 30 lines at minimum).
```

---

## Test T-02 — Container Starts & Health Check Passes

**What it tests:** The Express server comes up and `/api/auth/config` returns 200.

**Commands:**
```bash
# Copy your real .env values in first; never commit secrets
cp .env .env.local  # edit .env.local if you need cloud-specific overrides

docker run -d \
  --name aggie-test \
  --env-file .env \
  -p 3333:3333 \
  -v dining_test_data:/app/data \
  aggie-dining-tracker

# Wait 10 seconds then check health
sleep 10
docker inspect --format='{{.State.Health.Status}}' aggie-test
curl -s http://localhost:3333/api/auth/config
```

**Passing output:**
```
healthy
{"googleClientId":"117560740239-..."}
```

**Failure modes & fixes:**

| Symptom | Likely Cause | Fix |
|---|---|---|
| `unhealthy` / no response | Server crashed on startup | `docker logs aggie-test` — look for "Error" on the last lines |
| `address already in use 3333` | Another process owns port 3333 | `lsof -i :3333` then kill it, or change host port: `-p 3334:3333` |
| `{"error":"..."}` on `/api/auth/config` | `GOOGLE_CLIENT_ID` not set in env | Check your `.env` file has all three vars |
| Container exits immediately | Missing `--env-file` or bad path | Check `docker logs aggie-test --tail 20` |

**Cleanup:**
```bash
docker rm -f aggie-test
docker volume rm dining_test_data
```

**What to share back:**
```
Output of:
  docker logs aggie-test --tail 40
  docker inspect --format='{{json .State}}' aggie-test
```

---

## Test T-03 — Docker Compose (App + Cron) Starts Together

**What it tests:** Both the `app` and `cron` containers start, the cron waits for the app to be healthy, and they share the SQLite volume.

**Commands:**
```bash
# The compose file reads from .env automatically
docker compose up -d
sleep 25  # give the app time to pass health checks

docker compose ps
docker compose logs app --tail 10
docker compose logs cron --tail 10
```

**Passing output of `docker compose ps`:**
```
NAME                    COMMAND                 SERVICE  STATUS     PORTS
aggie-dining-app        "node server/index.…"  app      running    0.0.0.0:3333->3333/tcp
aggie-dining-cron       "node server/cron-p…"  cron     running
```

**Failure modes & fixes:**

| Symptom | Likely Cause | Fix |
|---|---|---|
| `cron` exits right away | App container not healthy yet, cron script failed | `docker compose logs cron` — look for HTTP errors connecting to `http://app:3333` |
| `app` keeps restarting | Env var missing or DB permission issue | `docker compose logs app --tail 30` |
| Volume mount error | Docker Desktop disk space full | Prune unused volumes: `docker system prune -f --volumes` |

**What to share back:**
```
Output of:
  docker compose ps
  docker compose logs app --tail 30
  docker compose logs cron --tail 30
```

---

## Test T-04 — Scraper Uses a Different User-Agent Each Run

**What it tests:** The UA rotation pool is working — each scrape request goes out with a different browser fingerprint.

**Command:**
```bash
# While the app is running, curl the menu endpoint twice and watch server logs
curl "http://localhost:3333/api/menu?locationSlug=the-commons-dining-hall-south-campus&periodSlug=lunch&date=2025-08-01"
# Wait for it to scrape then curl again for another location
curl "http://localhost:3333/api/menu?locationSlug=sbisa-dining-hall-north-campus&periodSlug=lunch&date=2025-08-01"
```

**What to look for in `docker compose logs app -f`:**
```
[Scraper] UA: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...
# Second call should show a DIFFERENT UA
[Scraper] UA: Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1...
```

**Failure modes & fixes:**

| Symptom | Likely Cause | Fix |
|---|---|---|
| Always the same UA | Old scraper.js deployed without changes | Rebuild: `docker compose build --no-cache` then `docker compose up -d` |
| `[Scraper] UA:` line never appears | Server is returning cached data; no new scrape triggered | Delete the scrape job from the DB or use a future date |

**What to share back:**
```
The 10 lines of server logs immediately after hitting /api/menu including the "[Scraper] UA:" line.
```

---

## Test T-05 — Proxy Rotation Wires Through (Optional)

**What it tests:** When `PROXY_LIST` is set, each browser launch routes through a different proxy.

> [!NOTE]
> This test requires you to have at least one working proxy URL. A free test proxy can be found at https://free-proxy-list.net/ but they are unreliable. For production, use Bright Data, Oxylabs, or WebShare.

**Commands:**
```bash
# Set a dummy proxy list and watch for the log line
PROXY_LIST="http://user:pass@testproxy.example.com:8080" \
  docker run --rm \
  --env-file .env \
  -e PROXY_LIST="http://user:pass@testproxy.example.com:8080" \
  -p 3334:3333 \
  -v dining_proxy_test:/app/data \
  aggie-dining-tracker &

sleep 10
curl "http://localhost:3334/api/menu?locationSlug=the-commons-dining-hall-south-campus&periodSlug=lunch&date=2025-09-01"
docker logs $(docker ps -q --filter "publish=3334") 2>&1 | grep "proxy"
```

**Passing log output:**
```
[Scraper] Using proxy: http://user:***@testproxy.example.com:8080
```

**Failure modes & fixes:**

| Symptom | Likely Cause | Fix |
|---|---|---|
| `ERR_PROXY_CONNECTION_FAILED` in scraper error | Proxy is wrong/dead | Verify the proxy URL is reachable: `curl -x http://user:pass@proxy:port https://httpbin.org/ip` |
| `[Scraper] Using proxy:` line never appears | `PROXY_LIST` env var not passed into container | Check `docker inspect <container>` → `Env` section |
| Page loads but shows Cloudflare block | Proxy IP is already flagged | Rotate to a different provider or use residential proxies |

**What to share back:**
```
Output of:
  docker inspect <container-id> | grep -A 20 '"Env"'
  The "[Scraper] Using proxy:" or "[Scraper] UA:" lines from docker logs
  The status field returned by /api/menu (e.g. "scraping" / "ready" / error message)
```

---

## Test T-06 — 5 AM Cron Pre-Scrape Runs Immediately (--now flag)

**What it tests:** The cron script fires correctly and pre-warms all 3 dining halls × 4 meal periods = 12 scrape jobs.

**Prerequisite:** The `app` container must be running on port 3333.

**Command:**
```bash
# Trigger immediately without waiting for 5 AM
docker run --rm \
  --network dining-tracker_default \
  -e PRESCRAPE_URL=http://aggie-dining-app:3333 \
  aggie-dining-tracker \
  node server/cron-prescrape.js --now
```

*(If running locally without Docker:)*
```bash
cd dining-tracker
PRESCRAPE_URL=http://localhost:3333 node server/cron-prescrape.js --now
```

**Passing output:**
```
[cron] ═══════════════════════════════════════════
[cron] 🌅 5 AM pre-scrape starting — target date: 2025-08-01
[cron] ═══════════════════════════════════════════

[cron] ── Scraping: the-commons-dining-hall-south-campus / breakfast ──
[cron] triggered the-commons-dining.../breakfast/2025-08-01 → status: scraping
[cron]   ↳ the-commons-dining.../breakfast → scraping Launching internal browser...
...
[cron] ✅ Done.
...
[cron] Pre-scrape complete — ✅ 12 passed / ❌ 0 failed
```

**Failure modes & fixes:**

| Symptom | Likely Cause | Fix |
|---|---|---|
| `ECONNREFUSED` when connecting to `http://aggie-dining-app:3333` | Wrong network name or container not running | Run `docker network ls` and use the actual network name. Replace `--network` value. |
| All jobs show `❌ Failed or timed out` | Puppeteer can't launch Chrome in this container | See T-01 and T-02 first |
| `✅ Already cached — skipping poll` for all | Today's data already scraped | Use a future date in `todayCST()` or temporarily hardcode in the script |
| Only 0 passed, all failed | dineoncampus.com is blocking the IP | Add a proxy via `PROXY_LIST` (see T-05) |

**What to share back:**
```
Full terminal output of the --now run.
The line: "[cron] Pre-scrape complete — ✅ N passed / ❌ M failed"
Any "[cron] ❌ Error: ..." lines.
```

---

## Test T-07 — Fly.io Deployment

**What it tests:** The app deploys to Fly.io, is reachable at the public URL, and secrets are correctly injected.

**Prerequisites:**
- `flyctl` installed: `brew install flyctl`
- Logged in: `fly auth login`

**Commands:**
```bash
cd dining-tracker

# Create the app (one-time; skip if already exists)
fly apps create aggie-dining-tracker

# Create the persistent volume (one-time)
fly volumes create dining_data --region dfw --size 1

# Set secrets (never put real values in fly.toml)
fly secrets set \
  JWT_SECRET="<your-jwt-secret>" \
  GOOGLE_CLIENT_ID="<your-google-client-id>"

# Deploy
fly deploy

# Check deployment status
fly status
fly logs
```

**Passing `fly status` output:**
```
App
  Name     = aggie-dining-tracker
  ...
Machines
ID           PROCESS  VERSION  REGION  STATE    HEALTH CHECKS        LAST UPDATED
...          app      1        dfw     started  1 total, 1 passing   ...
```

**Test the live endpoint:**
```bash
curl https://aggie-dining-tracker.fly.dev/api/auth/config
# Expected: {"googleClientId":"..."}
```

**Failure modes & fixes:**

| Symptom | Likely Cause | Fix |
|---|---|---|
| `Error: No volume named 'dining_data'` | Volume not created | `fly volumes create dining_data --region dfw --size 1` |
| Machine stuck in `starting` | Chrome OOM-killed — not enough RAM | The `fly.toml` already sets `memory = "1gb"`. Verify with `fly scale show`. If still failing, try `fly scale memory 2048` |
| Health check `failing` | App crashes at startup | `fly logs` — look for missing env vars or DB errors |
| `secrets` not reflected | Fly deployment cached old image | `fly deploy --no-cache` |
| Google OAuth fails on fly.dev | OAuth redirect URI not whitelisted | Add `https://aggie-dining-tracker.fly.dev` to Google Cloud Console → Credentials → Authorized redirect URIs |

**What to share back:**
```
Output of:
  fly status
  fly logs --tail 50
  curl https://aggie-dining-tracker.fly.dev/api/auth/config
```

---

## Test T-08 — SQLite Volume Persists Across Restart

**What it tests:** Restarting the container doesn't wipe the database (scraped menus and user accounts survive).

**Commands:**
```bash
# 1. After app is running, log a scrape
curl "http://localhost:3333/api/menu?locationSlug=the-commons-dining-hall-south-campus&periodSlug=lunch&date=2025-08-01"
# Wait ~60s for scrape to finish
sleep 65
curl "http://localhost:3333/api/menu?locationSlug=the-commons-dining-hall-south-campus&periodSlug=lunch&date=2025-08-01"
# Should return {"status":"ready",...}

# 2. Restart the container
docker compose restart app
sleep 15

# 3. Check the same endpoint — should still be "ready" (from DB, no re-scrape)
curl "http://localhost:3333/api/menu?locationSlug=the-commons-dining-hall-south-campus&periodSlug=lunch&date=2025-08-01"
```

**Passing output of step 3:**
```json
{"status":"ready","stations":[...]}
```

**Failure modes & fixes:**

| Symptom | Likely Cause | Fix |
|---|---|---|
| `{"status":"not_found"}` after restart | Volume not mounted / wrong volume name | `docker volume ls` — look for `dining-tracker_dining_data`. If missing, check `docker-compose.yml` |
| `database is locked` errors | Two processes writing at once | SQLite WAL mode — confirm only one container writes (there should be one `app` container) |

**What to share back:**
```
Output of all three curl calls (steps 1, end of wait, and step 3).
Output of: docker volume ls | grep dining
```

---

## Debugging Checklist

When reporting any issue, always include:

1. **Which test failed** (T-01 through T-08)
2. **Exact command run** (copy-paste, not paraphrased)
3. **Full terminal output** of the failure
4. **Environment info:**
   ```bash
   docker --version
   docker compose version
   node --version
   uname -a   # or `sw_vers` on Mac
   ```
5. **Container logs** (if applicable):
   ```bash
   docker compose logs app --tail 50
   docker compose logs cron --tail 50
   ```
6. **Whether the issue is reproducible** after `docker compose down && docker compose up -d`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Fly.io / Docker Compose                                         │
│                                                                  │
│  ┌──────────────────┐     shared volume    ┌─────────────────┐  │
│  │   app container  │ ───────menus.db───── │  cron container │  │
│  │  Express :3333   │                      │  5 AM prescrape │  │
│  │  Puppeteer+UA    │                      │  --now flag     │  │
│  │  Proxy rotation  │                      └─────────────────┘  │
│  └──────────────────┘                                           │
│           │                                                      │
│    PROXY_LIST env var (optional)                                 │
│    → random proxy per scrape job                                 │
│    → random User-Agent per scrape job                            │
└─────────────────────────────────────────────────────────────────┘
          │
   dineoncampus.com/tamu
```
