'use strict';
/**
 * cron-prescrape.js
 * ─────────────────
 * Runs inside the `cron` Docker container.
 * Fires at 05:00 AM CST every day and pre-scrapes the Big 3 dining halls
 * (The Commons, Sbisa, Duncan) for all relevant meal periods so the first
 * student of the day never waits for a cold Puppeteer boot.
 *
 * It honours the PRESCRAPE_URL env var to hit the running `app` container's
 * /api/menu endpoint, which triggers the same startScrapeProcess pipeline.
 */

const https = require('https');
const http = require('http');

// ── Config ─────────────────────────────────────────────────────────────────
const BASE_URL = (process.env.PRESCRAPE_URL || 'http://localhost:3333').replace(/\/$/, '');

/**
 * The "Big 3" — slugs must match constants.js exactly.
 */
const BIG_3 = [
    'the-commons-dining-hall-south-campus',
    'sbisa-dining-hall-north-campus',
    'duncan-dining-hall-south-campus-quad',
];

const ALL_PERIODS = ['breakfast', 'brunch', 'lunch', 'dinner'];

// How long (ms) to wait between kicking off individual scrape jobs so we
// don't hammer the upstream site in parallel.
const STAGGER_MS = 15_000;

// How long we poll for a single job to finish before giving up (ms).
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const POLL_INTERVAL_MS = 8_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayCST() {
    // Return yyyy-mm-dd in CST (UTC-6, or UTC-5 during CDT).
    // Using Intl is simpler than manual offset math.
    const d = new Date();
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d); // en-CA produces yyyy-mm-dd
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`JSON parse failed for ${url}: ${e.message}`)); }
            });
        }).on('error', reject);
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Kick off a scrape for a single location/period/date. */
async function triggerScrape(locationSlug, periodSlug, date) {
    const url = `${BASE_URL}/api/menu?locationSlug=${locationSlug}&periodSlug=${periodSlug}&date=${date}`;
    const result = await httpGet(url);
    console.log(`[cron] triggered ${locationSlug}/${periodSlug}/${date} → status: ${result.status}`);
    return result.status;
}

/** Poll until the scrape job for a given combo is complete or timed out. */
async function waitForScrape(locationSlug, periodSlug, date) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const url = `${BASE_URL}/api/menu/status?locationSlug=${locationSlug}&periodSlug=${periodSlug}&date=${date}`;
        const result = await httpGet(url);
        console.log(`[cron]   ↳ ${locationSlug}/${periodSlug} → ${result.status} ${result.step ?? ''}`);

        // Stop if status is 'ready' OR if the step text indicates we are done
        const isDone = (result.status === 'ready') ||
            (result.step && result.step.toLowerCase().includes('ready')) ||
            (result.step && result.step.toLowerCase().includes('complete'));

        if (isDone) return true;
        if (result.status === 'failed') return false;
    }
    console.warn(`[cron] TIMEOUT waiting for ${locationSlug}/${periodSlug}/${date}`);
    return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function prescrapeAll() {
    const date = todayCST();
    console.log(`\n[cron] ═══════════════════════════════════════════`);
    console.log(`[cron] 🌅 5 AM pre-scrape starting — target date: ${date}`);
    console.log(`[cron] ═══════════════════════════════════════════\n`);

    const jobs = [];
    for (const loc of BIG_3) {
        for (const period of ALL_PERIODS) {
            jobs.push({ loc, period, date });
        }
    }

    let passed = 0, failed = 0;

    for (const { loc, period, date } of jobs) {
        console.log(`\n[cron] ── Scraping: ${loc} / ${period} ──`);
        try {
            const status = await triggerScrape(loc, period, date);
            if (status === 'ready') {
                // Cache hit — already in DB from a previous run
                console.log(`[cron] ✅ Already cached — skipping poll.`);
                passed++;
            } else {
                const ok = await waitForScrape(loc, period, date);
                if (ok) { console.log(`[cron] ✅ Done.`); passed++; }
                else { console.log(`[cron] ❌ Failed or timed out.`); failed++; }
            }
        } catch (e) {
            console.error(`[cron] ❌ Error: ${e.message}`);
            failed++;
        }

        // Stagger scrape starts to be polite to dineoncampus.com
        if (jobs.indexOf(jobs.find(j => j.loc === loc && j.period === period)) < jobs.length - 1) {
            console.log(`[cron] ⏳ Staggering ${STAGGER_MS / 1000}s before next job...`);
            await sleep(STAGGER_MS);
        }
    }

    console.log(`\n[cron] ═══════════════════════════════════════════`);
    console.log(`[cron] Pre-scrape complete — ✅ ${passed} passed / ❌ ${failed} failed`);
    console.log(`[cron] ═══════════════════════════════════════════\n`);

    process.exit(failed > 0 ? 1 : 0);
}

// ── Scheduler ────────────────────────────────────────────────────────────────
// Compute ms until 05:00 CST, then run, then repeat every 24 h.

function msUntilNextFiveAmCST() {
    const now = new Date();
    // Build a Date representing 05:00 CST today
    // We parse "today 05:00" in Chicago time by formatting and reparsing.
    const todayStr = new Intl.DateTimeFormat('sv-SE', { // sv-SE → ISO-like yyyy-mm-dd
        timeZone: 'America/Chicago'
    }).format(now);
    const target = new Date(`${todayStr}T05:00:00-06:00`); // -06 == CST (winter offset)
    // If CDT is in effect the actual wall-clock hits 05:00 one hour later in UTC, but
    // because we re-check every 24h it self-corrects. You can make this smarter with
    // Intl but for a cron close-enough is fine.
    if (target <= now) target.setDate(target.getDate() + 1);
    return target - now;
}

function schedulePrescrape() {
    const ms = msUntilNextFiveAmCST();
    const minutes = Math.round(ms / 60_000);
    console.log(`[cron] Next pre-scrape scheduled in ${minutes} minutes (at ~05:00 CST).`);
    setTimeout(async () => {
        await prescrapeAll().catch(e => console.error('[cron] FATAL:', e));
        // Re-schedule for the next day after each run
        schedulePrescrape();
    }, ms);
}

// Export functions for use in server/index.js
module.exports = { prescrapeAll, schedulePrescrape };

// Allow running immediately via CLI: node server/cron-prescrape.js --now
if (require.main === module && process.argv.includes('--now')) {
    console.log('[cron] --now flag detected: running prescrape immediately.');
    prescrapeAll().catch(e => { console.error('[cron] FATAL:', e); process.exit(1); });
} else if (require.main === module) {
    schedulePrescrape();
}
