# Macro & Analytics Testing Plan

This document outlines the specific tests needed to verify the "Intelligence Team" handover for the Aggie Dining Macro Tracking system.

## 🧪 Specific Tests to Run

### 1. The "Badge" Test
*   **Action**: Go to "The Commons" -> "Dinner" (or any station with dietary restrictions).
*   **Success Criteria**: You should see small labels like `VG` (Vegan), `V` (Vegetarian), or `GF` (Gluten Free) next to item names.
*   **What to report**: "Are the badges visible and correctly colored?"

### 2. The "Fallback" Test (Intelligence Check)
*   **Action**: Find an item that normally HAS calories, but maybe shows up as `0 cal` on a specific meal period.
*   **How to trigger**: I have manually seeded the `food_items` library. If a future scrape finds an item with the same name but missing calories, it should automatically pull the history.
*   **Success Criteria**: Check the server terminal for a log saying `[Scraper] Fallback estimation applied for: [Item Name]`.

### 3. The "Weekly Trends" Test
*   **Action**: Navigate to the Dashboard.
*   **Success Criteria**: A line chart should appear showing your protein intake over the last 7 days. (Note: It will be flat until you log meals for different days).
*   **What to report**: "Does the line chart render correctly with MM-DD dates on the bottom?"

### 4. The "Secondary Goals" Test
*   **Action**: Click the "Gear" icon or "Adjust Macro Goals" button on the dashboard.
*   **Success Criteria**: A modal should pop up allowing you to change Protein, Fat, and Carbs. Saving should immediately update the progress bars on the dashboard.

## 🛠️ Troubleshooting

### Bars not filling up?
- Ensure you have clicked "Log Meal" after selecting items in the menu.
- Check if the database `meal_logs` table has entries for today.

### Chart is empty?
- The chart pulls from the last 7 days. If you only have logs for today, you will only see one point. Try logging a meal and then manually changing your system clock or the `date` in the database to see a trend.

## 📝 What Information to Provide for Debugging
If anything fails, please send:
1.  **Browser Console Logs**: (Press F12 -> Console) and look for `Object` outputs under `[Frontend] Menu API response`.
2.  **Server Logs**: Copy any lines in the terminal starting with `[API]` or `[Scraper]`.
3.  **Screenshot of the Dashboard**: To see the specific layout where bars or charts might be broken.
