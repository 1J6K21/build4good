require('dotenv').config();
const { db, addMealLog, upsertUser } = require('../server/db');

async function seed() {
  const userId = process.argv[2] || process.env.SEED_USER_ID || 'test-user-id';
  const email = process.env.SEED_USER_EMAIL || 'test@example.com';
  
  console.log(`[Seed] Target User ID: ${userId} | Email: ${email}`);
  
  await upsertUser({
    id: userId,
    email: email,
    name: 'Test Student',
    picture: null
  });

  db.prepare('UPDATE users SET gpa = ?, major = ? WHERE id = ?').run(3.42, 'Bulking', userId);
  db.prepare('DELETE FROM meal_logs WHERE user_id = ?').run(userId);

  const breakfastOptions = [
    { name: 'Oatmeal with Protein Powder', calories: 410, protein: 36, fiber: 8 },
    { name: 'Double Scrambled Eggs & Toast', calories: 420, protein: 34, fiber: 2 },
    { name: 'Greek Yogurt & Extra Protein Parfait', calories: 390, protein: 38, fiber: 4 },
    { name: 'Large Protein Pancakes', calories: 430, protein: 40, fiber: 3 }
  ];

  const lunchOptions = [
    { name: 'Big Grilled Chicken Salad', calories: 640, protein: 48, fiber: 12 },
    { name: 'Double Turkey & Avocado Wrap', calories: 670, protein: 44, fiber: 9 },
    { name: 'Steak & Quinoa Power Bowl', calories: 650, protein: 42, fiber: 10 },
    { name: 'Lemon Herb Salmon Salad', calories: 660, protein: 46, fiber: 11 }
  ];

  const dinnerOptions = [
    { name: 'Ribeye Steak and Asparagus', calories: 780, protein: 55, fiber: 4 },
    { name: 'Chicken Pasta Primavera', calories: 730, protein: 38, fiber: 6 },
    { name: 'Teriyaki Chicken Stir-fry', calories: 760, protein: 44, fiber: 5 },
    { name: 'Grilled Salmon with Broccoli', calories: 740, protein: 48, fiber: 7 }
  ];

  const dangerDinnerOptions = [
    { name: 'Double Bacon Cheeseburger', calories: 980, protein: 45, satFat: 28 },
    { name: 'Large Pepperoni Pizza Slice x3', calories: 1100, protein: 35, satFat: 32 },
    { name: 'Fettuccine Alfredo with Shrimp', calories: 1050, protein: 40, satFat: 45 }
  ];

  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const curDate = new Date();
    curDate.setDate(today.getDate() - (13 - i));
    const dateStr = curDate.toISOString().split('T')[0];
    const dayOfWeek = curDate.getDay(); 

    const getLogAt = (h) => {
        const d = new Date(curDate);
        d.setHours(h, Math.floor(Math.random() * 60), 0);
        return d.getTime();
    };

    if (![3, 8].includes(i)) {
      const b = breakfastOptions[Math.floor(Math.random() * breakfastOptions.length)];
      addMealLog(userId, dateStr, 'Breakfast', b.name, b.calories, 1.0, b.protein, 15, 45, 120, b.fiber || 0, 8, 4, 0, 0, getLogAt(8));
    }

    const l = lunchOptions[Math.floor(Math.random() * lunchOptions.length)];
    addMealLog(userId, dateStr, 'Lunch', l.name, l.calories, 1.0, l.protein, 22, 55, 450, l.fiber || 0, 5, 6, 0, 0, getLogAt(12));
    
    if (Math.random() > 0.3) {
        addMealLog(userId, dateStr, 'Snack', 'Fresh Mixed Fruit Bowl', 80, 1.0, 1, 0, 20, 10, 6, 12, 0, 0, 0, getLogAt(13), null, 0, 1);
    }

    if (dayOfWeek === 4 || dayOfWeek === 6) {
      const d = dangerDinnerOptions[Math.floor(Math.random() * dangerDinnerOptions.length)];
      const nightTime = getLogAt(22);
      addMealLog(userId, dateStr, 'Dinner', d.name, d.calories, 1.0, d.protein, 45, 80, 1200, 2, 10, d.satFat || 15, 0, 25, nightTime);
      addMealLog(userId, dateStr, 'Dinner', 'Side of Greasy Fries', 450, 1.0, 4, 25, 55, 800, 4, 2, 8, 0, 0, nightTime + 600000); 
    } else {
      const d = dinnerOptions[Math.floor(Math.random() * dinnerOptions.length)];
      addMealLog(userId, dateStr, 'Dinner', d.name, d.calories, 1.0, d.protein, 28, 60, 600, d.fiber || 5, 4, 6, 0, 0, getLogAt(18));
    }
  }
  console.log(`[Seed] Successfully seeded 14 days of data for ${userId}.`);
}

seed().catch(err => { console.error('[Seed] Error:', err); process.exit(1); });
