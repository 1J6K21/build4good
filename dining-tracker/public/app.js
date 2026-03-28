/* ════════════════════════════════════════════
   Aggie Dining Tracker — Frontend App
════════════════════════════════════════════ */

const API = ''; // Use relative paths since it's served from the same origin

// ── State ──────────────────────────────────
let selectedItems = [];   // { name, calories, portion, station }
let activePeriodSlug = 'dinner';
let activePeriodId = '';
let pollTimer = null;
let ringChart = null;
let weekChart = null;

// ── Storage helpers ───────────────────────
const STORAGE_KEYS = {
    logs: 'aggie_dining_logs',       // Array<DayLog>
    shortcuts: 'aggie_dining_shortcuts',  // Array<Shortcut>
    goal: 'aggie_dining_goal',       // number
};

function getGoal() { return parseInt(localStorage.getItem(STORAGE_KEYS.goal) || '2000'); }
function saveGoalVal(n) { localStorage.setItem(STORAGE_KEYS.goal, n); }

function getLogs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.logs) || '[]'); }
    catch { return []; }
}
function saveLogs(logs) { localStorage.setItem(STORAGE_KEYS.logs, JSON.stringify(logs)); }

function getShortcuts() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.shortcuts) || '[]'); }
    catch { return []; }
}
function saveShortcuts(s) { localStorage.setItem(STORAGE_KEYS.shortcuts, JSON.stringify(s)); }

function todayStr() { return new Date().toISOString().split('T')[0]; }

function getTodayLogs() {
    return getLogs().filter(l => l.date === todayStr());
}

function addLog(entry) {
    const logs = getLogs();
    logs.push(entry);
    saveLogs(logs);
}

function deleteLog(id) {
    const logs = getLogs().filter(l => l.id !== id);
    saveLogs(logs);
}

function getCalsByDate() {
    // Returns { 'YYYY-MM-DD': totalCal } for last 7 days
    const logs = getLogs();
    const result = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const k = d.toISOString().split('T')[0];
        result[k] = 0;
    }
    for (const l of logs) {
        if (result[l.date] !== undefined) result[l.date] += l.totalCal;
    }
    return result;
}

// ── Navigation ────────────────────────────
function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    document.getElementById('nav-' + name).classList.add('active');

    if (name === 'dashboard') refreshDashboard();
    if (name === 'menu') initMenuPage();
}

// ── Dashboard ─────────────────────────────
function refreshDashboard() {
    const goal = getGoal();
    const todayLogs = getTodayLogs();
    const totalCal = todayLogs.reduce((s, l) => s + l.totalCal, 0);
    const remaining = Math.max(0, goal - totalCal);

    document.getElementById('ringCurrent').textContent = totalCal.toLocaleString();
    document.getElementById('ringGoal').textContent = goal.toLocaleString();
    document.getElementById('ringRemaining').textContent = remaining > 0
        ? `${remaining.toLocaleString()} remaining`
        : `${(totalCal - goal).toLocaleString()} over goal`;

    document.getElementById('todayDateLabel').textContent =
        new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    // Stats
    document.getElementById('statMeals').textContent = todayLogs.length;

    // Streak
    const byDate = getCalsByDate();
    let streak = 0;
    for (const k of Object.keys(byDate).reverse()) {
        if (byDate[k] > 0) streak++;
        else break;
    }
    document.getElementById('statStreak').textContent = streak;

    const vals = Object.values(byDate);
    const nonZero = vals.filter(v => v > 0);
    const avg = nonZero.length ? Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length) : 0;
    document.getElementById('statAvg').textContent = avg.toLocaleString();

    drawRing(totalCal, goal);
    drawWeekChart(byDate, goal);
    renderTodayMeals(todayLogs);
    renderShortcuts();
}

// Donut ring
function drawRing(current, goal) {
    const canvas = document.getElementById('calRingCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pct = Math.min(1, current / goal);
    const over = current > goal;

    if (ringChart) { ringChart.destroy(); ringChart = null; }

    ringChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: pct < 1 ? [pct, 1 - pct] : [1, 0],
                backgroundColor: [over ? '#ef4444' : '#500000', '#f0e8e8'],
                borderWidth: 0,
                hoverOffset: 0,
            }]
        },
        options: {
            cutout: '78%',
            animation: { animateRotate: true, duration: 800 },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            events: []
        }
    });
}

// Weekly bar chart
function drawWeekChart(byDate, goal) {
    const labels = Object.keys(byDate).map(d => {
        const dt = new Date(d + 'T12:00:00');
        return dt.toLocaleDateString('en-US', { weekday: 'short' });
    });
    const data = Object.values(byDate);

    const canvas = document.getElementById('weekChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (weekChart) { weekChart.destroy(); weekChart = null; }

    weekChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: data.map((v, i) => {
                    const isToday = i === data.length - 1;
                    if (v === 0) return 'rgba(0,0,0,0.05)';
                    if (v > goal) return 'rgba(239,68,68,0.7)';
                    return isToday ? 'rgba(80,0,0,0.85)' : 'rgba(80,0,0,0.4)';
                }),
                borderRadius: 8,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()} cal` }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 12, family: 'Inter' } } },
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { font: { size: 11, family: 'Inter' }, callback: v => v > 0 ? v.toLocaleString() : '' },
                    beginAtZero: true,
                }
            }
        }
    });
}

function renderTodayMeals(logs) {
    const el = document.getElementById('todayMealsList');
    if (!el) return;
    if (!logs.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">🥗</div><p>No meals logged today.</p><button class="btn btn-primary" onclick="showPage('menu')">Browse Menu</button></div>`;
        return;
    }
    el.innerHTML = logs.map(l => `
    <div class="meal-entry" id="meal-${l.id}" onclick="toggleMealEntry('${l.id}')">
      <div class="meal-entry-header">
        <div class="meal-entry-left">
          <div class="meal-entry-name">${l.name}</div>
          <div class="meal-entry-meta">${l.location} · ${l.period} · ${formatTime(l.timestamp)}</div>
        </div>
        <div class="meal-entry-right">
          <div class="meal-cal-badge">${l.totalCal} cal</div>
          <button class="meal-delete-btn" onclick="event.stopPropagation(); removeMeal('${l.id}')">🗑</button>
        </div>
      </div>
      <div class="meal-entry-items">
        ${l.items.map(i => `<div>• ${i.name} <span style="color:var(--text-3)">(${i.calories} cal${i.portion ? ' · ' + i.portion : ''})</span></div>`).join('')}
        ${l.note ? `<div style="margin-top:6px;color:var(--text-3);font-style:italic">📝 ${l.note}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function toggleMealEntry(id) {
    document.getElementById('meal-' + id)?.classList.toggle('expanded');
}

function removeMeal(id) {
    deleteLog(id);
    refreshDashboard();
    toast('Meal removed');
}

function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderShortcuts() {
    const el = document.getElementById('shortcutsList');
    if (!el) return;
    const shortcuts = getShortcuts();
    if (!shortcuts.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">💾</div><p>Save a meal combo as a shortcut for fast logging.</p></div>`;
        return;
    }
    el.innerHTML = shortcuts.map((s, i) => `
    <div class="shortcut-item">
      <div>
        <div class="shortcut-name">${s.name}</div>
        <div class="shortcut-cal">${s.totalCal} cal · ${s.items.length} items</div>
      </div>
      <div class="shortcut-actions">
        <button class="shortcut-log-btn" onclick="logShortcut(${i})">Quick Log</button>
        <button class="shortcut-del-btn" onclick="deleteShortcut(${i})">✕</button>
      </div>
    </div>
  `).join('');
}

function logShortcut(idx) {
    const shortcuts = getShortcuts();
    const s = shortcuts[idx];
    if (!s) return;
    addLog({
        id: crypto.randomUUID(),
        date: todayStr(),
        timestamp: Date.now(),
        name: s.name,
        location: 'Quick Log',
        period: '',
        items: s.items,
        totalCal: s.totalCal,
        note: ''
    });
    refreshDashboard();
    toast(`✓ Logged "${s.name}" (${s.totalCal} cal)`);
}

function deleteShortcut(idx) {
    const shortcuts = getShortcuts();
    shortcuts.splice(idx, 1);
    saveShortcuts(shortcuts);
    renderShortcuts();
    toast('Shortcut removed');
}

// ── Goal Modal ───────────────────────────
function openGoalModal() {
    document.getElementById('goalInput').value = getGoal();
    document.getElementById('goalModalBackdrop').classList.add('open');
}
function closeGoalModal() {
    document.getElementById('goalModalBackdrop').classList.remove('open');
}
function saveGoal() {
    const val = parseInt(document.getElementById('goalInput').value);
    if (!val || val < 500) return;
    saveGoalVal(val);
    closeGoalModal();
    refreshDashboard();
    toast('Goal updated!');
}

// ── Menu Page ─────────────────────────────
async function initMenuPage() {
    // Populate location select
    await loadLocations();

    // Set default date to today
    const dateInp = document.getElementById('dateInput');
    if (!dateInp.value) dateInp.value = todayStr();

    updateAvailablePeriods();

    // Auto-select current period
    const h = new Date().getHours();
    const day = new Date().getDay();
    const isWeekend = (day === 0 || day === 6);

    if (h >= 6 && h < 10 && !isWeekend) selectPeriodBySlug('breakfast');
    else if (h >= 10 && h < 15) {
        if (isWeekend) selectPeriodBySlug('brunch');
        else selectPeriodBySlug('lunch');
    }
    else selectPeriodBySlug('dinner');

    // Load menu automatically
    loadMenu();
}

function updateAvailablePeriods() {
    const dateInput = document.getElementById('dateInput');
    if (!dateInput) return;
    const dateStr = dateInput.value || todayStr();
    const day = new Date(dateStr + 'T12:00:00').getDay();
    const isWeekend = (day === 0 || day === 6);

    document.querySelectorAll('.period-pill').forEach(btn => {
        const p = btn.dataset.period;
        if (isWeekend) {
            // Saturday/Sunday: Brunch, Dinner
            if (p === 'brunch' || p === 'dinner') btn.style.display = 'block';
            else btn.style.display = 'none';
        } else {
            // Weekdays: Breakfast, Lunch, Dinner
            if (p === 'brunch') btn.style.display = 'none';
            else btn.style.display = 'block';
        }
    });

    // Ensure active is one of visible ones
    const activeBtn = document.querySelector('.period-pill.active');
    if (activeBtn && activeBtn.style.display === 'none') {
        const firstVisible = document.querySelector('.period-pill[style="display: block"]');
        if (firstVisible) selectPeriod(firstVisible);
    }
}

async function loadLocations() {
    try {
        const res = await fetch(`${API}/api/locations`);
        if (!res.ok) throw new Error('API down');
        const data = await res.json();
        const sel = document.getElementById('locationSelect');
        if (!sel) return;

        // Group them
        const grouped = data.grouped || {};
        sel.innerHTML = '';
        for (const [group, locs] of Object.entries(grouped)) {
            const og = document.createElement('optgroup');
            og.label = group;
            for (const loc of locs) {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ slug: loc.slug, id: loc.id, name: loc.name });
                opt.textContent = loc.name;
                og.appendChild(opt);
            }
            sel.appendChild(og);
        }

        // Select Commons by default if not set
        if (!sel.value && data.locations.length > 0) {
            sel.selectedIndex = 0;
        }
    } catch (e) {
        console.error('Failed to load locations', e);
        const sel = document.getElementById('locationSelect');
        if (sel) sel.innerHTML = '<option value="">Error loading locations. Reloader page.</option>';
    }
}

function selectPeriod(btn) {
    document.querySelectorAll('.period-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activePeriodSlug = btn.dataset.period;
    activePeriodId = btn.dataset.periodId;
}

function selectPeriodBySlug(slug) {
    const btn = document.querySelector(`.period-pill[data-period="${slug}"]`);
    if (btn) selectPeriod(btn);
}

function onFilterChange() {
    updateAvailablePeriods();
}

async function retryScrape() {
    clearPoll();
    const sel = document.getElementById('locationSelect');
    let locData;
    try { locData = JSON.parse(sel.value); } catch { return; }
    const date = document.getElementById('dateInput').value || todayStr();

    await fetch(`${API}/api/menu/clear?locationSlug=${encodeURIComponent(locData.slug)}&periodSlug=${encodeURIComponent(activePeriodSlug)}&date=${date}`);
    loadMenu();
}

async function loadMenu() {
    clearPoll();
    const sel = document.getElementById('locationSelect');
    if (!sel || !sel.value) return;

    let locData;
    try { locData = JSON.parse(sel.value); } catch { return; }

    const date = document.getElementById('dateInput').value || todayStr();

    showLoading(true);
    document.getElementById('menuContent').innerHTML = '';

    try {
        const res = await fetch(`${API}/api/menu?locationSlug=${encodeURIComponent(locData.slug)}&periodSlug=${encodeURIComponent(activePeriodSlug)}&date=${date}`);
        const data = await res.json();

        if (data.status === 'ready') {
            showLoading(false);
            renderMenu(data.stations, locData.name, activePeriodSlug, date);
        } else if (data.status === 'scraping') {
            showScrapingState(data.first, data.message || 'Scraping...', locData.slug, date, data.step);
        } else {
            showLoading(false);
            const err = data.error || data.message || 'Unknown error';
            document.getElementById('menuContent').innerHTML = `
                <div class="loading-state">
                    <p style="color:var(--red)">⚠️ ${err}</p>
                    <button class="btn btn-outline" style="margin-top:12px" onclick="retryScrape()">Retry Scrape</button>
                </div>`;
        }
    } catch (err) {
        showLoading(false);
        document.getElementById('menuContent').innerHTML = `<div class="loading-state"><p style="color:var(--red)">⚠️ Server not reachable.</p></div>`;
    }
}

function showScrapingState(isFirst, message, locationSlug, date, initialStep) {
    showLoading(false);
    document.getElementById('menuContent').innerHTML = `
    <div class="scraping-container">
      <div class="loading-big">🍽️</div>
      <div class="loading-title" style="margin-top:16px">${isFirst ? "First View Today!" : "Loading Menu..."}</div>
      
      <div class="scraping-indicator"></div>

      <div class="scraping-step">
        <div class="scraping-step-label">Current Step</div>
        <div class="scraping-step-text" id="scrapingStep">${initialStep || 'Initializing...'}</div>
      </div>
      
      <p style="color:var(--text-3);font-size:0.85rem;margin-top:24px;line-height:1.5">${message}</p>
    </div>
  `;

    // Poll every 4 seconds until ready
    pollTimer = setInterval(async () => {
        try {
            const res = await fetch(`${API}/api/menu/status?locationSlug=${encodeURIComponent(locationSlug)}&periodSlug=${encodeURIComponent(activePeriodSlug)}&date=${date}`);
            const data = await res.json();

            if (data.status === 'ready') {
                clearPoll();
                loadMenu(); // reload fully
            } else if (data.status === 'error') {
                clearPoll();
                document.getElementById('menuContent').innerHTML = `
                <div class="loading-state">
                    <p style="color:var(--red)">⚠️ Scrape failed: ${data.error}</p>
                    <button class="btn btn-outline" style="margin-top:12px" onclick="retryScrape()">Retry Scrape</button>
                </div>`;
            } else if (data.status === 'pending') {
                const stepEl = document.getElementById('scrapingStep');
                if (stepEl && data.step) stepEl.textContent = data.step;
            }
        } catch { }
    }, 4000);
}

function clearPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function showLoading(show) {
    const el = document.getElementById('menuLoading');
    if (el) el.style.display = show ? 'flex' : 'none';
}

function renderMenu(stations, locationName, periodSlug, date) {
    selectedItems = [];
    updateLogBar();

    const mc = document.getElementById('menuContent');
    if (!mc) return;
    if (!stations || !stations.length) {
        mc.innerHTML = `
            <div class="loading-state">
                <div class="empty-icon">😪</div>
                <p>No menu data available for this selection.</p>
                <button class="btn btn-outline" style="margin-top:12px" onclick="retryScrape()">Force Refresh</button>
            </div>`;
        return;
    }

    const periodLabel = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', brunch: 'Brunch' }[periodSlug] || periodSlug;
    mc.innerHTML = `
    <div style="margin-bottom:24px">
      <h2 style="font-size:1.3rem;font-weight:800;letter-spacing:-0.02em">${locationName}</h2>
      <p style="color:var(--text-3);font-size:0.88rem;margin-top:4px">${periodLabel} · ${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </div>
    ${stations.map(s => `
      <div class="station-block">
        <div class="station-header">
          <div class="station-line"></div>
          <div class="station-name">${s.name}</div>
          <div class="station-line"></div>
        </div>
        <div class="item-grid">
          ${s.items.map(item => renderItem(item, s.name)).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

function renderItem(item, station) {
    const badges = (item.badges || []).map(b => `<span class="badge badge-${b}">${b}</span>`).join('');
    const safeId = encodeURIComponent(item.name + '|' + station);
    return `
    <div class="menu-item" id="item-${safeId}" onclick="toggleItem(this, ${JSON.stringify(JSON.stringify({ name: item.name, calories: item.calories, portion: item.portion, station }))})">
      <div class="item-name">${item.name}</div>
      ${item.description ? `<div class="item-desc">${item.description}</div>` : ''}
      <div class="item-footer">
        <div>
          <span class="item-cal">${item.calories}</span>
          <span class="item-cal-unit">cal</span>
        </div>
        <span class="item-portion">${item.portion}</span>
      </div>
      ${badges ? `<div class="badges">${badges}</div>` : ''}
    </div>
  `;
}

function toggleItem(el, itemJsonStr) {
    const item = JSON.parse(itemJsonStr);
    el.classList.toggle('selected');
    const idx = selectedItems.findIndex(i => i.name === item.name && i.station === item.station);
    if (idx >= 0) selectedItems.splice(idx, 1);
    else selectedItems.push(item);
    updateLogBar();
}

function updateLogBar() {
    const bar = document.getElementById('logBar');
    if (!bar) return;
    if (!selectedItems.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    const totalCal = selectedItems.reduce((s, i) => s + (i.calories || 0), 0);
    document.getElementById('logCount').textContent = `${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''} selected`;
    document.getElementById('logCalBadge').textContent = `${totalCal} cal`;
}

function clearSelection() {
    selectedItems = [];
    document.querySelectorAll('.menu-item.selected').forEach(el => el.classList.remove('selected'));
    updateLogBar();
}

// ── Log Modal ─────────────────────────────
function openLogModal() {
    if (!selectedItems.length) return;
    const totalCal = selectedItems.reduce((s, i) => s + (i.calories || 0), 0);

    const sel = document.getElementById('locationSelect');
    let locName = 'TAMU Dining';
    try { locName = JSON.parse(sel.value).name; } catch { }

    // Build summary
    const summaryHtml = selectedItems.map(i =>
        `<div>• ${i.name} <span style="color:var(--text-3)">(${i.calories} cal)</span></div>`
    ).join('');

    document.getElementById('logSummary').innerHTML = `
    ${summaryHtml}
    <div class="log-summary-total">Total: ${totalCal} calories</div>
  `;
    document.getElementById('mealNameInput').value = '';
    document.getElementById('mealNoteInput').value = '';
    document.getElementById('saveShortcutCheck').checked = false;
    document.getElementById('logModalBackdrop').classList.add('open');

    // Store context for confirm
    window._logContext = { totalCal, locName };
}

function closeLogModal() {
    document.getElementById('logModalBackdrop').classList.remove('open');
}

function confirmLog() {
    const { totalCal, locName } = window._logContext || {};
    const name = document.getElementById('mealNameInput').value.trim() || `${locName} · ${{ breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', brunch: 'Brunch' }[activePeriodSlug]}`;
    const note = document.getElementById('mealNoteInput').value.trim();
    const saveShortcut = document.getElementById('saveShortcutCheck').checked;

    const entry = {
        id: crypto.randomUUID(),
        date: todayStr(),
        timestamp: Date.now(),
        name,
        location: locName,
        period: activePeriodSlug,
        items: [...selectedItems],
        totalCal,
        note,
    };

    addLog(entry);

    if (saveShortcut) {
        const shortcuts = getShortcuts();
        shortcuts.push({ name, items: [...selectedItems], totalCal });
        saveShortcuts(shortcuts);
        toast(`✓ Meal logged & shortcut saved! (${totalCal} cal)`);
    } else {
        toast(`✓ Meal logged! (${totalCal} cal)`);
    }

    closeLogModal();
    clearSelection();
    // Go to dashboard to see the update
    showPage('dashboard');
}

// ── Toast ─────────────────────────────────
function toast(msg, duration = 3000) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
}

// ── Init ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    showPage('dashboard');
});
