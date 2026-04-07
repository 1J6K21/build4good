# Mirror Page - V5 Polish Verification

## Fix 1: Reframed Language & Icon Swap
- [ ] **Verify VS -> Equals Icon**: Visit the Mirror page. In the center of the comparison card (between Your avatar and the Peer avatar), verify that the "VS" text has been replaced with a small equals (=) icon (<i class="fa-solid fa-equals"></i>).
- [ ] **Verify Subtitle**: Verify the page subtitle reads: "We found a student at your school with nearly identical eating patterns. Here's what their habits can teach yours."
- [ ] **Verify PEER Badge**: Verify the badge above the twin avatar now says "PEER" instead of "TWIN".
- [ ] **Verify Styling**: Ensure the PEER badge uses the green accent color and is not overly "aggressive".

## Fix 2: Similarity Reason String
- [ ] **Verify Reason String**: Below the "Dietary Similarity Score" percentage, verify there is a one-line explanation (e.g., "You both average 185g protein/day and have nearly identical carbs/day.")
- [ ] **Technical Check**:
    1. Open the browser console.
    2. Go to the Mirror page.
    3. Ensure `fetchMirror()` successfully populates `mirrorDataCache`.
    4. Check that the `mirrorSimReason` element is populated with a string derived from comparing `me` and `twin` stats.

## Fix 3: Peer Highlights Fallback
- [ ] **Trigger Fallback State**:
    1. Momentarily go to the database or seed data and remove/empty the `highlights` array for a user that is a potential twin.
    2. Alternatively, ensure the current twin match has no highlights.
    3. Reload the Mirror page.
- [ ] **Verify Placeholders**: In the "Game Plans That Worked" (formerly "On Your Level") section, verify that if no highlights are available, it displays **3 gray, muted placeholder cards** with a lock icon and the text "Log 7+ days to unlock real peer highlights." (Ensure it is NOT blank).

## Fix 4: Strategic Reframing
- [ ] **Verify Headers**: Verify the section header says "Game Plans That Worked" and the eyebrow label above it says "STEAL THEIR STRATEGY".

## Debugging: /api/mirror Response
The expected shape of the `/api/mirror` response should look like this (for console verification):
```json
{
  "me": {
    "name": "User Name",
    "avg_cal": 1850,
    "avg_protein": 140,
    "avg_carbs": 210,
    "avg_fat": 65,
    "log_count": 42
  },
  "twins": [
    {
      "twin": {
        "name": "Jane Smith",
        "avg_cal": 1845,
        "avg_protein": 142,
        "avg_carbs": 208,
        "avg_fat": 62,
        "log_count": 38,
        "highlights": []
      },
      "similarity": 98,
      "sharedFoods": ["Grilled Chicken", "Quinoa Salad"]
    }
  ],
  "days": 30
}
```

## Troubleshooting
- **What if `findDiningTwin()` always returns null?**
    Ensure there is at least one other user in the database with meal logs in the overlapping time period. If debugging locally, ensure `seed.js` or manual logs have created a second user.
