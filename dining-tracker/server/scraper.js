const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

// ── Proxy Rotation ──────────────────────────────────────────────────────────
// Populate PROXY_LIST env var with comma-separated proxy URLs to enable rotation.
// Example: PROXY_LIST=http://user:pass@p1.example.com:8080,http://user:pass@p2.example.com:8080
const PROXY_LIST = (process.env.PROXY_LIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function pickProxy() {
  if (!PROXY_LIST.length) return null;
  return PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
}

// ── User-Agent Pool ─────────────────────────────────────────────────────────
// A diverse set of real Chrome UAs — desktop + mobile — so each request
// looks like a different student hitting the site from their own device.
const USER_AGENTS = [
  // Desktop Chrome (various OS / versions)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Desktop Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
  // Desktop Edge
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  // Desktop Safari
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  // Mobile Chrome (Android)
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.80 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  // Mobile Safari (iPhone)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const { LOCATIONS, PERIODS } = require('./constants');
const { saveMenu, updateScrapeJobStatus, upsertJob, getKnownFood, upsertFoodItem } = require('./db');

function todayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

function processMenuJson(json) {
  // Dine On Campus v4/v1 API can have categories or stations at different levels
  const categories = json?.period?.categories 
                  || json?.menu?.periods?.[0]?.categories 
                  || json?.categories 
                  || json?.stations 
                  || json?.menu?.periods?.[0]?.stations
                  || json?.period?.stations;
  
  if (!categories || !Array.isArray(categories)) return [];

  return categories.map(cat => ({
    name: (cat.name || '').trim(),
    items: (cat.items || []).map(item => {
      const nutrients = item.nutrients || [];
      const getVal = (name) => {
        const n = nutrients.find(n => n.name.toLowerCase().includes(name.toLowerCase()));
        if (!n) return 0;
        const val = parseInt(n.valueNumeric);
        return isNaN(val) ? 0 : val;
      };

      const badges = [];
      if (item.filters) {
        item.filters.forEach(f => {
          const name = f.name;
          if (name.includes('Vegan')) badges.push('VG');
          else if (name.includes('Vegetarian')) badges.push('V');
          else if (name.includes('Gluten Free')) badges.push('GF');
          else if (name.includes('Protein')) badges.push('PR');
          else if (name.includes('Climate')) badges.push('CF');
        });
      }

      let itemObj = {
        name: (item.name || '').trim(),
        portion: item.portion || '',
        calories: item.calories || 0,
        protein: getVal('Protein'),
        fat: getVal('Total Fat'),
        carbs: getVal('Total Carbohydrates'),
        sodium: getVal('Sodium'),
        fiber: getVal('Dietary Fiber'),
        sugars: getVal('Sugars'),
        saturated_fat: getVal('Saturated Fat'),
        trans_fat: getVal('Trans Fat'),
        cholesterol: getVal('Cholesterol'),
        calcium: getVal('Calcium'),
        iron: getVal('Iron'),
        vit_a: getVal('Vitamin A'),
        vit_c: getVal('Vitamin C'),
        badges,
        description: (item.desc || '').trim()
      };

      // Fallback Estimation logic
      if (!itemObj.calories || itemObj.calories === 0) {
        const history = getKnownFood(itemObj.name);
        if (history) {
          itemObj.calories = history.calories;
          itemObj.protein = history.protein;
          itemObj.fat = history.fat;
          itemObj.carbs = history.carbs;
          itemObj.sodium = history.sodium || 0;
        }
      }

      // Record this item's nutrition for future fallbacks
      if (itemObj.calories > 0) {
        upsertFoodItem(itemObj);
      }

      return itemObj;
    })
  }));
}

function parseMenuHtml(html) {
  const $ = cheerio.load(html);
  const stations = [];

  // Find each station category block (accordion headers/buttons)
  $('[aria-label]').filter((i, el) => {
    const label = ($(el).attr('aria-label') || '').toLowerCase();
    // Usually "Toggle {Station} category" or similar
    return (label.includes('toggle') && label.includes('category')) || 
           (label.includes('station') && label.includes('toggle'));
  }).each((i, stationEl) => {
    const label = $(stationEl).attr('aria-label') || '';
    const stationName = label.replace(/toggle /i, '').replace(/ category/i, '').trim();

    // Find the table after this button or within the same container
    let container = $(stationEl).closest('.p-4, .px-4, .mb-4');
    let table = container.find('table').first();
    
    // If no table in container, look for next table in DOM
    if (!table.length) {
      table = $(stationEl).closest('div').nextAll('table').first();
    }
    if (!table.length) {
      table = $(stationEl).parent().nextAll().find('table').first();
    }

    const items = [];
    table.find('tbody tr').each((j, row) => {
      const cells = $(row).find('td');
      if (!cells.length) return;

      const firstCell = cells.eq(0);
      const btn = firstCell.find('button');
      const itemName = (btn.length ? btn.text() : firstCell.text()).trim();
      if (!itemName || itemName.toLowerCase().includes('click any item')) return;

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

      const itemObj = { name: itemName, portion: portionCell, calories, protein: 0, fat: 0, carbs: 0, sodium: 0, badges, description };

      // Fallback for HTML too
      if (!itemObj.calories) {
        const history = getKnownFood(itemName);
        if (history) {
          itemObj.calories = history.calories;
          itemObj.protein = history.protein;
          itemObj.fat = history.fat;
          itemObj.carbs = history.carbs;
          itemObj.sodium = history.sodium || 0;
        }
      }

      if (itemObj.calories > 0) upsertFoodItem(itemObj);
      items.push(itemObj);
    });

    if (items.length > 0) {
      stations.push({ name: stationName, items });
    }
  });

  return stations;
}

// NOTE: We intentionally do NOT cache the browser globally.
// Each scrape job creates a fresh browser (optionally with a random proxy)
// so the proxy actually rotates between jobs.
async function createBrowser(proxy) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1920,1080',
  ];
  if (proxy) {
    args.push(`--proxy-server=${proxy}`);
    console.log(`[Scraper] Using proxy: ${proxy.replace(/:[^@]*@/, ':***@')}`);
  }
  return puppeteer.launch({ headless: 'new', args });
}

async function scrapeMenu(locationSlug, periodSlug, date, onStep = () => { }) {
  const proxy = pickProxy();
  const userAgent = pickUserAgent();

  console.log(`[Scraper] UA: ${userAgent.slice(0, 60)}...`);

  onStep('Launching Aggie Browser Engine...');
  const b = await createBrowser(proxy);

  onStep('Creating secure tab...');
  const page = await b.newPage();

  onStep('Optimizing viewport...');
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(userAgent);

  // Setup interception for JSON menu data
  let menuJson = null;
  onStep('Connecting to Dine On Campus...');
  await page.setRequestInterception(false); // We just listen to responses

  page.on('response', async (response) => {
    const url = response.url();
    // Intercept v4 or v1 menu API
    const isMenuCall = (url.includes('dineoncampus.com') && url.includes('/menu') && url.includes(`date=${date}`));
    if (isMenuCall) {
      try {
        menuJson = await response.json();
        console.log('[Scraper] Intercepted menu JSON response.');
      } catch (e) {
        // Quietly fail as it might not be JSON or other response
      }
    }
  });

  try {
    // Override UA with our randomly picked one
    await page.setUserAgent(userAgent);

    // If using a proxy with auth credentials, intercept the auth challenge
    if (proxy) {
      try {
        const proxyUrl = new URL(proxy);
        if (proxyUrl.username) {
          await page.authenticate({ username: proxyUrl.username, password: proxyUrl.password });
        }
      } catch (_) { /* non-auth proxy */ }
    }

    const url = `https://dineoncampus.com/tamu/whats-on-the-menu/${locationSlug}/${date}/${periodSlug}`;
    console.log('[Scraper] Fetching:', url);
    onStep(`Connecting to dineoncampus.com...`);

    // Random jitter to simulate human think-time between requests
    const jitter = Math.random() * 2000 + 1000;
    await new Promise(r => setTimeout(r, jitter));

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    const title = await page.title();
    console.log('[Scraper] Page Title:', title);

    if (title.includes('Cloudflare') || title.includes('Attention Required')) {
      throw new Error('Blocked by Cloudflare bot protection.');
    }

    onStep('Waiting for menu data to render...');
    try {
      if (!menuJson) {
        // Wait up to 10 seconds for the API to fire if page is already loaded
        for (let i = 0; i < 10 && !menuJson; i++) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      // Minimal wait for actual DOM table only if we don't have JSON
      if (!menuJson) {
        await page.waitForSelector('.accordion-header, table', { timeout: 10000 });
      }
    } catch (e) {
      console.log('[Scraper] Info: Menu markers or JSON not found yet, trying one last wait.');
      await new Promise(r => setTimeout(r, 3000));
    }

    onStep('Processing menu items...');

    // Prioritize intercepted JSON data if it actually contains items
    if (menuJson) {
      console.log('[Scraper] Intercepted JSON detected, processing...');
      const result = processMenuJson(menuJson);
      if (result && result.length > 0 && result.some(s => s.items.length > 0)) {
        console.log('[Scraper] Using rich JSON data with items.');
        return result;
      }
      console.log('[Scraper] Intercepted JSON was empty or skeleton-only, checking HTML.');
    }

    console.log('[Scraper] Falling back to HTML parsing or merging...');
    const html = await page.content();
    const htmlStations = parseMenuHtml(html);
    
    if (menuJson) {
      const jsonStations = processMenuJson(menuJson);
      // Merge: Take HTML stations if they have more items or if JSON station is missing/empty
      const finalStations = [...jsonStations];
      
      htmlStations.forEach(hs => {
        const js = finalStations.find(s => s.name.toLowerCase() === hs.name.toLowerCase());
        if (!js) {
          finalStations.push(hs);
        } else if (js.items.length === 0 && hs.items.length > 0) {
          // Replace empty JSON station with populated HTML station
          Object.assign(js, hs);
        }
      });
      console.log(`[Scraper] Merged JSON (${jsonStations.length}) and HTML (${htmlStations.length}) -> Final: ${finalStations.length}`);
      return finalStations.filter(s => s.items.length > 0);
    }

    console.log('[Scraper] Found stations via HTML:', htmlStations.length);
    return htmlStations.filter(s => s.items.length > 0);
  } finally {
    await page.close();
    // Always close the browser so the proxy is truly released
    await b.close().catch(() => { });
  }
}

async function startScrapeProcess(locationSlug, periodSlug, date) {
  try {
    const stations = await scrapeMenu(locationSlug, periodSlug, date, (step) => {
      updateScrapeJobStatus(locationSlug, periodSlug, date, step);
    });

    saveMenu(locationSlug, periodSlug, date, stations);

    // Mark job as completed
    const key = `${locationSlug}:${periodSlug}:${date}`;
    upsertJob(key, 'ready', null, Date.now(), 'ready');
  } catch (e) {
    console.error('[Scraper] Job failed:', e);
    const key = `${locationSlug}:${periodSlug}:${date}`;
    upsertJob(key, 'failed', e.message, Date.now(), 'failed');
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

module.exports = { LOCATIONS, PERIODS, getCurrentPeriod, getDefaultLocation, scrapeMenu, startScrapeProcess };
