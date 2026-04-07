# 🔐 Auth & Sync Testing Guide

This guide outlines exactly how to verify that the **Identity & Backend** transition was successful. 

## 🛠️ Setup & Execution

### 1. Configure Secrets
Ensure your `.env` file in `dining-tracker/` has these two keys:
```bash
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
JWT_SECRET=your-random-secret-string
```

### 2. Start the Server
Open your terminal and run:
```bash
cd /Users/jonathankalsky/Documents/GitHub/build4good/dining-tracker
npm start
```
The console should say: `🍽️ Aggie Dining Tracker (Auth-Enabled) running on http://localhost:3333`.

---

## 🧪 The "Auth V2" Test Suite

Run these tests in order. If any fail, please provide the **Debug Response** listed for that test.

### Test 1: The "Locked Hall" (Initial Access)
*   **Action**: Open `http://localhost:3333` in an Incognito/Private window.
*   **Success**: You see the **Maroon Splash Screen** with a "Sign in with Google" button. The Navbar and Dashboard are **hidden**.
*   **Troubleshooting**: If you can see the dashboard immediately, clear your browser cookies for `localhost`.
*   **Debug Response**: *"Test 1: Dashboard is [Visible/Hidden]. Splash screen [Appeared/Missing]."*

### Test 2: The "Keycard" (Google Login)
*   **Action**: Click the Google Sign-In button and log in with your account.
*   **Success**: 
  - The splash screen disappears.
  - The Navbar appears with your **Google Avatar** in the top-right.
  - You land on the Dashboard.
*   **Troubleshooting**: 
  - **Button doesn't load**: Check that Google's script isn't blocked by an ad-blocker.
  - **Login fails**: Verify your `GOOGLE_CLIENT_ID` in the Google Cloud Console has `http://localhost:3333` as an **Authorized Origin**.
*   **Debug Response**: *"Test 2: Login [Success/Fail]. Profile Picture [Appears/Missing]. JS Console Errors: [List any]."*

### Test 3: The "Memory" (Persistent DB Sync)
*   **Action**: Go to "Browse Menu," pick a meal, and click **Log Meal**. Refresh the page.
*   **Success**: 
  - The Dashboard ring updates.
  - **After Refresh**: The logged meal and calorie count **stay there**.
*   **Troubleshooting**: If data disappears on refresh, it likely saved to `localStorage` instead of the SQLite database. Check server logs for SQLite errors.
*   **Debug Response**: *"Test 3: Data [Persisted/Disappeared] after refresh. Server logs show [Paste any errors]."*

### Test 4: The "Goal Setter"
*   **Action**: Click **Edit Goal** on the Dashboard, change it (e.g., to 2800), and refresh.
*   **Success**: The goal ring updates to `2800` and stays there after refresh.
*   **Troubleshooting**: Check the `users` table in the database to see if `calorie_goal` was updated.
*   **Debug Response**: *"Test 4: Goal [Saved/Reset]."*

### Test 5: The "Exit" (Sign Out)
*   **Action**: Click your profile picture > **Sign Out**. Refresh.
*   **Success**: You are returned to the splash screen. Navigating to `/dashboard` directly redirects you to login.
*   **Troubleshooting**: If you are still logged in, the `auth_token` cookie was not cleared.
*   **Debug Response**: *"Test 5: [Back to Splash/Still in App]."*
