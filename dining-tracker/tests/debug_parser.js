const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function parseSavedHtml() {
  const savedPath = path.join(__dirname, '../helper/Dine On Campus.html');

  if (fs.existsSync(savedPath)) {
    const html = fs.readFileSync(savedPath, 'utf-8');
    const $ = cheerio.load(html);
    const stations = [];

    $('[aria-label]').filter((i, el) => {
      const label = ($(el).attr('aria-label') || '').toLowerCase();
      return label.includes('toggle') && label.includes('category');
    }).each((i, stationEl) => {
      const label = $(stationEl).attr('aria-label') || '';
      const stationName = label.replace(/toggle /i, '').replace(/ category/i, '').trim();

      const container = $(stationEl).closest('.p-4');
      const table = container.find('table').first();
      const items = [];

      table.find('tbody tr').each((j, row) => {
        const cells = $(row).find('td');
        if (!cells.length) return;

        const firstCell = cells.eq(0);
        const btn = firstCell.find('button');
        const itemName = (btn.length ? btn.text() : firstCell.text()).trim();
        if (!itemName || itemName.toLowerCase().includes('click any item')) return;

        const caloriesCell = cells.eq(2).text().trim();
        const calories = parseInt(caloriesCell) || 0;
        
        items.push({ name: itemName, calories });
      });

      if (items.length > 0) {
        stations.push({ name: stationName, items });
      }
    });

    return stations;
  }
  return "File not found";
}

const res = parseSavedHtml();
console.log(JSON.stringify(res, null, 2));
