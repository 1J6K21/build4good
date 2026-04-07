# Calorie Debt Counter Testing Guide

## 1. Verify the SQL Math
To verify the debt calculation, you can run the following query against the SQLite database (`server/database.sqlite` or as defined in `db.js`):

```sql
SELECT date, SUM(calories) as dailyCals 
FROM meal_logs 
WHERE user_id = 'YOUR_USER_ID' 
GROUP BY date 
ORDER BY date ASC;
```

**Manual Calculation Steps:**
1. Note the user's current `calorie_goal` (default is 2000).
2. For each date returned by the query:
   - Calculate `delta = dailyCals - calorie_goal`.
3. Sum all those deltas to get `totalDebtCal`.
4. Divide `totalDebtCal` by 3500 to get `lbsImpact`.
5. Verify this matches the JSON returned by `GET /api/user/calorie-debt`.

---

## 2. Verify Widget Updates
1. Log into the application.
2. Note the current number in the Calorie Debt widget in the navbar (e.g., `+1.2 lbs`).
3. Browse the menu and log a high-calorie item (e.g., 500 calories).
4. After clicking "Log", watch the navbar widget.
5. The number should update immediately (e.g., to `+1.3 lbs` or `+1.4 lbs` depending on your current daily total).

Note: The update happens via `confirmLog()` calling `updateCalorieDebtWidget()`.

---

## 3. Verify Tooltip Rendering
1. Hover your mouse over the Calorie Debt widget in the navbar.
2. A black tooltip should appear below it.
3. Verify the text format: `'+4,200 cal above goal since your first log. That's roughly 1.2 lbs from dining alone.'` (values will vary).
4. Inspect the element (`#calorieDebtWidget`) in DevTools to see the `data-tooltip` attribute if the visual check is difficult.

---

## 4. Expected Response JSON
With seed data loaded for a user who has logged 52 items over several days, the response from `GET /api/user/calorie-debt` should look like this:

```json
{
  "totalDebtCal": 4200,
  "lbsImpact": 1.2,
  "direction": "surplus",
  "since": "2026-03-01",
  "daysTracked": 15
}
```

---

## 5. Troubleshooting: Infinity or NaN
If `lbsImpact` shows `Infinity` or `NaN`:
- Check if `totalDebtCal` is being divided by zero (unlikely since it's hardcoded to 3500).
- Check if `user.calorie_goal` is `null` or `0`.
- Check if any meal log entries have `null` or `NaN` calories.
- Verify `avg_cal` or other metrics aren't failing due to empty datasets (the backend handles `daysTracked < 3` specifically, but empty logs result in 0 debt).
- Ensure the `since` date parsed correctly from the SQLite `YYYY-MM-DD` format.
