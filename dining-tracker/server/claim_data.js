require('dotenv').config();
const { db, addMealLog } = require('./db');

async function claimData() {
  const email = process.argv[2];
  const secret = process.argv[3];
  const expectedSecret = process.env.CLAIM_SECRET;

  if (!email || !secret) {
    console.error('Error: Please provide both the user email AND the secret passphrase.');
    console.error('Usage: node server/claim_data.js <user@email.com> <secret>');
    process.exit(1);
  }

  if (secret !== expectedSecret) {
    console.error('Error: Incorrect secret passphrase. Access denied.');
    process.exit(1);
  }

  console.log(`[Claim] Looking up user by email: ${email}...`);
  
  const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
  if (!user) {
    console.error(`Error: User with email "${email}" not found in database. 
    Make sure you have logged in via the UI once before running this.`);
    process.exit(1);
  }

  const userId = user.id;
  console.log(`[Claim] Found User: ${user.name} (${userId}). Transferring mock data...`);

  // Clear existing logs for THIS user first to ensure a fresh demo state
  db.prepare('DELETE FROM meal_logs WHERE user_id = ?').run(userId);

  // SEED LOGIC (copied from seed.js for robustness)
  const today = new Date();
  
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

  console.log(`[Claim] Success! User "${email}" now has 14 days of mock logs.`);
}

claimData().catch(err => {
  console.error('[Claim] Fatal error:', err);
  process.exit(1);
});
