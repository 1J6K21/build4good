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

// Wait Times Migrations
try {
  db.prepare("ALTER TABLE wait_times ADD COLUMN station_name TEXT NOT NULL DEFAULT 'Unknown'").run();
} catch (e) { }

// Experiments Support
db.exec(`
  CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    duration_days INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS experiment_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    weight REAL,
    hunger_level INTEGER,
    consistency INTEGER,
    notes TEXT,
    FOREIGN KEY(experiment_id) REFERENCES experiments(id)
  );
`);

try {
  db.prepare("ALTER TABLE experiment_logs ADD COLUMN auto_calories INTEGER").run();
} catch (e) { }
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

function deleteMenu(locationSlug, periodSlug, date) {
  db.prepare('DELETE FROM menus WHERE location_slug=? AND period_slug=? AND date=?').run(locationSlug, periodSlug, date);
}

function deleteScrapeJob(locationSlug, periodSlug, date) {
  db.prepare('DELETE FROM scrape_jobs WHERE key=?').run(getJobKey(locationSlug, periodSlug, date));
}

function clearStaleJobs() {
  const result = db.prepare("DELETE FROM scrape_jobs WHERE status = 'scraping' OR status = 'pending'").run();
  return result.changes;
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
  let ss = parseFloat(servingSize);
  if (isNaN(ss) || ss <= 0) ss = 1.0;
  
  db.prepare(`
    INSERT INTO meal_logs (user_id, date, meal_type, item_name, calories, serving_size, protein, fat, carbs, sodium, fiber, sugar, sugars, saturated_fat, trans_fat, cholesterol, logged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, date, mealType, itemName, calories, ss, p, f, c, na, fib, sug, sug, sat, trans, chol, Date.now());
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

// ── LEADERBOARD ──────────────────────────────────
function getLeaderboard(itemName) {
  return db.prepare(`
    SELECT users.name, users.picture, SUM(CAST(serving_size AS REAL)) as count
    FROM meal_logs
    JOIN users ON meal_logs.user_id = users.id
    WHERE LOWER(meal_logs.item_name) LIKE ?
    GROUP BY users.id
    ORDER BY count DESC
    LIMIT 10
  `).all(`%${itemName.toLowerCase()}%`);
}

function getTopItems(limit = 10) {
  return db.prepare(`
    SELECT item_name, SUM(serving_size) as total_servings, COUNT(DISTINCT user_id) as unique_users
    FROM meal_logs
    GROUP BY item_name
    ORDER BY total_servings DESC
    LIMIT ?
  `).all(limit);
}

// ── DINING TWIN ───────────────────────────────────
function findDiningTwin(userId, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Compute per-user macro averages over the last N days
  const allUserStats = db.prepare(`
    SELECT
      ml.user_id,
      u.name,
      u.email,
      u.picture,
      AVG(ml.calories)  as avg_cal,
      AVG(ml.protein)   as avg_protein,
      AVG(ml.fat)       as avg_fat,
      AVG(ml.carbs)     as avg_carbs,
      COUNT(*)          as log_count
    FROM meal_logs ml
    JOIN users u ON ml.user_id = u.id
    WHERE ml.date >= ?
    GROUP BY ml.user_id
    HAVING log_count >= 3
  `).all(cutoffStr);

  if (allUserStats.length < 2) return null;

  // Find current user's vector
  const me = allUserStats.find(u => u.user_id === userId);
  if (!me) return null;

  const meVec = [me.avg_cal, me.avg_protein, me.avg_fat, me.avg_carbs];

  // Score based on percentage differences. Lower is better. 0 = exact match.
  function getDiffScore(me, other) {
      const calDiff = Math.abs(me.avg_cal - other.avg_cal) / Math.max(me.avg_cal, 1);
      const protDiff = Math.abs(me.avg_protein - other.avg_protein) / Math.max(me.avg_protein, 1);
      const carbDiff = Math.abs(me.avg_carbs - other.avg_carbs) / Math.max(me.avg_carbs, 1);
      const fatDiff = Math.abs(me.avg_fat - other.avg_fat) / Math.max(me.avg_fat, 1);
      
      return Math.min(1, calDiff)*0.4 + Math.min(1, protDiff)*0.2 + Math.min(1, carbDiff)*0.2 + Math.min(1, fatDiff)*0.2;
  }

  // Find top 5 matches
  let matches = [];
  for (const u of allUserStats) {
    if (u.user_id === userId) continue;
    const score = getDiffScore(me, u);
    matches.push({ u, score });
  }

  matches.sort((a, b) => a.score - b.score);
  const topMatches = matches.slice(0, 5);

  if (topMatches.length === 0) return null;

  // Compile twins
  const twinsResult = [];
  for (const match of topMatches) {
      const best = match.u;

      const sharedFoods = db.prepare(`
        SELECT item_name, COUNT(*) as count
        FROM meal_logs
        WHERE user_id IN (?, ?) AND date >= ?
        GROUP BY item_name
        HAVING COUNT(DISTINCT user_id) = 2
        ORDER BY count DESC
        LIMIT 5
      `).all(userId, best.user_id, cutoffStr);

      const topProteinRaw = db.prepare(`
        SELECT date, SUM(protein) as total_protein, SUM(calories) as total_cals, SUM(carbs) as total_carbs
        FROM meal_logs
        WHERE user_id = ? AND date >= ?
        GROUP BY date
        ORDER BY total_protein DESC
        LIMIT 1
      `).get(best.user_id, cutoffStr);

      const lowestCalRaw = db.prepare(`
        SELECT date, SUM(protein) as total_protein, SUM(calories) as total_cals, SUM(carbs) as total_carbs
        FROM meal_logs
        WHERE user_id = ? AND date >= ?
        GROUP BY date
        HAVING total_cals > 800
        ORDER BY total_cals ASC
        LIMIT 1
      `).get(best.user_id, cutoffStr);

      const lowestCarbRaw = db.prepare(`
        SELECT date, SUM(protein) as total_protein, SUM(calories) as total_cals, SUM(carbs) as total_carbs
        FROM meal_logs
        WHERE user_id = ? AND date >= ?
        GROUP BY date
        HAVING total_cals > 800
        ORDER BY total_carbs ASC
        LIMIT 1
      `).get(best.user_id, cutoffStr);

      function getDayWithLogs(summary, title, metric) {
         if (!summary) return null;
         const logs = db.prepare(`
            SELECT meal_type, item_name, calories, protein, carbs
            FROM meal_logs
            WHERE user_id = ? AND date = ?
         `).all(best.user_id, summary.date);
         return {
            title,
            metricLabel: metric,
            date: summary.date,
            total_protein: Math.round(summary.total_protein || 0),
            total_cals: Math.round(summary.total_cals || 0),
            total_carbs: Math.round(summary.total_carbs || 0),
            logs
         };
      }

      const highlights = [];
      const tp = getDayWithLogs(topProteinRaw, "Top Protein Day", topProteinRaw ? `${Math.round(topProteinRaw.total_protein)}g PRO` : '');
      if (tp) highlights.push(tp);

      const lc = getDayWithLogs(lowestCalRaw, "Lowest Calorie Day", lowestCalRaw ? `${Math.round(lowestCalRaw.total_cals)} CALS` : '');
      if (lc && !highlights.find(h => h.date === lc.date)) highlights.push(lc);

      const lcb = getDayWithLogs(lowestCarbRaw, "Lowest Carb Day", lowestCarbRaw ? `${Math.round(lowestCarbRaw.total_carbs)}g CARBS` : '');
      if (lcb && !highlights.find(h => h.date === lcb.date)) highlights.push(lcb);

      const similarityScore = Math.max(0, Math.round((1 - match.score) * 100));

      twinsResult.push({
          twin: {
            name:        'Campus Peer',
            picture:     null,
            email:       null,
            avg_cal:     Math.round(best.avg_cal || 0),
            avg_protein: Math.round(best.avg_protein || 0),
            avg_fat:     Math.round(best.avg_fat || 0),
            avg_carbs:   Math.round(best.avg_carbs || 0),
            log_count:   best.log_count,
            highlights:  highlights
          },
          similarity: similarityScore,
          sharedFoods: sharedFoods.map(f => f.item_name)
      });
  }

  // Full self stats
  const myFull = {
    name: me.name,
    picture: me.picture,
    email: me.email,
    avg_cal:     Math.round(me.avg_cal || 0),
    avg_protein: Math.round(me.avg_protein || 0),
    avg_fat:     Math.round(me.avg_fat || 0),
    avg_carbs:   Math.round(me.avg_carbs || 0),
    log_count:   me.log_count
  };

  return {
    me: myFull,
    twins: twinsResult,
    days
  };
}

// ── EXPERIMENTS ───────────────────────────────────
function getExperiments(userId) {
  return db.prepare('SELECT * FROM experiments WHERE user_id = ? ORDER BY id DESC').all(userId);
}

function createExperiment(userId, title, durationDays, startDate) {
  const result = db.prepare('INSERT INTO experiments (user_id, title, duration_days, start_date) VALUES (?, ?, ?, ?)').run(userId, title, durationDays, startDate);
  return result.lastInsertRowid;
}

function updateExperimentStatus(experimentId, userId, status) {
  db.prepare('UPDATE experiments SET status = ? WHERE id = ? AND user_id = ?').run(status, experimentId, userId);
}

function getExperimentLogs(experimentId) {
  return db.prepare('SELECT * FROM experiment_logs WHERE experiment_id = ? ORDER BY date ASC').all(experimentId);
}

function addExperimentLog(experimentId, date, weight, hungerLevel, consistency, notes, autoCalories = null) {
  db.prepare(`
    INSERT INTO experiment_logs (experiment_id, date, weight, hunger_level, consistency, notes, auto_calories)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(experimentId, date, weight, hungerLevel, consistency, notes, autoCalories);
}

function deleteExperiment(experimentId, userId) {
  db.prepare('DELETE FROM experiment_logs WHERE experiment_id = ?').run(experimentId);
  db.prepare('DELETE FROM experiments WHERE id = ? AND user_id = ?').run(experimentId, userId);
}

function deleteExperimentLog(logId, experimentId) {
  // experimentId check is for extra safety
  db.prepare('DELETE FROM experiment_logs WHERE id = ? AND experiment_id = ?').run(logId, experimentId);
}

module.exports = {
  db,
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
  deleteMenu,
  deleteScrapeJob,
  getShortcuts,
  saveShortcut,
  addWaitTime,
  getWaitTimeStats,
  getWaitTimeStatsAll,
  clearStaleJobs,
  getLeaderboard,
  getTopItems,
  findDiningTwin,
  getExperiments,
  createExperiment,
  updateExperimentStatus,
  getExperimentLogs,
  addExperimentLog,
  deleteExperiment,
  deleteExperimentLog
};
