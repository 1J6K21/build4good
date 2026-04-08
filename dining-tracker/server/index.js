require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const {
    getUser, upsertUser, updateCalorieGoal,
    addMealLog, getMealLogs, getMealLogsRange, deleteMealLog,
    getMenu, createScrapeJob, getScrapeJob, getAllLocations,
    cleanupMenus, getShortcuts, saveShortcut, updateMacroGoals,
    updateUserStats, updateTrackedNutrients, updateUserNutrients, updateUserGoals,
    addWaitTime, getWaitTimeStats, getWaitTimeStatsAll, clearStaleJobs,
    updateExperimentStatus, getExperimentLogs, addExperimentLog, deleteExperiment,
    deleteExperimentLog, getExperiments, createExperiment,
    getLeaderboard, getTopItems, findDiningTwin, getCalorieDebt,
    getSavedScenarios, createSavedScenario, deleteSavedScenario
} = require('./db');

// Run DB cleanup on startup
cleanupMenus(30);
// Schedule cleanup once per day
setInterval(() => cleanupMenus(30), 24 * 60 * 60 * 1000);

const { startScrapeProcess } = require('./scraper');

// Start the 05:00 AM daily pre-scraper scheduler
const { prescrapeAll, schedulePrescrape } = require('./cron-prescrape');

// TRIGGER ON STARTUP (PROD ONLY):
// This ensures that if you deploy at 10:00 AM, the server fetches "today" 
// in the background right now instead of waiting until 5 AM tomorrow.
// We skip this in development to keep the terminal clean and startup fast.
if (process.env.NODE_ENV === 'production' || process.env.FLY_APP_NAME) {
    setTimeout(() => {
        console.log('[Startup] Executing background pre-scrape check...');
        prescrapeAll().catch(e => console.error('[Startup] Pre-scrape error:', e));
    }, 10_000); // Wait 10s for the server to be fully hot
}

schedulePrescrape();

// --- STARTUP CLEANUP ---
// Clear any "scraping" jobs that were orphaned when the server last stopped/crashed.
const staleDeleted = clearStaleJobs();
if (staleDeleted > 0) {
    console.log(`[DB] Cleared ${staleDeleted} stale scrape jobs from previous session.`);
}

const fs = require('fs');

const app = express();
const rateLimit = require('express-rate-limit');

// Fly.io uses a proxy; needed for rate limiter to see real IPs
app.set('trust proxy', 1);

// Global rate limit: 200 requests per 15 minutes
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests, please try again later.' }
});

// Stricter limit for STARTING a scrape: 100 per hour
const scrapeStartLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 100,
    message: { error: 'Scraping limit reached. Try again in an hour.' }
});

app.use('/api/', globalLimiter);
// Only apply the strict limit to the POST request that starts the scraper
app.post('/api/menu', scrapeStartLimiter);

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// ── DEBUG LOGGER ───────────────────────────────────
const logFile = path.join(__dirname, '../server.log');
app.use((req, res, next) => {
    const logStr = `[${new Date().toISOString()}] ${req.method} ${req.url} | User: ${req.user ? req.user.id : 'anon'}\n`;
    try {
        fs.appendFileSync(logFile, logStr);
    } catch (e) { }
    next();
});

// ── MIDDLEWARE ─────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

// ── AUTH MIDDLEWARE ────────────────────────────────
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(200).json({ authenticated: false });



    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) {
            return res.status(200).json({ authenticated: false, error: 'session_expired' });
        }
        const user = await getUser(decoded.id);
        if (!user) {
            return res.status(200).json({ authenticated: false, error: 'user_deleted' });
        }
        req.user = user;
        next();
    });
}

// ── API ROUTES (PRIORITY) ───────────────────────────

app.get('/api/auth/config', (req, res) => {
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID });
});

app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();

        const user = await upsertUser({
            id: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture
        });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ user, token });
    } catch (e) {
        console.error('Auth error', e);
        res.status(401).json({ error: 'Auth failed' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    const user = await getUser(req.user.id);
    if (!user) return res.status(200).json({ authenticated: false });
    res.json({ authenticated: true, user });
});

app.post('/api/auth/logout', (req, res) => {
    // Token is stateless — client just deletes it from localStorage
    res.json({ success: true });
});

// User Data Routes
app.get('/api/user/logs-range', authenticateToken, async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Start and end dates required' });
    const logs = await getMealLogsRange(req.user.id, start, end);
    res.json({ logs });
});

app.get('/api/user/logs', authenticateToken, async (req, res) => {
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const date = req.query.date || localToday;
    const logs = await getMealLogs(req.user.id, date);
    res.json({ logs });
});

// ── Removed Duplicate /api/user/logs-range Definition ──

app.post('/api/user/logs', authenticateToken, async (req, res) => {
    const { date, mealType, item } = req.body;
    try {
        fs.appendFileSync('/tmp/app_debug.log', `[LOG] User logged: ${item.name} | Servings: ${item.portion} | Cals: ${item.calories}\n`);
    } catch(e) {}
    await addMealLog(
        req.user.id, date, mealType, item.name, item.calories, item.portion,
        item.protein, item.fat, item.carbs, item.sodium,
        item.fiber, item.sugars, item.saturated_fat, item.trans_fat, item.cholesterol
    );
    res.json({ success: true });
});

app.get('/api/user/calorie-debt', authenticateToken, async (req, res) => {
    const stats = getCalorieDebt(req.user.id);
    if (!stats) return res.status(404).json({ error: 'User not found' });
    res.json(stats);
});

app.get('/api/user/shortcuts', authenticateToken, async (req, res) => {
    const shortcuts = await getShortcuts(req.user.id);
    res.json({ shortcuts: shortcuts.map(s => ({ ...s, items: JSON.parse(s.item_json) })) });
});

app.post('/api/user/shortcuts', authenticateToken, async (req, res) => {
    const { name, items } = req.body;
    await saveShortcut(req.user.id, name, items);
    res.json({ success: true });
});

app.post('/api/user/goals', authenticateToken, async (req, res) => {
    const { calorieGoal, proteinGoal, fatGoal, carbGoal, height, weight } = req.body;
    if (calorieGoal) await updateCalorieGoal(req.user.id, parseInt(calorieGoal));
    await updateUserGoals(req.user.id, parseInt(proteinGoal), parseInt(fatGoal), parseInt(carbGoal));
    if (height || weight) await updateUserStats(req.user.id, height ? parseInt(height) : null, weight ? parseInt(weight) : null);
    res.json({ success: true });
});

// Saved Scenarios
app.get('/api/user/saved-scenarios', authenticateToken, async (req, res) => {
    const presets = getSavedScenarios(req.user.id);
    res.json({ presets });
});

app.post('/api/user/saved-scenarios', authenticateToken, async (req, res) => {
    const { name, bMod, lMod, dMod, sMod, days } = req.body;
    const id = createSavedScenario(req.user.id, name, bMod, lMod, dMod, sMod, days);
    res.json({ success: true, id });
});

app.delete('/api/user/saved-scenarios/:id', authenticateToken, async (req, res) => {
    deleteSavedScenario(req.params.id, req.user.id);
    res.json({ success: true });
});

app.post('/api/user/nutrients', authenticateToken, async (req, res) => {
    const { nutrients } = req.body;
    await updateTrackedNutrients(req.user.id, nutrients);
    res.json({ success: true });
});

app.delete('/api/user/logs/:id', authenticateToken, async (req, res) => {
    await deleteMealLog(req.params.id, req.user.id);
    res.json({ success: true });
});

app.post('/api/user/goal', authenticateToken, async (req, res) => {
    const { goal } = req.body;
    await updateCalorieGoal(req.user.id, goal);
    res.json({ success: true });
});

// ── USDA FOOD SEARCH ────────────────────────────────
app.get('/api/external/search', authenticateToken, async (req, res) => {
    const { query } = req.query;
    console.log(`[USDA] Search Request: "${query}" | User: ${req.user.id}`);
    if (!query) return res.status(400).json({ error: 'Query required' });
    
    // Using demo key if no key provided
    const apiKey = process.env.USDA_API_KEY || 'DEMO_KEY';
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=20&api_key=${apiKey}&dataType=Branded,SR%20Legacy,Foundation`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) {
            console.error('[USDA] API Error Resp:', data);
            return res.status(response.status).json({ error: (data.error && data.error.message) || 'USDA API error' });
        }
        res.json(data);
    } catch (e) {
        console.error('[USDA] Network Error:', e.message);
        res.status(500).json({ error: 'FDC search server-side connection fail' });
    }
});

app.get('/api/external/food/:fdcId', authenticateToken, async (req, res) => {
    const { fdcId } = req.params;
    console.log(`[USDA] Detail Request: ${fdcId}`);
    const apiKey = process.env.USDA_API_KEY || 'DEMO_KEY';
    const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${apiKey}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error('USDA Detail Error:', e);
        res.status(500).json({ error: 'FDC detail failed' });
    }
});

app.get('/api/leaderboard/top', async (req, res) => {
    const limit = parseInt(req.query.limit || '10');
    try {
        const topItems = getTopItems(limit);
        res.json(topItems);
    } catch (e) {
        console.error('Error fetching top items:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    const { item } = req.query;
    if (!item) return res.json({ leaderboard: [] });
    const leaderboard = getLeaderboard(item);
    try {
        fs.appendFileSync('/tmp/app_debug.log', `[DEBUG_LEADERBOARD] Query: ${item}\nData: ${JSON.stringify(leaderboard)}\n`);
    } catch(e) {}
    res.json({ leaderboard });
});

app.get('/api/mirror', authenticateToken, async (req, res) => {
    const days = parseInt(req.query.days || '30');
    const result = findDiningTwin(req.user.id, days);
    if (!result) return res.json({ twin: null });
    res.json(result);
});

// Wait Times API (Shared)
app.get('/api/locations/:slug/wait-time', async (req, res) => {
    const stats = await getWaitTimeStatsAll(req.params.slug);
    res.json(stats);
});

app.post('/api/locations/:slug/wait-time', authenticateToken, async (req, res) => {
    const { seconds, stationName } = req.body;
    await addWaitTime(req.user.id, req.params.slug, stationName, seconds);
    const stats = await getWaitTimeStatsAll(req.params.slug);
    res.json({ success: true, stats });
});

// Experiments API
app.get('/api/user/experiments', authenticateToken, async (req, res) => {
    const experiments = getExperiments(req.user.id);
    const today = new Date();
    today.setHours(0,0,0,0);

    for (let exp of experiments) {
        exp.logs = getExperimentLogs(exp.id);
        const start = new Date(exp.start_date);
        const end = new Date(start.getTime() + exp.duration_days * 24 * 60 * 60 * 1000);
        if (exp.status === 'concluded' || end <= today) {
            if (exp.status !== 'concluded') {
                updateExperimentStatus(exp.id, req.user.id, 'concluded');
                exp.status = 'concluded';
            }
            if (exp.logs.length > 0) {
                const logsWithWeight = exp.logs.filter(l => l.weight != null);
                const firstWeight = logsWithWeight.length > 0 ? logsWithWeight[0].weight : null;
                const lastWeight = logsWithWeight.length > 0 ? logsWithWeight[logsWithWeight.length - 1].weight : null;
                const weightDelta = (lastWeight !== null && firstWeight !== null) ? parseFloat((lastWeight - firstWeight).toFixed(1)) : 0;
                
                const validHunger = exp.logs.filter(l => l.hunger_level != null);
                const avgHunger = validHunger.length > 0 ? parseFloat((validHunger.reduce((sum, l) => sum + l.hunger_level, 0) / validHunger.length).toFixed(1)) : 0;
                
                const daysOnTrack = exp.logs.filter(l => l.consistency == 3).length;
                const consistencyPct = exp.duration_days ? Math.round((daysOnTrack / exp.duration_days) * 100) : 0;
                
                exp.summary = {
                    weightDelta,
                    avgHunger,
                    daysOnTrack,
                    consistencyPct
                };
            } else {
                exp.summary = { weightDelta: 0, avgHunger: 0, daysOnTrack: 0, consistencyPct: 0 };
            }
        }
    }
    res.json({ experiments });
});

app.post('/api/user/experiments', authenticateToken, async (req, res) => {
    const { title, durationDays, startDate } = req.body;
    const id = createExperiment(req.user.id, title, durationDays, startDate);
    res.json({ success: true, id });
});

app.post('/api/user/experiments/:id/status', authenticateToken, async (req, res) => {
    const { status } = req.body;
    updateExperimentStatus(req.params.id, req.user.id, status);
    res.json({ success: true });
});

app.post('/api/user/experiments/:id/logs', authenticateToken, async (req, res) => {
    const { date, weight, hungerLevel, consistency, notes } = req.body;
    const logs = getMealLogs(req.user.id, date); // synchronous in your db layer
    let autoCalories = null;
    if (logs && logs.length > 0) {
        autoCalories = logs.reduce((sum, l) => sum + (l.calories || 0), 0);
    }
    addExperimentLog(req.params.id, date, weight, hungerLevel, consistency, notes, autoCalories);
    res.json({ success: true });
});

app.delete('/api/user/experiments/:id', authenticateToken, async (req, res) => {
    try {
        console.log(`[API] Deleting experiment ${req.params.id} for user ${req.user.id}`);
        await deleteExperiment(req.params.id, req.user.id);
        res.json({ success: true });
    } catch (e) {
        console.error('[API] Error deleting experiment:', e);
        res.status(500).json({ error: 'Failed to delete experiment' });
    }
});

app.delete('/api/user/experiments/:id/logs/:logId', authenticateToken, async (req, res) => {
    try {
        // verify experiment belongs to user
        const exps = getExperiments(req.user.id);
        if (!exps.find(e => e.id == req.params.id)) return res.status(403).json({ error: 'Unauthorized' });
        
        deleteExperimentLog(req.params.logId, req.params.id);
        res.json({ success: true });
    } catch (e) {
        console.error('[API] Error deleting log:', e);
        res.status(500).json({ error: 'Failed to delete log' });
    }
});


// Existing Menu Data Routes
app.get('/api/locations', async (req, res) => {
    const locations = await getAllLocations();
    const grouped = locations.reduce((acc, loc) => {
        if (!acc[loc.hall_group]) acc[loc.hall_group] = [];
        acc[loc.hall_group].push(loc);
        return acc;
    }, {});
    res.json({ locations, grouped });
});

app.get('/api/menu', async (req, res) => {
    const { locationSlug, periodSlug, date, refresh } = req.query;
    console.log(`[API] Menu request: ${locationSlug} | ${periodSlug} | ${date} (refresh: ${refresh})`);

    if (!locationSlug || !periodSlug || !date) {
        console.warn('[API] Missing required parameters');
        return res.status(400).json({ error: 'Missing params' });
    }

    if (refresh === 'true') {
        console.log(`[API] Force Refresh: Clearing menu and jobs for ${locationSlug}`);
        const { deleteMenu, deleteScrapeJob } = require('./db');
        deleteMenu(locationSlug, periodSlug, date);
        deleteScrapeJob(locationSlug, periodSlug, date);
    } else {
        const cached = await getMenu(locationSlug, periodSlug, date);
        if (cached) {
            console.log(`[API] Cache HIT for ${locationSlug}`);
            return res.json({ status: 'ready', stations: cached.stations });
        }
    }

    const job = await getScrapeJob(locationSlug, periodSlug, date);
    if (job) {
        console.log(`[API] Job existing for ${locationSlug}: ${job.status}`);
        // If it failed previously, we can allow starting a new one here if we want to be generous, 
        // OR we return failed. Let's return failed but the frontend should use refresh=true to bypass.
        // Actually, let's make it so if status is failed, we allow falling through to start a new job!
        if (job.status === 'failed') {
            console.log(`[API] Previous job failed, allowing restart.`);
        } else {
            if (job.status === 'ready' || job.status === 'done' || job.status === 'success') {
                // If the job says ready but menu is missing (deleted), allow it to continue
                console.log(`[API] Job says ready but menu might be missing, starting over.`);
            } else {
                return res.json({ status: 'scraping', step: job.step || job.status });
            }
        }
    }

    console.log(`[API] Starting NEW scrape job for ${locationSlug}`);
    createScrapeJob(locationSlug, periodSlug, date);
    startScrapeProcess(locationSlug, periodSlug, date);
    res.json({ status: 'scraping', step: 'Initializing...' });
});

app.get('/api/menu/status', async (req, res) => {
    const { locationSlug, periodSlug, date } = req.query;
    const cached = await getMenu(locationSlug, periodSlug, date);
    if (cached) {
        console.log(`[API] Status: READY (cached) for ${locationSlug}`);
        return res.json({ status: 'ready' });
    }

    const job = await getScrapeJob(locationSlug, periodSlug, date);
    if (!job) {
        console.log(`[API] Status: NOT_FOUND for ${locationSlug}`);
        return res.json({ status: 'not_found' });
    }

    console.log(`[API] Status: ${job.status} (${job.step}) for ${locationSlug}`);
    if (job.status === 'failed') return res.json({ status: 'failed', error: job.error });
    if (job.status === 'ready' || job.status === 'done' || job.status === 'success') return res.json({ status: 'ready' });
    res.json({ status: 'scraping', step: job.step || job.status });
});

// ── STATIC FILE SERVING ────────────────────────────
// Serve files FROM here if no API route matched
app.use(express.static(path.join(__dirname, '../public')));

// Root redirect
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Catch-all for SPA (must be last)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── START ──────────────────────────────────────────
const PORT = process.env.PORT || 3333;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🍽️  MindfulMacros (Auth-Enabled)\n   Running on port ${PORT}`);
});
