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
  console.log(`[Claim] Found User: ${user.name} (${userId}). Transferring premium mock data...`);

  // Update user with interesting GPA data for the report card demo
  db.prepare('UPDATE users SET gpa = ?, major = ? WHERE id = ?').run(3.42, 'Bulking', userId);

  // Clear existing logs for THIS user first to ensure a fresh demo state
  db.prepare('DELETE FROM meal_logs WHERE user_id = ?').run(userId);

  const breakfastOptions = [
    { name: 'Oatmeal with Protein Powder & Fruit', calories: 410, protein: 36, fiber: 12 },
    { name: 'Egg White Omelet & Whole Grain Toast', calories: 380, protein: 42, fiber: 6 },
    { name: 'Greek Yogurt Protein Parfait', calories: 340, protein: 40, fiber: 4 },
    { name: 'Large Whey Protein Pancakes', calories: 430, protein: 48, fiber: 4 }
  ];

  const lunchOptions = [
    { name: 'Big Grilled Chicken Salad', calories: 640, protein: 48, fiber: 12 },
    { name: 'Double Turkey & Avocado Wrap', calories: 670, protein: 44, fiber: 9 },
    { name: 'Steak & Quinoa Power Bowl', calories: 650, protein: 42, fiber: 10 },
    { name: 'Lemon Herb Salmon Salad', calories: 660, protein: 46, fiber: 11 }
  ];

  const dinnerOptions = [
    { name: 'Ribeye Steak and Asparagus (High Intensity)', calories: 750, protein: 65, fiber: 8 },
    { name: 'Lemon Herb Grilled Salmon & Rice', calories: 660, protein: 48, fiber: 10 },
    { name: 'Large Grilled Chicken Salad (Pro)', calories: 640, protein: 55, fiber: 12 },
    { name: 'Quinoa Bowl with Tofu and Spinach', calories: 620, protein: 38, fiber: 14 }
  ];

  const dangerDinnerOptions = [
    { name: 'Double Bacon Cheeseburger', calories: 980, protein: 45, satFat: 28 },
    { name: 'Large Pepperoni Pizza Slice x3', calories: 1100, protein: 35, satFat: 32 },
    { name: 'Fettuccine Alfredo with Shrimp', calories: 1050, protein: 40, satFat: 45 }
  ];

  const skipBreakfastDays = [3, 8]; 
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const curDate = new Date(today);
    curDate.setDate(today.getDate() - (13 - i));
    const dateStr = curDate.toISOString().split('T')[0];
    const dayOfWeek = curDate.getDay(); 

    // Helper to generate a timestamp for the log
    const getLogAt = (h) => {
        const d = new Date(curDate);
        d.setHours(h, Math.floor(Math.random() * 60), 0);
        return d.getTime();
    };

    // Breakfast (8 AM)
    if (!skipBreakfastDays.includes(i)) {
      const b = breakfastOptions[Math.floor(Math.random() * breakfastOptions.length)];
      addMealLog(userId, dateStr, 'Breakfast', b.name, b.calories, 1.0, b.protein, 15, 45, 120, b.fiber || 0, 8, 4, 0, 0, getLogAt(8));
    }

    // Lunch (12 PM)
    const l = lunchOptions[Math.floor(Math.random() * lunchOptions.length)];
    addMealLog(userId, dateStr, 'Lunch', l.name, l.calories, 1.0, l.protein, 22, 55, 450, l.fiber || 0, 5, 6, 0, 0, getLogAt(12));
    
    // Extra Credit Swap (Fruit instead of fries)
    if (Math.random() > 0.3) {
        addMealLog(userId, dateStr, 'Snack', 'Fresh Mixed Fruit Bowl', 80, 1.0, 1, 0, 20, 10, 6, 12, 0, 0, 0, getLogAt(13), null, 0, 1);
    }

    // Dinner (6 PM or late night)
    if (dayOfWeek === 4 || dayOfWeek === 6) {
      // Danger / Exam Days (Thursday and Saturday - Late Night)
      const d = dangerDinnerOptions[Math.floor(Math.random() * dangerDinnerOptions.length)];
      const nightTime = getLogAt(22); // 10 PM
      addMealLog(userId, dateStr, 'Dinner', d.name, d.calories, 1.0, d.protein, 45, 80, 1200, 2, 10, d.satFat || 15, 0, 25, nightTime);
      addMealLog(userId, dateStr, 'Dinner', 'Side of Greasy Fries', 450, 1.0, 4, 25, 55, 800, 4, 2, 8, 0, 0, nightTime + 600000); 
    } else {
      const d = dinnerOptions[Math.floor(Math.random() * dinnerOptions.length)];
      const dinnerAt = getLogAt(18);
      addMealLog(userId, dateStr, 'Dinner', d.name, d.calories, 1.0, d.protein, 28, 60, 600, d.fiber || 5, 4, 6, 0, 0, dinnerAt);
    }
  }

  console.log(`[Claim] Success! User "${email}" now has 14 days of mock logs and a populated Health GPA.`);
}

claimData().catch(err => {
  console.error('[Claim] Fatal error:', err);
  process.exit(1);
});
