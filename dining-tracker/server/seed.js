const { addMealLog, getMealLogsRange, upsertUser } = require('./db');

async function seed() {
  const userId = 'test-user-id';
  
  console.log(`[Seed] Checking for existing logs for user: ${userId}...`);
  
  // Ensure user exists
  await upsertUser({
    id: userId,
    email: 'test@example.com',
    name: 'Test User',
    picture: null
  });

  // Calculate date range: 14 days ending today
  const today = new Date();
  
  // Idempotency: For a clean demo state, we clear existing logs for the test user 
  // and re-seed the exact 14-day window. This ensures the demo data is always perfect.
  console.log(`[Seed] Clearing existing logs for user: ${userId}...`);
  const { db } = require('./db');
  db.prepare('DELETE FROM meal_logs WHERE user_id = ?').run(userId);

  const breakfastOptions = [
    { name: 'Oatmeal with Protein Powder', calories: 410, protein: 36 },
    { name: 'Double Scrambled Eggs & Toast', calories: 420, protein: 34 },
    { name: 'Greek Yogurt & Extra Protein Parfait', calories: 390, protein: 38 },
    { name: 'Large Protein Pancakes', calories: 430, protein: 40 }
  ];

  const lunchOptions = [
    { name: 'Big Grilled Chicken Salad', calories: 640, protein: 48 },
    { name: 'Double Turkey & Avocado Wrap', calories: 670, protein: 44 },
    { name: 'Steak & Quinoa Power Bowl', calories: 650, protein: 42 },
    { name: 'Lemon Herb Salmon Salad', calories: 660, protein: 46 }
  ];

  const dinnerOptions = [
    { name: 'Ribeye Steak and Asparagus', calories: 780, protein: 55 },
    { name: 'Chicken Pasta Primavera', calories: 730, protein: 38 },
    { name: 'Teriyaki Chicken Stir-fry', calories: 760, protein: 44 },
    { name: 'Grilled Salmon with Broccoli', calories: 740, protein: 48 }
  ];

  const dangerDinnerOptions = [
    { name: 'Double Bacon Cheeseburger', calories: 980, protein: 45 },
    { name: 'Large Pepperoni Pizza Slice x3', calories: 1100, protein: 35 },
    { name: 'Fettuccine Alfredo with Shrimp', calories: 1050, protein: 40 }
  ];

  const skipBreakfastDays = [3, 8]; // Index of days to skip breakfast (0-13)

  for (let i = 0; i < 14; i++) {
    const date = new Date();
    date.setDate(today.getDate() - (13 - i));
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay(); // 0 = Sunday, 4 = Thursday, 6 = Saturday

    // Breakfast (Skip on specific days)
    if (!skipBreakfastDays.includes(i)) {
      const b = breakfastOptions[Math.floor(Math.random() * breakfastOptions.length)];
      addMealLog(userId, dateStr, 'Breakfast', b.name, b.calories, 1.0, b.protein);
      // Optional side
      if (Math.random() > 0.5) {
        addMealLog(userId, dateStr, 'Breakfast', 'Orange Juice', 110, 1.0, 1);
      }
    }

    // Lunch
    const l = lunchOptions[Math.floor(Math.random() * lunchOptions.length)];
    addMealLog(userId, dateStr, 'Lunch', l.name, l.calories, 1.0, l.protein);
    addMealLog(userId, dateStr, 'Lunch', 'Mixed Fruit Bowl', 80, 1.0, 1);

    // Dinner
    if (dayOfWeek === 4 || dayOfWeek === 6) {
      // Danger Days (Thursday and Saturday)
      const d = dangerDinnerOptions[Math.floor(Math.random() * dangerDinnerOptions.length)];
      addMealLog(userId, dateStr, 'Dinner', d.name, d.calories, 1.0, d.protein);
      addMealLog(userId, dateStr, 'Dinner', 'Side of Fries', 350, 1.0, 4);
      
      // Dessert
      addMealLog(userId, dateStr, 'Snack', 'Chocolate Chip Cookie', 300, 1.0, 3);
      if (Math.random() > 0.5) {
        addMealLog(userId, dateStr, 'Snack', 'Ice Cream Scoop', 150, 1.0, 2);
      }
    } else {
      const d = dinnerOptions[Math.floor(Math.random() * dinnerOptions.length)];
      addMealLog(userId, dateStr, 'Dinner', d.name, d.calories, 1.0, d.protein);
      addMealLog(userId, dateStr, 'Dinner', 'Side Salad', 45, 1.0, 1);
    }

    // Occasional Snack
    if (Math.random() > 0.7) {
      addMealLog(userId, dateStr, 'Snack', 'Apple', 95, 1.0, 0.5);
    }
  }

  console.log(`[Seed] Successfully seeded 14 days of data for ${userId}.`);
}

seed().catch(err => {
  console.error('[Seed] Error seeding data:', err);
  process.exit(1);
});
