require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const {
    getUser, upsertUser, updateCalorieGoal,
    addMealLog, getMealLogs, deleteMealLog,
    getMenu, createScrapeJob, getScrapeJob, getAllLocations,
    cleanupMenus
} = require('./db');

// Run DB cleanup on startup
cleanupMenus(30);
// Schedule cleanup once per day
setInterval(() => cleanupMenus(30), 24 * 60 * 60 * 1000);

const { startScrapeProcess } = require('./scraper');

const fs = require('fs');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// ── DEBUG LOGGER ───────────────────────────────────
app.use((req, res, next) => {
    const logStr = `[${new Date().toISOString()}] ${req.method} ${req.url} | Origin: ${req.get('origin') || 'none'} | Referer: ${req.get('referer') || 'none'}\n`;
    try {
        fs.appendFileSync(path.join(__dirname, '../../helper/api_debug.log'), logStr);
    } catch (e) {
        console.error('Logging failed', e);
    }
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

app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ authenticated: true, user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
    // Token is stateless — client just deletes it from localStorage
    res.json({ success: true });
});

// User Data Routes
app.get('/api/user/logs', authenticateToken, async (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const logs = await getMealLogs(req.user.id, date);
    res.json({ logs });
});

app.post('/api/user/logs', authenticateToken, async (req, res) => {
    const { date, mealType, item } = req.body;
    await addMealLog(req.user.id, date, mealType, item.name, item.calories, item.portion, item.protein, item.fat, item.carbs);
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
    const { locationSlug, periodSlug, date } = req.query;
    console.log(`[API] Menu request: ${locationSlug} | ${periodSlug} | ${date}`);

    if (!locationSlug || !periodSlug || !date) return res.status(400).json({ error: 'Missing params' });

    const cached = await getMenu(locationSlug, periodSlug, date);
    if (cached) {
        console.log(`[API] Cache HIT for ${locationSlug}`);
        return res.json({ status: 'ready', stations: cached.stations });
    }

    const job = await getScrapeJob(locationSlug, periodSlug, date);
    if (job) {
        console.log(`[API] Job existing for ${locationSlug}: ${job.status}`);
        if (job.status === 'failed') return res.json({ status: 'failed', error: job.error });
        return res.json({ status: 'scraping', step: job.step || job.status });
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

// Catch-all
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── START ──────────────────────────────────────────
const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
    console.log(`\n🍽️  Aggie Dining Tracker (Auth-Enabled)\n   Running on http://localhost:${PORT}`);
});
