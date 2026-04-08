const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data/menus.db');
const db = new Database(DB_PATH);

// Mock a failed job
// Use a realistic slug, period, and tomorrow's date to avoid interference with real usage
const locationSlug = 'the-commons-dining-hall-south-campus';
const periodSlug = 'dinner';
const date = '2026-04-09'; // Tomorrow or any future date
const key = `${locationSlug}:${periodSlug}:${date}`;

console.log(`Injecting failed job for: ${key}`);

db.prepare(`
    INSERT INTO scrape_jobs (key, status, error, started_at, step)
    VALUES (?, 'failed', 'Simulated failure for testing', ?, 'Testing')
    ON CONFLICT(key) DO UPDATE SET status='failed', error='Simulated failure for testing'
`).run(key, Date.now());

// Also ensure the menu doesn't exist so it triggers the job check
db.prepare('DELETE FROM menus WHERE location_slug=? AND period_slug=? AND date=?').run(locationSlug, periodSlug, date);

console.log('Done. Now go to the app, select this date/location, and click Retry.');
