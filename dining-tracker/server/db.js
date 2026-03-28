const { LOCATIONS } = require('./constants');
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
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    picture TEXT,
    calorie_goal INTEGER DEFAULT 2000,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meal_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    calories INTEGER,
    protein INTEGER DEFAULT 0,
    fat INTEGER DEFAULT 0,
    carbs INTEGER DEFAULT 0,
    serving_size TEXT,
    logged_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

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
} catch (e) { }

// Migration: Add macros to meal_logs
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN protein INTEGER DEFAULT 0").run();
  db.prepare("ALTER TABLE meal_logs ADD COLUMN fat INTEGER DEFAULT 0").run();
  db.prepare("ALTER TABLE meal_logs ADD COLUMN carbs INTEGER DEFAULT 0").run();
} catch (e) { }


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

function cleanupMenus(daysToKeep = 30) {
  const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
  const m = db.prepare('DELETE FROM menus WHERE scraped_at < ?').run(cutoff);
  const j = db.prepare('DELETE FROM scrape_jobs WHERE started_at < ?').run(cutoff);
  console.log(`[DB] Cleanup complete: Deleted ${m.changes} menus and ${j.changes} jobs older than ${daysToKeep} days.`);
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

function getJobKey(locationSlug, periodSlug, date) {
  return `${locationSlug}:${periodSlug}:${date}`;
}

function getScrapeJob(locationSlug, periodSlug, date) {
  return getJob(getJobKey(locationSlug, periodSlug, date));
}

function createScrapeJob(locationSlug, periodSlug, date) {
  upsertJob(getJobKey(locationSlug, periodSlug, date), 'pending');
}

function updateScrapeJobStatus(locationSlug, periodSlug, date, step) {
  upsertJob(getJobKey(locationSlug, periodSlug, date), 'scraping', null, null, step);
}

function getAllLocations() {
  return LOCATIONS;
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

async function upsertUser({ id, email, name, picture }) {
  // Try to insert first. If email exists, update the name/picture.
  try {
    db.prepare(`
      INSERT INTO users (id, email, name, picture, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET 
          name=excluded.name, 
          picture=excluded.picture
    `).run(id, email, name, picture, Date.now());
  } catch (e) {
    // If ID also has conflict (rare with sub), ignore it and just get the user
    console.log('User already exists, fetching...');
  }

  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function updateCalorieGoal(userId, goal) {
  db.prepare('UPDATE users SET calorie_goal = ? WHERE id = ?').run(goal, userId);
}

function addMealLog(userId, date, mealType, itemName, calories, servingSize, protein = 0, fat = 0, carbs = 0) {
  db.prepare(`
    INSERT INTO meal_logs (user_id, date, meal_type, item_name, calories, serving_size, protein, fat, carbs, logged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, date, mealType, itemName, calories, servingSize, protein, fat, carbs, Date.now());
}

function getMealLogs(userId, date) {
  return db.prepare('SELECT * FROM meal_logs WHERE user_id = ? AND date = ?').all(userId, date);
}

function deleteMealLog(logId, userId) {
  db.prepare('DELETE FROM meal_logs WHERE id = ? AND user_id = ?').run(logId, userId);
}

module.exports = {
  getMenu,
  saveMenu,
  cleanupMenus,
  getJob,
  upsertJob,
  getScrapeJob,
  createScrapeJob,
  updateScrapeJobStatus,
  getAllLocations,
  getUser,
  upsertUser,
  updateCalorieGoal,
  addMealLog,
  getMealLogs,
  deleteMealLog
};
