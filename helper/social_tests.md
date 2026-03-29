# Social Leaderboard Default State Tests

This testing guide verifies that the new default state for the Leaderboard works correctly.

## 1. Verify Top List Loads on Page Entry
1. Start the server (`npm start`) if it's not already running.
2. Log in and navigate to the **Leaderboard** tab using the main navigation.
3. You should see `🏆 THIS WEEK'S CAMPUS FAVORITES` appear immediately (within 300ms) without having to type anything into the search bar.
4. There will be a visual podium for the top 3 items (Gold, Silver, Bronze), followed by a ranked list (#4-#10).
5. The search bar (`Search a specific food...`) will be positioned right below this default section.

## 2. Verify Search Still Works
1. When on the Leaderboard tab with the default top list shown, click into the search input.
2. Type a specific food item (e.g., `chicken`, `pizza`).
3. The original search query functionality should fire off, dropping a section exactly below the search bar to show the filtered leaderboard for that item.
4. The top list (Campus favorites) should remain untouched.
5. If you delete your search string, the query results for the searched item will just disappear and return to the empty state `"Type a food item to see the leaderboard!"` while the top list remains untouched.

## 3. Expected SQL Output Format from Endpoint
To verify the DB is correctly returning the data:
```bash
curl "http://localhost:3333/api/leaderboard/top?limit=10"
```
The raw JSON response should look exactly like this:
```json
[
  {
    "item_name": "Grilled Chicken Breast",
    "total_servings": 42,
    "unique_users": 8
  },
  {
    "item_name": "Chocolate Chip Cookie",
    "total_servings": 38,
    "unique_users": 11
  }
]
```

## 4. Troubleshooting Empty `getTopItems` Response
If the endpoint returns an empty array `[]` (or empty state `"📊 No campus data yet — be the first to log a meal!"`) despite seed data being present in the database, double-check the following:

- **Ensure serving sizes are valid**: The `serving_size` column defaults to `1.0`. The SQL query sums over `serving_size`. If they are heavily downcasted or interpreted as strings by sqlite due to manual insertion, running a cast might be necessary `SUM(CAST(serving_size AS REAL))`.
- **Data timestamp/range issues**: The current SQL sums everything in `meal_logs`. Make sure your seeded data is correctly populated in the `meal_logs` table specifically.
- **Ensure rows in `meal_logs` have user IDs**: The user must exist in the users table, and the log's `user_id` should correctly map.
- **Ensure no typos**: The function `getTopItems(limit=10)` must be successfully registered in the backend endpoints (`server/index.js` and `db.js`). Ensure you didn't accidentally wipe out mock data by testing another workflow before validating this one.
