const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

// Hardcoded TAMU location data (from HTML analysis)
const LOCATIONS = [
  {
    id: '59972586ee596fe55d2eef75',
    name: 'The Commons Dining Hall (South Campus)',
    slug: 'the-commons-dining-hall-south-campus',
    group: 'Dining Halls (All-You-Care-To-Eat)'
  },
  {
    id: '587909deee596f31cedc179c',
    name: 'Sbisa Dining Hall (North Campus)',
    slug: 'sbisa-dining-hall-north-campus',
    group: 'Dining Halls (All-You-Care-To-Eat)'
  },
  {
    id: '5878eb5cee596f847636f114',
    name: 'Duncan Dining Hall (South Campus/Quad)',
    slug: 'duncan-dining-hall-south-campus-quad',
    group: 'Dining Halls (All-You-Care-To-Eat)'
  },
  {
    id: '5873c5f43191a200e44eba43',
    name: '1876 Burgers - Sbisa Complex',
    slug: '1876-burgers-sbisa-complex',
    group: 'North Campus'
  },
  {
    id: '586d0bf1ee596f6e75049512',
    name: 'Chick-Fil-A - Sbisa Underground Food Court',
    slug: 'chick-fil-a-sbisa-underground-food-court',
    group: 'North Campus'
  },
  {
    id: '5c9a291319e02b0c4cd18d87',
    name: "Copperhead Jack's - Sbisa Complex",
    slug: 'copperhead-jacks-sbisa-complex',
    group: 'North Campus'
  },
  {
    id: '586e7f19ee596f4034e1f5d0',
    name: 'Einstein Bros. Bagels - Sbisa Complex',
    slug: 'einstein-bros-bagels-sbisa-complex',
    group: 'North Campus'
  },
  {
    id: '5873c5f33191a200e44eba3c',
    name: 'Pizza @ Underground',
    slug: 'pizza-underground',
    group: 'North Campus'
  },
  {
    id: '5873c5f33191a200e44eba41',
    name: 'Cabo Grill - MSC',
    slug: 'cabo-grill-msc',
    group: 'Central Campus'
  },
  {
    id: '5f04e0800101560bba2e7ee1',
    name: 'Chick-Fil-A - MSC Food Court',
    slug: 'chick-fil-a-msc-food-court',
    group: 'Central Campus'
  },
  {
    id: '586d0bf1ee596f6e75049513',
    name: 'Panda Express - MSC',
    slug: 'panda-express-msc',
    group: 'Central Campus'
  },
  {
    id: '5873c5f43191a200e44eba45',
    name: "Rev's American Grill - MSC",
    slug: 'revs-american-grill-msc',
    group: 'Central Campus'
  },
  {
    id: '5873c5f33191a200e44eba42',
    name: 'Shake Smart - MSC',
    slug: 'shake-smart-msc',
    group: 'Central Campus'
  },
  {
    id: '586d0bf1ee596f6e75049511',
    name: 'Chick-fil-A - West Campus Food Hall',
    slug: 'chick-fil-a-west-campus-food-hall',
    group: 'West Campus'
  },
  {
    id: '5ff34e653a585b113c081c17',
    name: 'Panda Express - Polo Garage',
    slug: 'panda-express-polo-garage',
    group: 'East Campus'
  },
  {
    id: '5ff34f9a3a585b1145e16abd',
    name: 'Salata',
    slug: 'salata',
    group: 'East Campus'
  }
];

// Hardcoded meal periods (from HTML analysis)
const PERIODS = [
  { id: '69c728901eb93fe151791f30', name: 'Breakfast', slug: 'breakfast', startHour: 6, endHour: 10 },
  { id: '69c728901eb93fe151791f32', name: 'Brunch', slug: 'brunch', startHour: 10, endHour: 15 },
  { id: '69c728901eb93fe151791f31', name: 'Lunch', slug: 'lunch', startHour: 10, endHour: 15 },
  { id: '69c728901eb93fe151791f2f', name: 'Dinner', slug: 'dinner', startHour: 15, endHour: 22 }
];

function getCurrentPeriod() {
  const hour = new Date().getHours();
  // Simple heuristic
  if (hour < 10) return PERIODS[0];
  if (hour < 15) return PERIODS[2];
  return PERIODS[3];
}

function getDefaultLocation() {
  return LOCATIONS[0]; // The Commons
}

function parseMenuHtml(html) {
  const $ = cheerio.load(html);
  const stations = [];

  // Find each station category block
  $('[aria-label]').filter((i, el) => {
    const label = $(el).attr('aria-label') || '';
    return label.startsWith('Toggle ') && label.endsWith(' category');
  }).each((i, stationEl) => {
    const label = $(stationEl).attr('aria-label') || '';
    const stationName = label.replace('Toggle ', '').replace(' category', '');

    // Find the table after this button
    const table = $(stationEl).closest('.p-4').find('table').first();
    const items = [];

    table.find('tbody tr').each((j, row) => {
      const btn = $(row).find('button[aria-label^="View nutritional"]');
      if (!btn.length) return;
      const itemName = btn.text().trim();

      const cells = $(row).find('td');
      const portionCell = cells.eq(1).text().trim();
      const caloriesCell = cells.eq(2).text().trim();
      const calories = parseInt(caloriesCell) || 0;

      // Get dietary badges
      const badges = [];
      $(row).find('img[alt]').each((k, img) => {
        const alt = $(img).attr('alt') || '';
        if (alt.includes('Vegan')) badges.push('VG');
        else if (alt.includes('Vegetarian')) badges.push('V');
        else if (alt.includes('Gluten')) badges.push('GF');
        else if (alt.includes('Protein')) badges.push('PR');
        else if (alt.includes('Climate')) badges.push('CF');
      });

      const description = $(row).find('td').first().find('div.mt-1').text().trim();

      if (itemName) {
        items.push({ name: itemName, portion: portionCell, calories, badges, description });
      }
    });

    if (items.length > 0) {
      stations.push({ name: stationName, items });
    }
  });

  return stations;
}

let browser = null;

async function getBrowser() {
  if (!browser) {
    // Note: puppeteer-extra still uses the standard launch call
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080']
    });
  }
  return browser;
}

async function scrapeMenu(locationSlug, periodSlug, date, onStep = () => { }) {
  onStep('Launching internal browser...');
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // Stealth plugin handles most headers, but we set a consistent UA
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    const url = `https://dineoncampus.com/tamu/whats-on-the-menu/${locationSlug}/${date}/${periodSlug}`;
    console.log('[Scraper] Fetching:', url);
    onStep(`Connecting to dineoncampus.com...`);

    // Random initial wait to simulate human
    await new Promise(r => setTimeout(r, Math.random() * 2000 + 1000));

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    const title = await page.title();
    console.log('[Scraper] Page Title:', title);

    if (title.includes('Cloudflare') || title.includes('Attention Required')) {
      throw new Error('Blocked by Cloudflare bot protection.');
    }

    onStep('Waiting for menu data to render...');
    try {
      await page.waitForSelector('.accordion-header, table, #menu-content', { timeout: 15000 });
    } catch (e) {
      console.log('[Scraper] Timeout waiting for menu markers.');
    }

    onStep('Parsing found menu items...');
    await new Promise(r => setTimeout(r, 4000));

    const html = await page.content();
    const stations = parseMenuHtml(html);
    console.log('[Scraper] Found stations:', stations.length);
    return stations;
  } finally {
    await page.close();
  }
}

// Parse the saved HTML file as fallback / demo data
function parseSavedHtml() {
  const fs = require('fs');
  const path = require('path');
  const savedPath = path.join(__dirname, '../../helper/Dine On Campus.html');

  if (fs.existsSync(savedPath)) {
    const html = fs.readFileSync(savedPath, 'utf-8');
    return parseMenuHtml(html);
  }
  return [];
}

module.exports = { LOCATIONS, PERIODS, getCurrentPeriod, getDefaultLocation, scrapeMenu, parseSavedHtml };
