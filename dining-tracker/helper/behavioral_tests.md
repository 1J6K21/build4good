## Behavioral Team — Complete ✅

### What to test:

1. **Test the Banner Fires (Fallover/Demo State):**
   - Open the app.
   - Open the browser console (Inspect -> Console).
   - Type: `trackingDate = "2026-03-26"; refreshDashboard();`  *(Note: March 26, 2026 is a Thursday)*.
   - **Expected Output:** A red banner should appear at the top of the dashboard saying: `"⚠️ DANGER WINDOW — Thursdays are historically your highest calorie day. Log your meals carefully today."`

2. **Test Dismissal:**
   - Click the `×` button on the red banner.
   - The banner should disappear.
   - Refresh the page or call `refreshDashboard()` in the console.
   - **Expected Output:** The banner should **NOT** reappear (it's hidden for the session).

3. **Test the Null Case (Non-Danger Day):**
   - Open the console.
   - Type: `sessionStorage.clear(); trackingDate = "2026-03-23"; refreshDashboard();` *(Note: March 23, 2026 is a Monday)*.
   - **Expected Output:** The banner should be hidden.

4. **Test Real Data Logic (after Seed):**
   - If you have run the seed data script (which sets Thursdays and Saturdays as danger days):
   - Type: `trackingDate = "2026-03-28"; refreshDashboard();` *(Saturday)*.
   - **Expected Output:** The banner should show real stats, e.g., `"⚠️ DANGER WINDOW — Saturdays avg 2,850 cal for you. You're at 0 today. Stay on track."`

### Troubleshooting:

- **Symptom**: The banner shows every day regardless of the date.
  **Cause**: `getDangerWindowState` might be returning a truthy object for every day, or the comparison logic is flawed.
  **Fix**: Check `dangerDayOfWeekNum === currentDayNum` in `app.js`.

- **Symptom**: Banner doesn't show even on Thursday.
  **Cause**: `sessionStorage.getItem('dangerDismissed')` might be set to '1'.
  **Fix**: Run `sessionStorage.clear()` in the console.

### Debug info needed from user:
- [ ] Console output of: `getDangerWindowState(lastFetchedLogs, trackingDate).then(console.log)`
- [ ] Screenshot of: The top of the dashboard when `trackingDate` is set to a Thursday.
