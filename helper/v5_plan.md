# Mindful Macros — v5.0 Execution Plan
> Derived from the UX critique. Priority order matches hackathon impact. Start with Phase 0 first — all teams depend on it.

---

## 🗺️ Roadmap Overview

| Phase | What | Who | Depends On |
|---|---|---|---|
| **Phase 0** | Seed Data & HTML Cleanup | **Team: Data** | Nothing — do this FIRST |
| **Phase 1A** | Simulator Emotional Moment | **Team: Simulator** | Phase 0 seed data |
| **Phase 1B** | Danger Window Banner | **Team: Behavioral** | Phase 0 seed data |
| **Phase 1C** | Leaderboard Default State | **Team: Social** | Nothing |
| **Phase 2A** | Experiments Polish | **Team: Experiments** | Phase 0 seed data |
| **Phase 2B** | Mirror / Twin Narrative | **Team: Mirror** | Phase 0 seed data |
| **Phase 2C** | Dashboard Hero Cleanup | **Team: Dashboard** | Nothing |
| **Phase 3** | Calorie Debt Counter | **Team: Debt** | Phase 0 seed data |

---

## 🛠️ Interface Contracts (Shared Data Agreements)

All teams must agree on these structures before writing a line of code. Frontend teams building against the db should use the `dev-test-token` bypass (`Authorization: Bearer dev-test-token`) to hit real endpoints locally.

### Contract 1 — Daily Log Entry (already exists, all teams read from this)
```json
{
  "id": 42,
  "user_id": "test-user-id",
  "date": "2026-03-27",
  "meal_type": "Dinner",
  "item_name": "Grilled Chicken Breast",
  "calories": 280,
  "protein": 52,
  "fat": 6,
  "carbs": 0,
  "serving_size": 1.0
}
```
Endpoint: `GET /api/user/logs?date=YYYY-MM-DD`  
Range endpoint: `GET /api/user/logs-range?start=YYYY-MM-DD&end=YYYY-MM-DD`

---

### Contract 2 — Simulator Projection Input/Output (Team: Simulator writes this)
The simulator reads the user's average daily calories per meal type from logs-range, then applies slider offsets. The output must be a single JS object consumed by `updateFutureProjection()`:
```json
{
  "baselineAvgCalories": 2180,
  "simulatedDailyCalories": 1880,
  "deltaCaloriesPerDay": -300,
  "projectionDays": 90,
  "projectedWeightDeltaLbs": -3.86,
  "labelText": "−3.9 lbs by June"
}
```
The **big number displayed** is `projectedWeightDeltaLbs` colored red (positive) or green (negative). Any team reading the simulator state should call `getSimulatorState()` which returns this object.

---

### Contract 3 — Danger Window State (Team: Behavioral writes this)
The Danger Window logic must expose a single callable function that returns:
```json
{
  "isDangerWindow": true,
  "dangerDayOfWeek": "Thursday",
  "avgCaloriesOnDangerDay": 2710,
  "todayCaloriesSoFar": 1100,
  "message": "⚠️ DANGER WINDOW — Thursdays avg 2,710 cal for you. You're at 1,100 today. Stay on track."
}
```
Function signature: `getDangerWindowState(logs, trackingDate)` — returns null if no danger window applies.  
The dashboard team imports this and injects the banner into the top of `#page-dashboard`.

---

### Contract 4 — Experiment Result Shape (Team: Experiments writes this)
When an experiment is "concluded" (day count reached or user marks done), the results view needs:
```json
{
  "id": 7,
  "title": "7-Day High Protein Challenge",
  "durationDays": 7,
  "startDate": "2026-03-22",
  "status": "concluded",
  "logs": [
    { "date": "2026-03-22", "weight": 164.0, "hunger_level": 3, "consistency": 3, "notes": "Felt good" },
    { "date": "2026-03-23", "weight": 163.5, "hunger_level": 2, "consistency": 3, "notes": "" }
  ],
  "summary": {
    "weightDelta": -0.9,
    "avgHunger": 2.4,
    "daysOnTrack": 6,
    "consistencyPct": 86
  }
}
```
The experiment card renders the `summary` block when `status === "concluded"`. The Experiments team must produce this shape from the DB and expose it in `GET /api/user/experiments`.

---

## 🏗️ Phase 0 — Seed Data & HTML Cleanup (Team: Data)
**Priority: HIGHEST. Do this before any other team starts.**  
**Goal:** Make the demo feel live from the first second. Every other team's features depend on having realistic data.

> **Prompt for Team: Data:**
> "The app's test user (`dev-test-token` / user ID `test-user-id`) has no meal history, which makes every dashboard widget show empty states during the demo. Your job has two parts:
>
> **Part A — Seed Script:** Write a Node.js script at `server/seed.js` that inserts 14 days of realistic meal logs for user ID `test-user-id` into the SQLite database. The data must follow this pattern:
> - Weekday breakfasts: ~400 cal (oatmeal, eggs), ~35g protein
> - Weekday lunches: ~650 cal (salad + grilled chicken), ~45g protein
> - Weekday dinners: ~750 cal (varies), ~40g protein
> - **Thursday and Saturday are Danger Days**: dinners are 950–1,200 cal, with dessert items logged (e.g. 'Chocolate Chip Cookie', 300 cal, 3g protein)
> - Include at least 2 days with no breakfast logged (to trigger the consistency heatmap yellow cells)
> - Use `meal_type` values: `Breakfast`, `Lunch`, `Dinner`, `Snack`
> - The script must be idempotent (running it twice doesn't duplicate data — check if logs already exist for test-user-id before inserting)
> - Run with: `node server/seed.js`
>
> **Part B — HTML Cleanup:** In `public/index.html`, delete the orphaned duplicate leaderboard HTML block at approximately lines 965–973 (a `<div class="card-body" id="leaderboardContent">` that sits outside any `page-*` div, along with the orphaned search button above it). Verify: search for `leaderboardContent` in the file — there should be exactly ONE occurrence after your cleanup.
>
> **Also remove:** the standalone `<button class="nav-btn" onclick="openGoalsModal()">` gear icon in the navbar (around line 76–78). The settings gear is already accessible via the user avatar dropdown — having two entry points to the same modal confuses the nav model.
>
> **Testing Required:** At the end, create `helper/data_tests.md` with:
> - How to verify the seed ran correctly (e.g., `SELECT COUNT(*) FROM meal_logs WHERE user_id = 'test-user-id'` — expected: ~55–65 rows)
> - How to verify the HTML cleanup (no duplicate IDs, no orphaned elements)
> - What to do if the seed script errors (`UNIQUE constraint failed`, `no such table`)
> - What output to share back for debugging (include the exact SQL query to paste and its expected result)"

---

## 🚀 Phase 1 — High-Impact Demo Features (Run in Parallel After Phase 0)

### 1A. Future Habit Simulator — Emotional Consequence Counter (Team: Simulator)
**Goal:** Replace the dry line graph with a live gut-punch weight number that animates as you drag sliders.

> **Prompt for Team: Simulator:**
> "The Future Habit Simulator in `public/app.js` (`updateFutureProjection()`) currently redraws a Chart.js line graph as sliders move. This is visually flat and emotionally inert. Your job is to make it hit like a gut punch:
>
> **Step 1 — Calculate Baseline:** When the simulator loads, call `GET /api/user/logs-range` for the last 14 days and compute the user's average daily calories broken down by meal type (breakfast avg, lunch avg, dinner avg, snack avg). Store these as `window.simBaseline = { breakfast, lunch, dinner, snack, total }`.
>
> **Step 2 — Slider Labels:** Each slider (`#simBreakfast`, `#simLunch`, `#simDinner`, `#simSnack`) must show two numbers:
> - `"Your avg: 480 cal"` (from baseline) in small gray text above the slider
> - `"New: 280 cal → -200/day"` updating live as the slider moves
>
> **Step 3 — The Hero Number:** Add a large centered `<div id="simConsequenceNumber">` ABOVE the chart canvas inside `.simulator-body`. It must display:
> - Font size: `3rem`, font-weight: `900`
> - Color: red if positive (gaining), green if negative (losing), gray if neutral
> - Text format: `"+3.9 lbs by June"` or `"−5.2 lbs by June"` (based on projection period from `#simPeriod`)
> - Below it in small text: a one-liner like `"Cut 3 desserts/week → save 5 lbs by finals"`
>
> **Step 4 — The Math:** Weight delta = `(simulatedDailyCalories - baselineAvgCalories) * projectionDays / 3500`. Round to 1 decimal. 3500 cal ≈ 1 lb.
>
> **Step 5 — Animation:** When the number crosses from positive to negative (or vice versa), add a brief CSS class `flash-green` or `flash-red` (0.4s) that pulses the background behind the number.
>
> Expose `getSimulatorState()` as described in Contract 2 above — it must return the current projection object so other features can reference it.
>
> **Testing Required:** Create `helper/simulator_tests.md` with:
> - How to verify baseline calculation (open console, type `window.simBaseline` — expected shape)
> - How to verify the hero number updates as you drag (expected: slider at -300 → hero shows approximately `-3.9 lbs` for 3-month period)
> - What to do if the number shows `NaN` or doesn't update
> - What to do if the baseline is 0 (no seed data loaded)
> - What console output to copy-paste for debugging"

---

### 1B. Danger Window Banner (Team: Behavioral)
**Goal:** When the current tracked date is the user's historically worst day-of-week, fire a live red banner at the top of the dashboard.

> **Prompt for Team: Behavioral:**
> "The app already has a 'Danger Day' widget that tells users which weekday historically has their highest calorie intake. Your task is to make that insight *proactive* — firing a live banner at the top of the dashboard when today is that danger day.
>
> **Step 1 — Logic function:** In `public/app.js`, add `getDangerWindowState(logs, trackingDate)` that:
> 1. Calls `GET /api/user/logs-range` for the last 28 days
> 2. Groups calorie totals by day-of-week (0 = Sunday … 6 = Saturday)
> 3. Finds the weekday with the highest average daily calories — this is the `dangerDayOfWeek`
> 4. Compares `dangerDayOfWeek` to the current `trackingDate`'s day-of-week
> 5. Returns the Contract 3 object (see top of this doc) if they match, or `null` if not
>
> **Step 2 — Banner HTML:** Add a `<div id="dangerWindowBanner" style="display:none;">` as the FIRST child inside `#page-dashboard > .newspaper-layout > .container`. It must:
> - Have a `background: #dc2626` (red) with white text
> - Show the `message` from the contract object
> - Include an `×` dismiss button that hides the banner for the session (`sessionStorage.setItem('dangerDismissed', '1')`)
> - Have `padding: 14px 24px`, `font-weight: 800`, `border-radius: 0` (goes edge-to-edge like a system alert, not a card)
>
> **Step 3 — Integration:** Call `getDangerWindowState()` inside `refreshDashboard()` after logs load. If it returns non-null AND `sessionStorage.getItem('dangerDismissed') !== '1'`, show the banner and populate its text.
>
> **Step 4 — Demo helper:** If the tracked date matches the danger day but the user has no data yet (seed not run), show a fallback demo version: `"⚠️ DANGER WINDOW — Thursdays are historically your highest calorie day. Log your meals carefully today."`
>
> **Testing Required:** Create `helper/behavioral_tests.md` with:
> - How to test the banner fires: change `trackingDate` in the console to a Thursday (or whichever is the seed data's danger day), call `refreshDashboard()`
> - How to test dismiss: click X → refresh → banner should NOT reappear
> - How to test the null case: set `trackingDate` to a Monday (non-danger day), call `refreshDashboard()` → banner should be hidden
> - What to do if the banner shows every day regardless
> - Console outputs to share for debugging"

---

### 1C. Leaderboard Default State (Team: Social)
**Goal:** Show the top 10 campus-wide items on page load — no search required.

> **Prompt for Team: Social:**
> "The Leaderboard page currently shows only a search bar (pre-filled with 'pizza') and nothing else until the user searches. This is a dead first impression. Your task is to make it feel alive from the moment you land.
>
> **Step 1 — Backend:** In `server/index.js`, add a new endpoint:
> `GET /api/leaderboard/top` — no auth required (public campuswide data)
> It calls a new `db.js` function `getTopItems(limit = 10)` that returns:
> ```json
> [
>   { \"item_name\": \"Grilled Chicken Breast\", \"total_servings\": 42, \"unique_users\": 8 },
>   { \"item_name\": \"Chocolate Chip Cookie\", \"total_servings\": 38, \"unique_users\": 11 }
> ]
> ```
> SQL: `SELECT item_name, SUM(serving_size) as total_servings, COUNT(DISTINCT user_id) as unique_users FROM meal_logs GROUP BY item_name ORDER BY total_servings DESC LIMIT ?`
>
> **Step 2 — Frontend:** In `showPage('leaderboard')`, immediately call a new `fetchTopLeaderboard()` function BEFORE the current search fires. It calls `GET /api/leaderboard/top` and renders:
> - A headline: `🏆 This Week's Campus Favorites` in bold uppercase
> - A podium row for the top 3 (gold / silver / bronze styling)
> - A ranked list (#4–#10) below
> - The existing search bar below that, so users can still search specific items
>
> **Step 3 — UI:** Replace the `value="pizza"` pre-fill in the search input with `placeholder="Search a specific food..."` (no pre-fill).
>
> **Step 4 — Empty state:** If `total_servings` is 0 for all items (no seed data), show: `"📊 No campus data yet — be the first to log a meal!"` instead of empty space.
>
> **Testing Required:** Create `helper/social_tests.md` with:
> - How to verify the top list loads on page entry (navigate to Leaderboard → list should appear within 300ms without typing anything)
> - How to verify the search still works after fixing the default state
> - Expected SQL output format to verify the backend endpoint is correct (paste the raw JSON response)
> - What to do if `getTopItems` returns an empty array even after seed data is inserted"

---

## 🏗️ Phase 2 — Feature Polish (Run in Parallel After Phase 1)

### 2A. Experiments Page Polish (Team: Experiments)
**Goal:** The page must never be blank. Add template experiments, auto-link to meal log data, and a results conclusion screen.

> **Prompt for Team: Experiments:**
> "The Experiments page is the most original feature in the app, but it always loads blank for new users and has no payoff when complete. Fix all three issues:
>
> **Problem 1 — Blank page:** When `fetchExperiments()` returns 0 active experiments AND the user has no previous experiments, immediately insert a 'demo experiment' card that is VISUALLY read-only (greyed border, 'EXAMPLE' badge) showing what a completed experiment looks like. Hard-code this card in HTML or JS — it should never be missing. Shape: '7-Day High Protein Challenge — CONCLUDED. Weight: 164.0 → 163.1 lbs. Days on track: 6/7.'
>
> **Problem 2 — No templates:** The 'New Experiment' modal currently has one free-text field. Add a 'Start from a Template' section with exactly 3 pre-built template buttons:
> - '💪 High Protein Week — Hit 150g protein daily for 7 days'
> - '🚫 No Dessert Challenge — Skip the dessert station for 5 days'
> - '🥗 Salad Starter — Begin every lunch with a salad for 7 days'
> Clicking a template pre-fills the `#expTitle` field. The user can still edit it.
>
> **Problem 3 — No results screen:** In `GET /api/user/experiments`, when an experiment's `status` is `'concluded'` or the `startDate + durationDays <= today`, compute the `summary` block (see Contract 4 above) and return it inside the experiment object. On the frontend, render a 'Results' section at the bottom of each concluded experiment card with:
> - Weight change: `−0.9 lbs` in green
> - Days on track: `6/7 (86%)`
> - Avg hunger: `2.4 / 5`
> - A one-line takeaway: `'You stayed consistent. High protein reduced hunger by day 3.'`
>
> **Problem 4 — No meal log link:** In `addExperimentLog()`, after saving the subjective log entry, automatically pull today's calorie total from `GET /api/user/logs?date=today` and save it alongside the experiment log record. Add a `auto_calories` column to the `experiment_logs` table (nullable integer). Show this in the experiment card as `'Today's logged calories: 1,840'` under the consistency rating.
>
> **Testing Required:** Create `helper/experiments_tests.md` with:
> - How to verify the demo card shows when experiments list is empty
> - How to verify a template pre-fills the title field
> - How to verify the results summary calculates correctly (manually compare weight logs)
> - How to verify auto_calories saves (check DB: `SELECT auto_calories FROM experiment_logs ORDER BY id DESC LIMIT 5`)
> - What to do if the concluded status is never triggered"

---

### 2B. Mirror / Twin Narrative Polish (Team: Mirror)
**Goal:** Fix the framing, explain the similarity score, and ensure Peer Highlights never displays blank.

> **Prompt for Team: Mirror:**
> "The Mirror page has strong bones but three issues that make it confusing or empty in a demo:
>
> **Fix 1 — Reframe the language:** Change all instances of 'TWIN' badge to `'PEER'`. Change the center label from `'VS'` to `''` (replace with a small icon: `<i class='fa-solid fa-equals'></i>`). Change the page subtitle to: 'We found a student at your school with nearly identical eating patterns. Here's what their habits can teach yours.' Update `mirror-player-badge.twin-badge` CSS to use `--accent` color (green) instead of any aggressive contrast.
>
> **Fix 2 — Explain the similarity score:** The `#mirrorSimilarityBanner` currently shows just a percentage. Below the `<div class='msb-label'>Dietary Similarity Score</div>`, add a `<div class='msb-reason' id='mirrorSimReason'>` that gets populated with a 1-line explanation when the mirror data loads, e.g.: `'You both average 185g protein/day and prefer dinner-heavy meal patterns.'` Build this string in `fetchMirror()` by comparing the `myStats` and `twinStats` objects — find the top 2 matching macro patterns and format them into a sentence.
>
> **Fix 3 — Peer Highlights fallback:** `#mirrorHighlightsRow` (the 'On Your Level' section) renders blank when the server returns no highlights. Add a fallback: if `highlights` is empty or missing, show 3 static placeholder highlight cards with gray styling and text: `'Log 7+ days to unlock real peer highlights.'` These placeholders should look like filled cards (same layout) but with a locked icon and muted colors — not an empty div.
>
> **Fix 4 — Framing of Peer Highlights header:** Change 'On Your Level' h3 to `'Game Plans That Worked'`. Change the eyebrow label from `'PEER HIGHLIGHTS'` to `'STEAL THEIR STRATEGY'`.
>
> **Testing Required:** Create `helper/mirror_tests.md` with:
> - How to verify the VS → equals icon swap rendered correctly
> - How to verify the similarity reason string generates (open console, check `fetchMirror()` response, ensure `myStats` and `twinStats` are both populated)
> - How to trigger the fallback highlights state (remove seed data temporarily, reload Mirror page)
> - Expected shape of the `/api/mirror` response for debugging (paste the full JSON)
> - What to do if `findDiningTwin()` always returns null"

---

### 2C. Dashboard Hero Cleanup (Team: Dashboard)
**Goal:** Fix the macro card empty states, move the external calories input, condense the macro layout, and make the streak counter real.

> **Prompt for Team: Dashboard:**
> "The top half of the dashboard (calorie ring + macro cards) feels like a generic macro tracker. Make these targeted fixes:
>
> **Fix 1 — Macro cards empty state:** When a goal isn't set yet (e.g., `proteinGoal = '--'`), instead of showing `0 / --g`, show `0g` with a small CTA button: `'Set Goal →'` that triggers `openGoalsModal()`. Never show `--` as a visible label.
>
> **Fix 2 — Move 'Add External Calories':** Remove the `#gapCaloriesInput` and its button from inside `.calorie-ring-card`. Instead, add it as a collapsed `<details>` element (HTML native, no JS needed) at the bottom of the `#todayMealsCard` section, below the meals list. Label: `'+ Add calories from outside the dining hall'`. When opened, show the number input and the button.
>
> **Fix 3 — Streak counter:** The `#statStreak` card currently hard-codes the fire emoji with no number. Implement `calculateStreak(userId)` on the frontend: call `GET /api/user/logs-range?start=<90daysAgo>&end=<today>`, group by date, and count the longest consecutive chain of dates with at least 1 log entry. Display as `'🔥 5'` (icon + number). If streak is 0, show `'—'`.
>
> **Fix 4 — Macro density:** Condense the 3 macro cards (Protein, Carbs, Fats) into a horizontal 3-column strip at 1/3rd the current height. Each strip segment shows: macro icon, label, `current/goal g`, and the mini SVG ring. Remove the `Remaining: Xg` line — it's redundant with the ring percentage. This frees significant vertical space above the fold.
>
> **Fix 5 — Goals modal double-confirm:** In `applyAdvisorSuggested()`, call `saveGoals()` automatically after applying — don't make the user click 'Save Goals' separately. One button = one action.
>
> **Testing Required:** Create `helper/dashboard_tests.md` with:
> - How to verify the streak calculates correctly (manually count consecutive days in seed data, compare to displayed streak)
> - How to verify the empty-state goal CTA appears when goals aren't set (open Goals modal, clear all fields, save, reload dashboard)
> - How to verify the external calories input moved correctly (check it no longer appears in the ring card)
> - What to do if the streak always shows 0 even with seed data
> - SQL query to verify seed data has the right date distribution for streak calculation"

---

## 🔁 Phase 3 — The Calorie Debt Counter (Team: Debt)
**Goal:** A persistent semester-level calorie surplus/deficit counter visible in the navbar.

> **Prompt for Team: Debt:**
> "Every current feature resets daily. Add a persistent counter that shows the user's *cumulative* calorie surplus or deficit since the first date they logged a meal. This is the Freshman 15 made quantified and undeniable.
>
> **Step 1 — Backend:** Add `GET /api/user/calorie-debt` (authenticated). It:
> 1. Fetches ALL meal logs for the user since their first log date
> 2. Groups by date, sums daily calories
> 3. For each date, computes `dailyCals - user.calorie_goal`
> 4. Sums all daily deltas → `totalDebt` (positive = surplus, negative = deficit)
> 5. Converts to approx lbs: `lbsImpact = totalDebt / 3500`
> Returns:
> ```json
> {
>   \"totalDebtCal\": 4200,
>   \"lbsImpact\": 1.2,
>   \"direction\": \"surplus\",
>   \"since\": \"2026-01-15\",
>   \"daysTracked\": 52
> }
> ```
>
> **Step 2 — Navbar widget:** Add a small `<div id='calorieDebtWidget'>` in the `.nav-inner` between the date wrapper and the nav links. It shows:
> - `+1.2 lbs` in red (if surplus) or `−0.8 lbs` in green (if deficit) — font-weight: 900
> - Below in tiny caps: `SINCE JAN 15` 
> - A tooltip on hover: `'+4,200 cal above goal since your first log. That's roughly 1.2 lbs from dining alone.'`
> - Border-right: `1px solid #000` to match navbar style
>
> **Step 3 — Live update:** After every successful `confirmLog()` call, re-fetch the debt widget and update it in the navbar without a page reload.
>
> **Step 4 — Demo helper:** If `daysTracked < 3`, show `'Calculating...'` in the widget (not a zero or error).
>
> **Testing Required:** Create `helper/debt_tests.md` with:
> - How to verify the SQL math: paste the raw query and manually calculate expected total from seed data
> - How to verify the widget updates after logging (log a 500-cal item, check the navbar number changes)
> - How to verify the tooltip renders on hover (inspect element vs. visual check)
> - Expected response JSON from `GET /api/user/calorie-debt` with seed data loaded
> - What to do if `lbsImpact` shows `Infinity` or `NaN`"

---

## 🗑️ Cleanup Tasks (Any Team, ~10 min total)
These are quick removals that improve signal-to-noise ratio. Assign to whoever finishes first.

- [ ] **Remove static newspaper sidebar blurbs**: Replace 10 of the `news-clipping` divs in both sidebars with 3 dynamic personalized fact clippings each side (populated via JS from user data: most-logged item, longest streak, biggest danger day). Keep the visual newspaper aesthetic, swap the content.
- [ ] **Remove the 'Copyable Meal Object (JSON)'** block from `#aggregateModalBackdrop`. Replace with just the stats grid and a "Done" button. Developers can use the browser inspector.
- [ ] **Fix CSS class naming**: The Goals modal inputs use `class="filter-date"` — rename to `class="form-input"` for semantic accuracy.
- [ ] **Kill the `class="dropdown-item"` logout button CSS**: It applies `color: var(--red)` to ALL dropdown buttons including "Macro Goals" which should not be red. Add a specific class `dropdown-item-danger` to only the logout button and change the CSS accordingly.

---

## 📋 Testing Return Format

When each team finishes, they should report back the following (copy this template):

```
## [Team Name] — Complete ✅

### What to test:
1. [Step-by-step test with exact expected output]
2. ...

### Troubleshooting:
- **Symptom**: [what goes wrong]  
  **Cause**: [why it happens]  
  **Fix**: [exact command or code change]

### Debug info needed from user:
- [ ] Console output of: `[exact JS or SQL to run]`
- [ ] Screenshot of: `[specific UI state]`
- [ ] HTTP response from: `[endpoint URL]`
```

---

## 📈 Post-Hackathon (v6.0 Ideas)
These are too big for now but worth noting:

- **Tray Audit (Photo Intelligence):** On-device or server-side vision model estimates macros from a tray photo. Removes logging friction entirely.
- **Dessert Unlock System:** Protein threshold gate before dessert items unlock in the menu. Gamifies the pre-meal decision.
- **Eating-With Social Layer:** Tag who you ate with, surface "You eat 340 more calories with [name]" behavioral pattern.
- **Danger Window Push Notifications:** PWA push notification sent at 6PM on each user's danger day-of-week with their current-day calorie status.
