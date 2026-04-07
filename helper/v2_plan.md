# Aggie Dining Tracker — v2.0 Execution Plan

This roadmap outlines the transition from a local prototype to a production-ready student health platform. 

---

## 🗺️ My Recommended Roadmap

1.  **Phase 1: Interface Contracts (The Secret Sauce)**: Define the shared API structure so multiple agents can work without fighting.
2.  **Phase 2: Sequential Core (Auth & Database)**: Add the `users` table and a layout that handles login state.
3.  **Phase 3: The Parallel Split (The big jump!)**: 
    *   **Agent A (Copy 1)**: Works on the **Scraper bypass & Pre-scraping** logic in `server/scraper.js`.
    *   **Agent B (Copy 2)**: Works on the **Macro Tracking & Charts** in the frontend `public/app.js`.

---

## 🛠️ Interface Contracts (The Agreements)

To parallelize, all agents must agree on these shared data structures. This allows the Frontend team to build the Dashboard with "Mock Data" while the Auth team is still building the login.

### 1. The User Resource (`GET /api/user/me`)
All agents should assume this endpoint exists and returns:
```json
{
  "authenticated": true,
  "user": {
    "id": "abc-123",
    "email": "student@tamu.edu",
    "goalCalories": 2200,
    "lastLocation": "the-commons-dining-hall-south-campus"
  }
}
```

### 2. The Database Protocol
Any agent modifying the database must check for or initialize these tables:
*   `users`: `id`, `email`, `goal_calories`, `created_at`
*   `user_logs`: `id`, `user_id`, `date`, `total_cal`, `items (JSON)`

---

## 🏗️ Phase 1: Identity & Backend (The "Auth" Team)
**Goal:** Transition from LocalStorage to a Persistent Database.
> **Prompt:** "Current users only have local browser storage. We need to transition to a multi-user system. Implement a 'NetID-style' or Google OAuth login flow. On the backend, refactor the SQLite schema to associate meal logs with a `user_id`. Ensure that calorie goals and history are synced to the database so students can switch from their laptop to their phone without losing their streak. **Testing Required:** At the end, create a `helper/auth_tests.md` that lists specific tests, how to troubleshoot them, and exactly what information you want to hear back from the user for debugging."

---

## 🚀 Phase 2: Parallelized Specialization

### 1. Infrastructure & Bypassing (The "DevOps" Team)
**Goal:** Reliability & Production Scaling.
> **Prompt:** "We have a Node.js/Puppeteer scraper that successfully pulls TAMU dining data. Your task is to containerize this using Docker and deploy it to a platform like Fly.io or AWS. **Bypassing Blocks:** Scraping from a single home IP address eventually gets you blocked. Cloud platforms make it easier to integrate proxy rotation and user-agent switching to look like many different students rather than one bot. Set up a cron job to pre-scrape the 'Big 3' dining halls at 5 AM every morning so the first student of the day never has to wait. **Testing Required:** At the end, create a `helper/devops_tests.md` that lists specific tests, how to troubleshoot them, and exactly what information you want to hear back from the user for debugging."

### 2. Frontend & UX (The "Mobile First" Team)
**Goal:** Premium Branding & Progressive Web App.
> **Prompt:** "The current UI is a functional SPA. Your goal is to turn this into a premium 'Apple Health' style experience. Implement a 'Mobile-first' design system using CSS variables for a Dark Mode. Add a progress-focused dashboard with smooth SVG transitions for the calorie rings. Finally, configure this as a Progressive Web App (PWA) with a Web App Manifest so students can 'Add to Home Screen' and use it like a native iOS/Android app. **Testing Required:** At the end, create a `helper/frontend_tests.md` that lists specific tests, how to troubleshoot them, and exactly what information you want to hear back from the user for debugging."

### 3. Data Science & Macros (The "Intelligence" Team)
**Goal:** Precision Tracking & Trends.
> **Prompt:** "Right now we only track total calories. We need to parse the 'Badges' (VG, V, GF) and macronutrients (Protein, Carbs, Fats) from the menu items. Create an analytics dashboard that shows a student's weekly protein intake trends and allows them to set secondary goals (e.g., 'Eat 100g of protein today'). If an item is missing calorie data, implement a fallback estimation logic based on similar item history. **Testing Required:** At the end, create a `helper/macros_tests.md` that lists specific tests, how to troubleshoot them, and exactly what information you want to hear back from the user for debugging."

---

## 🔄 How to Merge Later

Merging is easy! Since all agents are using Git:

1.  **Finish Agent A**: `git commit -m "pre-scraping logic"`
2.  **Finish Agent B**: `git commit -m "macro charts UI"`
3.  **On your main branch**: `git merge feature/pre-scrape` then `git merge feature/macros`.
4.  **Conflicts**: If they both edited the exact same line in `server/index.js`, Git will ask you which one to keep — but with separate clones, this is rare.

---

## 📈 Long-term Goal (v3.0)
*   **Predictive Menus**: Anticipate what Sbisa will serve based on historical patterns.
*   **Workout Integration**: Sync with Apple Health / Google Fit to adjust calorie goals automatically.
*   **Social Goals**: Shared challenges among roommates or student organizations.
