# Data & HTML Cleanup Verification

This document outlines how to verify the seed script and the subsequent HTML cleanup.

## Part A: Seed Verification

To verify that the seed script ran correctly and populated the database with realistic data for `test-user-id`, run the following SQL query:

```sql
SELECT COUNT(*) FROM meal_logs WHERE user_id = 'test-user-id';
```

**Expected Result:** ~60–85 rows (depending on random snacks/sides). 

You can also check the distribution of meals to ensure the pattern was followed:

```sql
SELECT meal_type, COUNT(*) FROM meal_logs WHERE user_id = 'test-user-id' GROUP BY meal_type;
```

### Potential Issues & Fixes:
- **UNIQUE constraint failed**: This shouldn't happen as the script is idempotent and clears old logs before inserting. If it does, manually clear the table: `DELETE FROM meal_logs WHERE user_id = 'test-user-id';`.
- **"No such table"**: Ensure you are running the script from the root directory and that `server/db.js` has already initialized the database.

---

## Part B: HTML Cleanup Verification

### 1. Leaderboard Deduplication
Search the `public/index.html` file for `leaderboardContent`. There should be exactly **ONE** occurrence.

```bash
grep "leaderboardContent" public/index.html | wc -l
```

### 2. Redundant Navbar Gear Removal
The standalone gear button in the navbar (usually around line 76) has been removed. Check that the only way to access "Macro Goals" is via the user avatar dropdown menu.

---

## Debugging Info

If the seed script errors, please share the output of:
1. `node server/seed.js`
2. `ls -l data/menus.db`
3. `sqlite3 data/menus.db "SELECT * FROM meal_logs WHERE user_id = 'test-user-id' LIMIT 5;"`
