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
    protein_goal INTEGER DEFAULT 100,
    fat_goal INTEGER DEFAULT 70,
    carb_goal INTEGER DEFAULT 250,
    height INTEGER,
    weight INTEGER,
    tracked_nutrients TEXT DEFAULT '[]',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS meal_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    meal_type TEXT NOT NULL, -- breakfast, etc
    item_name TEXT NOT NULL,
    calories INTEGER DEFAULT 0,
    serving_size REAL DEFAULT 1.0,
    protein INTEGER DEFAULT 0,
    fat INTEGER DEFAULT 0,
    carbs INTEGER DEFAULT 0,
    sodium INTEGER DEFAULT 0,
    fiber INTEGER DEFAULT 0,
    sugar INTEGER DEFAULT 0,
    sugars INTEGER DEFAULT 0,
    saturated_fat INTEGER DEFAULT 0,
    trans_fat INTEGER DEFAULT 0,
    cholesterol INTEGER DEFAULT 0,
    logged_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS food_items (
    name TEXT PRIMARY KEY,
    calories INTEGER,
    protein INTEGER,
    fat INTEGER,
    carbs INTEGER,
    sodium INTEGER DEFAULT 0,
    fiber INTEGER DEFAULT 0,
    sugar INTEGER DEFAULT 0,
    sugars INTEGER DEFAULT 0,
    saturated_fat INTEGER DEFAULT 0,
    trans_fat INTEGER DEFAULT 0,
    cholesterol INTEGER DEFAULT 0,
    last_seen INTEGER
  );

  CREATE TABLE IF NOT EXISTS shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    name TEXT,
    item_json TEXT, -- JSON array of items
    last_used INTEGER
  );

  CREATE TABLE IF NOT EXISTS menus (
    location_slug TEXT,
    period_slug TEXT,
    date TEXT,
    stations TEXT, -- JSON blob
    scraped_at INTEGER,
    PRIMARY KEY (location_slug, period_slug, date)
  );

  CREATE TABLE IF NOT EXISTS scrape_jobs (
    key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    step TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS wait_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_slug TEXT NOT NULL,
    station_name TEXT NOT NULL,
    wait_seconds INTEGER NOT NULL,
    reported_at INTEGER NOT NULL,
    user_id TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Migration: Add step column if it doesn't exist (handle existing DBs)
try {
  db.prepare("ALTER TABLE scrape_jobs ADD COLUMN step TEXT").run();
} catch (e) { }

try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN protein INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN fat INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN carbs INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN sodium INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN fiber INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN sugar INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN sugars INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN saturated_fat INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN trans_fat INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE meal_logs ADD COLUMN cholesterol INTEGER DEFAULT 0").run();
} catch (e) { }

// Food Items Migrations
try {
  db.prepare("ALTER TABLE food_items ADD COLUMN sodium INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE food_items ADD COLUMN fiber INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE food_items ADD COLUMN sugar INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE food_items ADD COLUMN sugars INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE food_items ADD COLUMN saturated_fat INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE food_items ADD COLUMN trans_fat INTEGER DEFAULT 0").run();
} catch (e) { }
try {
  db.prepare("ALTER TABLE food_items ADD COLUMN cholesterol INTEGER DEFAULT 0").run();
} catch (e) { }

// Wait Times Migrations
try {
  db.prepare("ALTER TABLE wait_times ADD COLUMN station_name TEXT NOT NULL DEFAULT 'Unknown'").run();
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

function cleanupWaitTimes(minutes = 30) {
  const cutoff = Date.now() - (minutes * 60 * 1000);
  const w = db.prepare('DELETE FROM wait_times WHERE reported_at < ?').run(cutoff);
  if (w.changes > 0) {
    console.log(`[DB] Expired ${w.changes} wait-time reports older than ${minutes}m.`);
  }
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
    `).run(id || email, email, name, picture, Date.now());
  } catch (e) {
    // If ID also has conflict, ignore it and just get the user
    console.log('User already exists, fetching...');
  }

  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function updateUserGoals(userId, pro, fat, carb) {
  db.prepare('UPDATE users SET protein_goal = ?, fat_goal = ?, carb_goal = ? WHERE id = ?').run(pro, fat, carb, userId);
}

function updateUserNutrients(userId, nutrientsJSON) {
  db.prepare('UPDATE users SET tracked_nutrients = ? WHERE id = ?').run(nutrientsJSON, userId);
}

function updateCalorieGoal(userId, goal) {
  db.prepare('UPDATE users SET calorie_goal = ? WHERE id = ?').run(goal, userId);
}

function updateUserStats(userId, height, weight) {
  db.prepare('UPDATE users SET height = ?, weight = ? WHERE id = ?').run(height, weight, userId);
}

function updateTrackedNutrients(userId, nutrients) {
  db.prepare('UPDATE users SET tracked_nutrients = ? WHERE id = ?').run(JSON.stringify(nutrients), userId);
}

function getKnownFood(name) {
  return db.prepare('SELECT * FROM food_items WHERE name = ?').get(name);
}

function upsertFoodItem(item) {
  if (!item.calories && !item.protein) return; // Don't store empties
  db.prepare(`
    INSERT INTO food_items (name, calories, protein, fat, carbs, sodium, fiber, sugar, sugars, saturated_fat, trans_fat, cholesterol, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET 
      calories=excluded.calories, protein=excluded.protein, 
      fat=excluded.fat, carbs=excluded.carbs, 
      sodium=excluded.sodium, fiber=excluded.fiber, sugar=excluded.sugar,
      sugars=excluded.sugars, saturated_fat=excluded.saturated_fat,
      trans_fat=excluded.trans_fat, cholesterol=excluded.cholesterol,
      last_seen=excluded.last_seen
  `).run(item.name, item.calories, item.protein, item.fat, item.carbs, item.sodium || 0, item.fiber || 0, item.sugar || 0, item.sugars || 0, item.saturated_fat || 0, item.trans_fat || 0, item.cholesterol || 0, Date.now());
}

function addMealLog(userId, date, mealType, itemName, calories, servingSize, p = 0, f = 0, c = 0, na = 0, fib = 0, sug = 0, sat = 0, trans = 0, chol = 0) {
  db.prepare(`
    INSERT INTO meal_logs (user_id, date, meal_type, item_name, calories, serving_size, protein, fat, carbs, sodium, fiber, sugar, sugars, saturated_fat, trans_fat, cholesterol, logged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, date, mealType, itemName, calories, servingSize, p, f, c, na, fib, sug, sug, sat, trans, chol, Date.now());
}

function getMealLogs(userId, date) {
  return db.prepare('SELECT * FROM meal_logs WHERE user_id = ? AND date = ?').all(userId, date);
}

function getMealLogsRange(userId, startDate, endDate) {
  return db.prepare('SELECT * FROM meal_logs WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC').all(userId, startDate, endDate);
}

function deleteMealLog(logId, userId) {
  db.prepare('DELETE FROM meal_logs WHERE id = ? AND user_id = ?').run(logId, userId);
}

// Shortcuts
function getShortcuts(userId) {
  return db.prepare('SELECT * FROM shortcuts WHERE user_id = ?').all(userId);
}

function saveShortcut(userId, name, items) {
  return db.prepare('INSERT INTO shortcuts (user_id, name, item_json, last_used) VALUES (?, ?, ?, ?)').run(userId, name, JSON.stringify(items), Date.now());
}

// ── WAIT TIMES ──────────────────────────────────
function addWaitTime(userId, locationSlug, stationName, waitSeconds) {
  db.prepare('INSERT INTO wait_times (user_id, location_slug, station_name, wait_seconds, reported_at) VALUES (?, ?, ?, ?, ?)').run(userId, locationSlug, stationName, waitSeconds, Date.now());
}

function getWaitTimeStats(locationSlug, stationName) {
  // Always cleanup before fetching
  cleanupWaitTimes(30);

  const stats = db.prepare(`
    SELECT AVG(wait_seconds) as avg, COUNT(*) as count, MAX(reported_at) as last_updated
    FROM wait_times
    WHERE location_slug = ? AND station_name = ?
  `).get(locationSlug, stationName);

  return stats;
}

function getWaitTimeStatsAll(locationSlug) {
  cleanupWaitTimes(30);
  return db.prepare(`
    SELECT station_name, AVG(wait_seconds) as avg, COUNT(*) as count, MAX(reported_at) as last_updated
    FROM wait_times
    WHERE location_slug = ?
    GROUP BY station_name
  `).all(locationSlug);
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
  updateUserGoals,
  updateUserNutrients,
  updateUserStats,
  updateTrackedNutrients,
  getKnownFood,
  upsertFoodItem,
  addMealLog,
  getMealLogs,
  getMealLogsRange,
  deleteMealLog,
  getMealLogsRange,
  getShortcuts,
  saveShortcut,
  addWaitTime,
  getWaitTimeStats,
  getWaitTimeStatsAll
};
