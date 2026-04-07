# Simulator & Emotional Consequence Counter Test Plan

## 1. Verify Baseline Calculation
1. Open the application and log in.
2. Open the browser console (F12 or Cmd+Option+J).
3. Type `window.simBaseline` and press Enter.
4. **Expected Shape:**
   ```json
   {
     "breakfast": 450,
     "lunch": 600,
     "dinner": 850,
     "snack": 200,
     "total": 2100
   }
   ```
   *Values should be non-negative integers representing average daily calories for each meal type over the last 14 days.*

## 2. Verify Hero Number Updates
1. Navigate to the **Dashboard** and scroll to the **Tradeoff Hub**.
2. Locate the **Future Habit Simulator**.
3. Drag the **Snacking Shift** slider to `-300 cal`.
4. Observe the `#simConsequenceNumber` (the large centered text).
5. **Expected Output:**
   * Text should change to something like `−7.7 lbs by [Month]`.
   * The number should be **green** (indicating weight loss).
   * Math check: `-300 cal * 90 days / 3500 ≈ -7.7 lbs`.
6. Drag the slider to `+200 cal`.
7. **Expected Output:**
   * Text should change to `+5.1 lbs by [Month]`.
   * The number should be **red** (indicating weight gain).

## 3. Verify Animation (Gut Punch)
1. Move any slider so the total change crosses from positive (red) to negative (green).
2. **Expected:** A brief (0.4s) green flash should pulse behind the hero number.
3. Move the slider back so it crosses from negative to positive.
4. **Expected:** A brief (0.4s) red flash should pulse behind the hero number.

## 4. Verification & Troubleshooting
### What to do if the number shows `NaN` or doesn't update?
* Refresh the page to re-initialize `window.simBaseline`.
* Ensure `window.simBaseline` is not `null` in the console.
* Check for console errors; a failed `logs-range` fetch will prevent baseline initialization.

### What to do if the baseline is 0?
* This happens if no meals have been logged in the last 14 days.
* Log some meals for yesterday and today, then refresh the dashboard.
* If testing on a fresh account, use the "Seeding Demo Data" workflow to populate 14 days of history.

### Debugging Console Command
Paste this to see the current internal state of the simulator:
```javascript
console.table(window.getSimulatorState());
```
