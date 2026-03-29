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
    getLeaderboard, findDiningTwin, getExperiments, createExperiment,
    updateExperimentStatus, getExperimentLogs, addExperimentLog
} = require('./db');

// Run DB cleanup on startup
cleanupMenus(30);
// Schedule cleanup once per day
setInterval(() => cleanupMenus(30), 24 * 60 * 60 * 1000);

const { startScrapeProcess } = require('./scraper');

// --- STARTUP CLEANUP ---
// Clear any "scraping" jobs that were orphaned when the server last stopped/crashed.
const staleDeleted = clearStaleJobs();
if (staleDeleted > 0) {
    console.log(`[DB] Cleared ${staleDeleted} stale scrape jobs from previous session.`);
}

const fs = require('fs');

const app = express();
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

    // ── DEV BYPASS ────────────────────────────────────
    if (token === 'dev-test-token') {
        req.user = { id: 'test-user-id', email: 'test@example.com', name: 'Test User' };
        return next();
    }

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
    await addMealLog(
        req.user.id, date, mealType, item.name, item.calories, item.portion,
        item.protein, item.fat, item.carbs, item.sodium,
        item.fiber, item.sugars, item.saturated_fat, item.trans_fat, item.cholesterol
    );
    res.json({ success: true });
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

app.get('/api/leaderboard', async (req, res) => {
    const { item } = req.query;
    if (!item) return res.json({ leaderboard: [] });
    const leaderboard = getLeaderboard(item);
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
    for (let exp of experiments) {
        exp.logs = getExperimentLogs(exp.id);
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
    addExperimentLog(req.params.id, date, weight, hungerLevel, consistency, notes);
    res.json({ success: true });
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
        if (job.status === 'failed') return res.json({ status: 'failed', error: job.error });
        if (job.status === 'ready' || job.status === 'done' || job.status === 'success') {
          // If the job says ready but menu is missing (deleted), allow it to continue
          console.log(`[API] Job says ready but menu might be missing, starting over.`);
        } else {
          return res.json({ status: 'scraping', step: job.step || job.status });
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
app.listen(PORT, () => {
    console.log(`\n🍽️  MindfulMacros (Auth-Enabled)\n   Running on http://localhost:${PORT}`);
});
