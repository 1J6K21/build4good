# Dashboard Testing Guide

This document covers how to verify the new Dashboard fixes related to Macro empty states, the gap-calorie input move, and streak calculation.

## Verify the streak calculates correctly
1. Manually count the consecutive days of logging: look at the seed data (e.g. your database rows or the `fix_db.js` distribution), starting from today and moving backwards, until there is a day with 0 logs.
2. The number on the dashboard streak (`🔥 X`) should match that count. Example: If today is logged, yesterday is logged, and the day before is logged, but the day prior to that is completely empty, the streak should be `3`.
3. If logs contain a continuous chain that was eventually broken, the current logic calculates the *longest* streak found within the last 90 days. Check the exact max continuous day span.

## Verify the empty-state goal CTA appears
1. Open the user profile dropdown and click **Macro Goals** to open the Goals modal.
2. Clear all macro goal inputs (leave them blank).
3. Click "Save Goals" to update the database with `null`/cleared values.
4. Reload the dashboard page.
5. In the Macro Strip, instead of seeing "0 / -- g", you should see "0g" accompanied by a small `Set Goal →` button next to the value.

## Verify the external calories input moved correctly
1. Inspect the Daily Calories Ring card at the top. It should no longer contain an input/button at the bottom.
2. Review the `#todayMealsCard` section ("Today's Meals").
3. Scroll just below the meals list. You should see a collapsed native `<details>` element labeled `+ Add calories from outside the dining hall`.
4. Click to expand it: verify the number input and "Add" button appear inside.

## What to do if the streak always shows 0 even with seed data
- **Check your Local Time:** The streak calculation groups logs by date using `Date` objects based on the tracker's `trackingDate` (defaults to today in local time) and the logs' exact `date` string (e.g., `2026-03-29`).
- **Date Matching:** If logs have timestamps, make sure the string truncation returns the correct 'YYYY-MM-DD' that matches what `calculateStreak()` builds via `formatDate()`.
- **Database Logs Content:** Verify that the seed data actually generated consecutive dates. If it used random skipped dates, long streaks might not have formed. 

## SQL query to verify date distribution for streak calculation
Run the following query in your database tool (e.g. `sqlite3 build4good.db`) to see the volume of logs printed day by day:
```sql
SELECT date, COUNT(*) as logs_count
FROM meal_logs
WHERE user_id = (SELECT id FROM users LIMIT 1) -- Note: adjust if your user differs
GROUP BY date
ORDER BY date DESC
LIMIT 90;
```
If you see missing dates in between, the streak is legitimately broken there.
