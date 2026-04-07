## Team: Experiments — Complete ✅

### What to test:
1. **Demo card shows when experiments list is empty:**
   - Log in as a new user with no experiments (e.g. `test-user-id` initially).
   - Navigate to the Experiments tab via the navigation menu.
   - **Expected:** A read-only demo card appears, labeled `EXAMPLE`. It should display '7-Day High Protein Challenge — CONCLUDED. Weight: 164.0 → 163.1 lbs. Days on track: 6/7.' and have a Results block at the bottom.
2. **Template pre-fills the title field:**
   - On the Experiments page, click "+ Start New Experiment".
   - Under the "Start from a Template" section, click one of the 3 templates (e.g., '💪 High Protein Week...').
   - **Expected:** The "Experiment Hypothesis / Rule" input is populated with the exact text of the template, and the "Duration (Days)" updates to the corresponding value.
3. **Results summary calculates correctly:**
   - Start an experiment for 3 days.
   - Log 3 entries (one per day). To do this locally, you can change your system clock, override `trackingDate` in the JS console, or just enter them and modify the DB `date` and `start_date` rows. For instance, log Weight 150->149->148, Hunger 3, 2, 4, and Consistency "On Track".
   - Reload the Experiments page and ensure the status is or becomes CONCLUDED.
   - **Expected:** A "Results" section should appear with: Weight Change (e.g., -2.0 lbs in green), Days On Track (e.g., 3/3 (100%)), and Avg Hunger (e.g., 3 / 5). (Compare with manual computation of your logged data).
4. **Auto-calories saves:**
   - Log some food in the dashboard so you have calories for today.
   - Go to Experiments, start or open an active experiment, click "Log Today".
   - Enter your metrics and save.
   - Check the experiment history in the card.
   - **Expected:** The UI displays "Today's logged calories: [amount]" in the log entry row.
   - **DB Check:** Run `sqlite3 data/menus.db "SELECT auto_calories FROM experiment_logs ORDER BY id DESC LIMIT 5;"`. The output should show integer values corresponding to the food logged.

### Troubleshooting:
- **Symptom**: Concluded status is never triggered  
  **Cause**: Date check logic comparing `startDate + durationDays <= today` might fail due to timezone offsets on the `today` object.  
  **Fix**: Check if `today.setHours(0,0,0,0)` matches the `startDate` parsed without timezone adjustments. Modifying `experiments.start_date` in the SQLite DB directly can help simulate time passing.

- **Symptom**: `auto_calories` always saves as `null` or `0`  
  **Cause**: User might not have logged any meals for the current `trackingDate`, or the date strings mismatch between `meal_logs` and `experiment_logs`.  
  **Fix**: Verify there are logs for today in `GET /api/user/logs?date=YYYY-MM-DD`. Ensure `date` string format aligns (YYYY-MM-DD).

### Debug info needed from user:
- [ ] Console output of: `fetch('/api/user/experiments', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } }).then(r=>r.json()).then(console.log)`
- [ ] Screenshot of: `The Experiments page with the Concluded results summary`
- [ ] HTTP response from: `GET /api/user/logs (Network tab) for the date the experiment log was placed`
