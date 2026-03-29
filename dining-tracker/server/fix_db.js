const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/menus.db');
const db = new Database(DB_PATH);

const fixTable = (table, columns) => {
    for (const col of columns) {
        try {
            db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} INTEGER DEFAULT 0`).run();
            console.log(`[DB Fix] Added ${col} to ${table}`);
        } catch (e) {
            // Probably already exists
        }
    }
}

fixTable('food_items', ['sodium', 'fiber', 'sugar', 'sugars', 'saturated_fat', 'trans_fat', 'cholesterol']);
fixTable('meal_logs', ['protein', 'fat', 'carbs', 'sodium', 'fiber', 'sugar', 'sugars', 'saturated_fat', 'trans_fat', 'cholesterol']);

console.log('[DB Fix] Schema check complete.');
