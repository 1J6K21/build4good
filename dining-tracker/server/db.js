const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/menus.db');

// Ensure data dir exists
const fs = require('fs');
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS menus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_slug TEXT NOT NULL,
    period_slug TEXT NOT NULL,
    date TEXT NOT NULL,
    stations TEXT NOT NULL,
    scraped_at INTEGER NOT NULL,
    UNIQUE(location_slug, period_slug, date)
  );

  CREATE TABLE IF NOT EXISTS scrape_jobs (
    key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    step TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER
  );
`);

// Migration: Add step column if it doesn't exist (handle existing DBs)
try {
  db.prepare("ALTER TABLE scrape_jobs ADD COLUMN step TEXT").run();
} catch (e) {
  // Ignore error if column already exists
}


function getMenu(locationSlug, periodSlug, date) {
  const row = db.prepare(
    'SELECT stations, scraped_at FROM menus WHERE location_slug=? AND period_slug=? AND date=?'
  ).get(locationSlug, periodSlug, date);
  if (!row) return null;
  return { stations: JSON.parse(row.stations), scrapedAt: row.scraped_at };
}

function saveMenu(locationSlug, periodSlug, date, stations) {
  db.prepare(`
    INSERT INTO menus (location_slug, period_slug, date, stations, scraped_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(location_slug, period_slug, date) DO UPDATE SET stations=excluded.stations, scraped_at=excluded.scraped_at
  `).run(locationSlug, periodSlug, date, JSON.stringify(stations), Date.now());
}

function getJob(key) {
  return db.prepare('SELECT * FROM scrape_jobs WHERE key=?').get(key);
}

function upsertJob(key, status, error = null, completedAt = null, step = null) {
  db.prepare(`
    INSERT INTO scrape_jobs (key, status, error, started_at, completed_at, step)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET status=excluded.status, error=excluded.error, completed_at=excluded.completed_at, step=excluded.step
  `).run(key, status, error, Date.now(), completedAt, step);
}

module.exports = { getMenu, saveMenu, getJob, upsertJob };
