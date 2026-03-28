const express = require('express');
const cors = require('cors');
const path = require('path');
const { LOCATIONS, PERIODS, getCurrentPeriod, getDefaultLocation, scrapeMenu, parseSavedHtml } = require('./scraper');
const { getMenu, saveMenu, getJob, upsertJob } = require('./db');

const app = express();
const PORT = 3333;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Helpers ──────────────────────────────────────────

function menuKey(locationSlug, periodSlug, date) {
    return `${locationSlug}:${periodSlug}:${date}`;
}

// Kick off a background scrape (non-blocking) and store result in DB
async function triggerScrape(locationSlug, periodSlug, date) {
    const key = menuKey(locationSlug, periodSlug, date);
    const existing = getJob(key);

    // Don't re-start if already in progress
    if (existing && existing.status === 'pending') return;

    upsertJob(key, 'pending', null, null, 'Initializing...');

    // Run in background (don't await)
    (async () => {
        const setStep = (step) => upsertJob(key, 'pending', null, null, step);
        try {
            console.log('[Scrape] Starting:', key);
            const stations = await scrapeMenu(locationSlug, periodSlug, date, setStep);

            if (stations.length > 0) {
                saveMenu(locationSlug, periodSlug, date, stations);
                upsertJob(key, 'done', null, Date.now(), 'Success');
                console.log('[Scrape] Done:', key, `(${stations.length} stations)`);
            } else {
                // Weekend Lunch -> Brunch check
                const isWeekend = new Date(date + 'T12:00:00').getDay() % 6 === 0;
                if (periodSlug === 'lunch' && isWeekend) {
                    console.log('[Scrape] Lunch empty on weekend, trying brunch for:', key);
                    setStep('Retrying with "Brunch" slug for weekend...');
                    const brunchStations = await scrapeMenu(locationSlug, 'brunch', date, setStep);
                    if (brunchStations.length > 0) {
                        saveMenu(locationSlug, periodSlug, date, brunchStations);
                        upsertJob(key, 'done', null, Date.now(), 'Success (Brunch)');
                        return;
                    }
                }
                // Mark as done but with error so user can't just keep triggering
                upsertJob(key, 'done', 'No items found on page.', Date.now(), 'Finished (Empty)');
                console.log('[Scrape] Finished with 0 items:', key);
            }
        } catch (err) {
            console.error('[Scrape] Error:', key, err.message);

            // Fallback: if Commons+dinner combo, use saved HTML file
            if (locationSlug.includes('commons') && periodSlug === 'dinner') {
                const stations = parseSavedHtml();
                if (stations.length > 0) {
                    saveMenu(locationSlug, periodSlug, date, stations);
                    upsertJob(key, 'done', null, Date.now(), 'Success (Fallback)');
                    console.log('[Scrape] Used saved HTML fallback for:', key);
                    return;
                }
            }

            upsertJob(key, 'error', err.message, Date.now(), 'Scrape failed');
        }
    })();
}

// ── API Routes ───────────────────────────────────────

// GET /api/locations
app.get('/api/locations', (req, res) => {
    // Group locations by group
    const grouped = {};
    for (const loc of LOCATIONS) {
        if (!grouped[loc.group]) grouped[loc.group] = [];
        grouped[loc.group].push(loc);
    }
    res.json({ locations: LOCATIONS, grouped });
});

// GET /api/periods
app.get('/api/periods', (req, res) => {
    res.json({ periods: PERIODS });
});

// GET /api/current — auto-detect current location/period/date
app.get('/api/current', (req, res) => {
    res.json({
        period: getCurrentPeriod(),
        location: getDefaultLocation(),
        date: new Date().toISOString().split('T')[0]
    });
});

// GET /api/menu?locationSlug=...&periodSlug=...&date=...
// Returns cached data OR triggers background scrape and tells user to wait
app.get('/api/menu', async (req, res) => {
    const { locationSlug, periodSlug, date } = req.query;

    if (!locationSlug || !periodSlug || !date) {
        return res.status(400).json({ error: 'Missing locationSlug, periodSlug, or date' });
    }

    // 1. Check DB first
    const cached = getMenu(locationSlug, periodSlug, date);
    if (cached) {
        return res.json({
            status: 'ready',
            stations: cached.stations,
            scrapedAt: cached.scrapedAt
        });
    }

    // 2. Not in DB — check if a scrape job is underway
    const key = menuKey(locationSlug, periodSlug, date);
    const job = getJob(key);

    if (job && job.status === 'pending') {
        return res.json({
            status: 'scraping',
            step: job.step || 'Initializing...',
            message: 'Loading menu from dineoncampus.com. Auto-refreshing…'
        });
    }

    if (job && job.status === 'error') {
        return res.status(500).json({ status: 'error', message: `Scrape failed: ${job.error}` });
    }

    // 3. First request for this menu today — trigger scrape and notify user
    triggerScrape(locationSlug, periodSlug, date);

    return res.json({
        status: 'scraping',
        first: true,
        step: 'Entering the Dining Hall...',
        message: "You're the first one to view this menu today! It's being fetched live."
    });
});

// GET /api/menu/status?locationSlug=...&periodSlug=...&date=...
// Lightweight polling endpoint — returns ready/pending/error
app.get('/api/menu/status', (req, res) => {
    const { locationSlug, periodSlug, date } = req.query;
    const key = menuKey(locationSlug, periodSlug, date);

    // Check if data is in DB now
    const cached = getMenu(locationSlug, periodSlug, date);
    if (cached) return res.json({ status: 'ready' });

    const job = getJob(key);
    if (!job) return res.json({ status: 'unknown' });
    res.json({ status: job.status, step: job.step, error: job.error });
});

// GET /api/menu/clear?locationSlug=...&periodSlug=...&date=...
app.get('/api/menu/clear', (req, res) => {
    const { locationSlug, periodSlug, date } = req.query;
    const key = menuKey(locationSlug, periodSlug, date);
    upsertJob(key, 'pending', null, 0, 'Clearing cache...');
    res.json({ status: 'cleared' });
});

// Serve index.html for all other routes (SPA catch-all)
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
    console.log(`\n🍽️  Aggie Dining Tracker`);
    console.log(`   Running on http://localhost:${PORT}\n`);
});
