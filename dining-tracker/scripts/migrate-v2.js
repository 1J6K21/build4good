/**
 * DB MIGRATION: V2 (Goal-Offset Update)
 * ------------------------------------
 * PURPOSE: 
 *   Previously, 'Major' (Bulking/Cutting) was a local-only advisor guess.
 *   This script adds a 'goal' column to store the user's focus (-500, 0, 500) 
 *   permanently in the DB and removes the legacy 'major' label field.
 * 
 * HOW TO RUN:
 *   Local: node scripts/migrate-v2.js
 *   Fly.io: Part of automated 'fly deploy' (see fly.toml release_command)
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Support running on Fly.io where DB is in /app/data
const isFly = process.env.FLY_APP_NAME;
const DB_PATH = isFly 
    ? '/app/data/menus.db' 
    : path.join(__dirname, '../data/menus.db');

if (!fs.existsSync(DB_PATH)) {
    console.error(`[Error] Database not found at ${DB_PATH}`);
    process.exit(1);
}

const db = new Database(DB_PATH);

console.log(`[Migration] Target database: ${DB_PATH}`);

try {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    const hasMajor = columns.some(c => c.name === 'major');
    const hasGoal = columns.some(c => c.name === 'goal');
    
    if (hasMajor || !hasGoal) {
        console.log('[Migration] Upgrading users table schema...');
        
        // Disable foreign keys temporarily for the table swap
        db.pragma('foreign_keys = OFF');
        
        try {
            db.transaction(() => {
                // 1. Create the new schema
                db.prepare(`
                    CREATE TABLE users_new (
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
                        goal INTEGER DEFAULT 0,
                        gpa REAL DEFAULT 4.0,
                        created_at INTEGER
                    )
                `).run();
                
                const commonCols = "id, email, name, picture, calorie_goal, protein_goal, fat_goal, carb_goal, height, weight, tracked_nutrients, gpa, created_at";
                
                db.prepare(`
                    INSERT INTO users_new (${commonCols}, goal)
                    SELECT ${commonCols}, 0 FROM users
                `).run();
                
                db.prepare("DROP TABLE users").run();
                db.prepare("ALTER TABLE users_new RENAME TO users").run();
            })();
            console.log('[Migration] Success! Database is now v2.');
        } finally {
            // Re-enable foreign keys
            db.pragma('foreign_keys = ON');
        }
    } else {
        console.log('[Migration] Database is already at v2.');
    }
} catch (e) {
    console.error('[Migration] CRITICAL ERROR:', e);
    process.exit(1);
} finally {
    db.close();
}
