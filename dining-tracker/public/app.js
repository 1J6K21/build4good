/* ════════════════════════════════════════════
   MindfulMacros — Frontend App (Authenticated)
   ════════════════════════════════════════════ */

const API = '';
let currentUser = null;
let selectedItems = [];
let activePeriodSlug = getCurrentPeriodSlug();
let activePeriodId = '';
let pollTimer = null;
let ringChart = null;
let weekChart = null;
let selectedLoggedMeals = [];
let lastFetchedLogs = [];
let servingIncrement = 0.5;
let trackingDate = null; // Will be initialized by todayStr() later

// ── Token Storage ─────────────────────────────
function getToken() { return localStorage.getItem('auth_token'); }
function setToken(t) { localStorage.setItem('auth_token', t); }
function clearToken() { localStorage.removeItem('auth_token'); }

// authFetch: wraps fetch() with Authorization header automatically
async function authFetch(url, opts = {}) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
        const res = await fetch(url, { ...opts, headers });
        if (res.status === 401) {
            console.warn("[Auth] Token expired or invalid.");
            clearToken();
            showPage('login');
        }
        return res;
    } catch (e) {
        console.error(`[Fetch] Error: ${url}`, e);
        throw e;
    }
}

// ── Auth Handling ────────────────────────────

async function checkAuth() {
    console.log("[Auth] Checking session...");
    if (!getToken()) {
        console.warn('[Auth] No token in localStorage.');
        showPage('login');
        initGoogleSignIn();
        return;
    }
    try {
        const res = await authFetch(`${API}/api/auth/me`);
        const data = await res.json();

        if (data.authenticated) {
            console.log("[Auth] Success! Logged in as:", data.user.email);
            currentUser = data.user;
            onLoginSuccess();
        } else {
            console.warn("[Auth] No session found. Reason:", data.error || "none");
            clearToken();
            showPage('login');
            initGoogleSignIn();
        }
    } catch (e) {
        console.error('[Auth] Connection error', e);
        showPage('login');
        toast("Auth connection error. Retrying...");
    }
}

async function initGoogleSignIn() {
    if (!window.google) return setTimeout(initGoogleSignIn, 100);

    try {
        const res = await fetch(`${API}/api/auth/config`);
        const { googleClientId } = await res.json();

        google.accounts.id.initialize({
            client_id: googleClientId,
            callback: handleCredentialResponse
        });
        google.accounts.id.renderButton(
            document.getElementById("googleBtn"),
            { theme: "outline", size: "large", width: 320 }
        );
    } catch (e) {
        console.error('Failed to load login config', e);
    }
}

async function handleCredentialResponse(response) {
    try {
        const res = await fetch(`${API}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        const data = await res.json();
        if (data.token && data.user) {
            setToken(data.token);
            currentUser = data.user;
            onLoginSuccess();
        }
    } catch (e) {
        toast('Login failed. Try again.');
    }
}

function onLoginSuccess() {
    document.querySelector('.navbar').style.display = 'flex';
    document.getElementById('userAvatar').src = currentUser.picture;
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userEmail').textContent = currentUser.email;
    
    // Initialize Tracking Date
    trackingDate = todayStr();
    updateNavDateDisplay(trackingDate);

    showPage('dashboard');
}

async function logout() {
    clearToken();
    location.reload();
}

function toggleUserMenu() {
    document.getElementById('userDropdown').classList.toggle('active');
}

// ── Data Sync ────────────────────────────────

async function fetchLogs(date) {
    const res = await authFetch(`${API}/api/user/logs?date=${date}`);
    const data = await res.json();
    return data.logs || [];
}

async function addLogEntry(date, mealType, items, name) {
    for (const item of items) {
        console.log(`[Log] Posting meal: ${item.name} | Date: ${date}`);
        const res = await authFetch(`${API}/api/user/logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, mealType, item })
        });
        if (!res.ok) {
            console.error(`[Log] Error logging ${item.name}`, await res.text());
            return false;
        }
    }
    return true;
}

async function removeLog(id) {
    await authFetch(`${API}/api/user/logs/${id}`, { method: 'DELETE' });
    refreshDashboard();
}

// ── Navigation ────────────────────────────

function showPage(name) {
    if (!currentUser && name !== 'login') return;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const pageEl = document.getElementById('page-' + name);
    if (pageEl) pageEl.classList.add('active');

    const navEl = document.getElementById('nav-' + name);
    if (navEl) navEl.classList.add('active');

    if (name === 'dashboard') refreshDashboard();
    if (name === 'menu') initMenuPage();
    if (name === 'leaderboard') fetchLeaderboard();
}

// ── Dashboard ─────────────────────────────

async function refreshDashboard() {
    if (!currentUser) return;
    
    // Clear selections on refresh to avoid stale IDs
    selectedLoggedMeals = [];
    updateBulkActions();

    const date = trackingDate || todayStr();
    const logs = await fetchLogs(date);
    const totals = (logs || []).reduce((acc, l) => {
        acc.cal += (l.calories || 0);
        acc.p += (l.protein || 0);
        acc.f += (l.fat || 0);
        acc.c += (l.carbs || 0);
        acc.sodium += (l.sodium || 0);
        acc.fiber += (l.fiber || 0);
        acc.sugar += (l.sugars || 0);
        return acc;
    }, { cal: 0, p: 0, f: 0, c: 0, sodium: 0, fiber: 0, sugar: 0 });

    const calGoal = currentUser.calorie_goal || 2000;
    const proGoal = currentUser.protein_goal || 120;
    const fatGoal = currentUser.fat_goal || 70;
    const carbGoal = currentUser.carb_goal || 250;

    const remainingCal = Math.max(0, calGoal - totals.cal);

    if (document.getElementById('ringCurrent')) document.getElementById('ringCurrent').textContent = Math.round(totals.cal).toLocaleString();
    if (document.getElementById('ringGoal')) document.getElementById('ringGoal').textContent = calGoal.toLocaleString();
    if (document.getElementById('ringRemaining')) {
        document.getElementById('ringRemaining').textContent = remainingCal > 0
            ? `${remainingCal.toLocaleString()} remaining`
            : `${Math.abs(totals.cal - calGoal).toLocaleString()} over goal`;
    }

    if (document.getElementById('statMeals')) document.getElementById('statMeals').textContent = logs.length;
    if (document.getElementById('statStreak')) document.getElementById('statStreak').innerHTML = '<i class="fa-solid fa-fire"></i>';

    // Macro Grid Update
    const remainingP = Math.max(0, proGoal - totals.p);
    const remainingC = Math.max(0, carbGoal - totals.c);
    const remainingF = Math.max(0, fatGoal - totals.f);

    if (document.getElementById('totalProtein')) document.getElementById('totalProtein').textContent = Math.round(totals.p);
    if (document.getElementById('proteinGoalLabel')) document.getElementById('proteinGoalLabel').textContent = proGoal;
    if (document.getElementById('proteinRemaining')) document.getElementById('proteinRemaining').textContent = Math.round(remainingP);

    if (document.getElementById('totalCarbs')) document.getElementById('totalCarbs').textContent = Math.round(totals.c);
    if (document.getElementById('carbsGoalLabel')) document.getElementById('carbsGoalLabel').textContent = carbGoal;
    if (document.getElementById('carbsRemaining')) document.getElementById('carbsRemaining').textContent = Math.round(remainingC);

    if (document.getElementById('totalFat')) document.getElementById('totalFat').textContent = Math.round(totals.f);
    if (document.getElementById('fatGoalLabel')) document.getElementById('fatGoalLabel').textContent = fatGoal;
    if (document.getElementById('fatRemaining')) document.getElementById('fatRemaining').textContent = Math.round(remainingF);

    updateMacroRing('proteinRing', 'proteinPctText', totals.p, proGoal);
    updateMacroRing('carbsRing', 'carbsPctText', totals.c, carbGoal);
    updateMacroRing('fatRing', 'fatPctText', totals.f, fatGoal);

    // Dynamic Nutrients
    let tracked = [];
    try {
        tracked = JSON.parse(currentUser.tracked_nutrients || '[]');
    } catch (e) { }

    // Clear old dynamic cards
    document.querySelectorAll('.dynamic-card').forEach(el => el.remove());

    const grid = document.querySelector('.macro-grid');
    const addCard = document.querySelector('.add-tracker-card');

    if (grid && addCard) {
        tracked.forEach(metric => {
            const cardHtml = renderDynamicNutrientCard(metric, totals[metric]);
            const temp = document.createElement('div');
            temp.innerHTML = cardHtml.trim();
            grid.insertBefore(temp.firstChild, addCard);
        });
    }

    if (document.getElementById('todayDateLabel')) {
        const d = new Date((trackingDate || todayStr()) + 'T12:00:00');
        document.getElementById('todayDateLabel').textContent =
            d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }

    if (document.getElementById('dashboardMealsTitle')) {
      const isToday = (trackingDate || todayStr()) === todayStr();
      document.getElementById('dashboardMealsTitle').textContent = isToday ? "Today's Meals" : "Logged Meals";
    }

    if (document.getElementById('ringLabelTop')) {
      const isToday = (trackingDate || todayStr()) === todayStr();
      document.getElementById('ringLabelTop').textContent = isToday ? "Today's Calories" : "Daily Calories";
    }

    drawRing(totals.cal, calGoal);
    renderTodayMeals(logs);
    renderShortcuts();

    // Safety check to ensure these execute even if shortcuts load fails
    try { updateTrendChart(); } catch (e) { console.error(e); }
    try { updateWeeklyOverview(); } catch (e) { console.error(e); }
    try { updateWeightProjection(); } catch (e) { console.error(e); }
}

async function renderShortcuts() {
    const el = document.getElementById('shortcutsList');
    if (!el) return;
    const res = await authFetch(`${API}/api/user/shortcuts`);
    const data = await res.json();
    const list = data.shortcuts || [];

    if (!list.length) {
        el.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="fa-solid fa-bookmark"></i></div>
                <p>Save a meal combo as a shortcut for fast logging.</p>
            </div>
        `;
        return;
    }

    el.innerHTML = list.map(s => `
        <div class="shortcut-item" onclick="logShortcut(${s.id}, '${s.name.replace(/'/g, "\\'")}')">
            <div class="shortcut-info">
                <div class="shortcut-name">${s.name}</div>
                <div class="shortcut-meta">${s.items.length} items</div>
            </div>
            <div class="shortcut-action">
                <i class="fa-solid fa-plus"></i>
            </div>
        </div>
    `).join('');
}

async function logShortcut(id, name) {
    const res = await authFetch(`${API}/api/user/shortcuts`);
    const data = await res.json();
    const s = data.shortcuts.find(x => x.id === id);
    if (!s) return;

    const date = trackingDate || todayStr();
    for (const item of s.items) {
        await addLogEntry(date, 'shortcut', [item]);
    }
    refreshDashboard();
    toast(`Shortcut "${name}" logged!`);
}

let trendChartInstance = null;

async function updateTrendChart() {
    const metric = document.getElementById('trendMetric')?.value || 'calories';
    const durationDays = parseInt(document.getElementById('trendDuration')?.value || '7');

    const endD = new Date();
    const startD = new Date();
    startD.setDate(endD.getDate() - (durationDays - 1));

    const startStr = formatDate(startD);
    const endStr = formatDate(endD);

    try {
        const res = await authFetch(`${API}/api/user/logs-range?start=${startStr}&end=${endStr}`);
        const data = await res.json();
        const logs = data.logs || [];

        const emptyOverlay = document.getElementById('trendEmpty');
        const hasData = logs.length > 0;
        if (emptyOverlay) {
            emptyOverlay.style.display = hasData ? 'none' : 'flex';
            emptyOverlay.style.position = 'absolute';
            emptyOverlay.style.inset = '0';
        }

        const labels = [];
        const values = [];

        if (durationDays <= 60) {
            // Daily Aggregation
            const dailyMap = {};
            for (let i = 0; i < durationDays; i++) {
                const d = new Date(startD);
                d.setDate(d.getDate() + i);
                dailyMap[formatDate(d)] = 0;
            }
            logs.forEach(l => {
                if (dailyMap[l.date] !== undefined) dailyMap[l.date] += (l[metric] || 0);
            });
            Object.keys(dailyMap).sort().forEach(d => {
                const p = d.split('-');
                labels.push(`${p[1]}/${p[2]}`);
                values.push(dailyMap[d]);
            });
        } else {
            // Group by Week or Month for long durations
            const isMonthly = durationDays > 365;
            const groupMap = {};

            logs.forEach(l => {
                const d = new Date(l.date);
                const key = isMonthly ? `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`
                    : `${d.getFullYear()}-W${getWeekNumber(d).toString().padStart(2, '0')}`;
                groupMap[key] = (groupMap[key] || 0) + (l[metric] || 0);
            });

            // Fill gaps
            let cur = new Date(startD);
            while (cur <= endD) {
                const key = isMonthly ? `${cur.getFullYear()}-${(cur.getMonth() + 1).toString().padStart(2, '0')}`
                    : `${cur.getFullYear()}-W${getWeekNumber(cur).toString().padStart(2, '0')}`;
                if (groupMap[key] === undefined) groupMap[key] = 0;
                if (isMonthly) cur.setMonth(cur.getMonth() + 1);
                else cur.setDate(cur.getDate() + 7);
            }

            Object.keys(groupMap).sort().forEach(k => {
                labels.push(k);
                values.push(groupMap[k]);
            });
        }

        const canvas = document.getElementById('trendChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (trendChartInstance) trendChartInstance.destroy();

        trendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: metric.replace('_', ' ').toUpperCase(),
                    data: values,
                    borderColor: '#500000',
                    backgroundColor: 'rgba(80, 0, 0, 0.05)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: durationDays > 30 ? 0 : (hasData ? 4 : 0),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { color: '#f5f5f5' }, ticks: { display: hasData } },
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 12, display: hasData } }
                },
                plugins: { legend: { display: false }, tooltip: { enabled: hasData } }
            }
        });
    } catch (e) { console.error('Trend load fail', e); }
}

async function updateWeeklyOverview() {
    const endD = new Date();
    const startD = new Date();
    startD.setDate(endD.getDate() - 6);

    const startStr = formatDate(startD);
    const endStr = formatDate(endD);

    try {
        const res = await authFetch(`${API}/api/user/logs-range?start=${startStr}&end=${endStr}`);
        const data = await res.json();
        const logs = data.logs || [];

        const emptyOverlay = document.getElementById('weekEmpty');
        const hasData = logs.length > 0;
        if (emptyOverlay) emptyOverlay.style.display = hasData ? 'none' : 'flex';

        const dailyMap = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(startD);
            d.setDate(d.getDate() + i);
            dailyMap[formatDate(d)] = 0;
        }
        logs.forEach(l => {
            if (dailyMap[l.date] !== undefined) dailyMap[l.date] += (l.calories || 0);
        });

        const labels = Object.keys(dailyMap).sort().map(d => {
            const date = new Date(d + 'T12:00:00');
            return date.toLocaleDateString('en-US', { weekday: 'short' });
        });
        const cals = Object.keys(dailyMap).sort().map(d => dailyMap[d]);

        const canvas = document.getElementById('weekChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // Use the proper instance variable
        if (weekChart && typeof weekChart.destroy === 'function') weekChart.destroy();

        weekChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Calories',
                    data: cals,
                    backgroundColor: '#500000',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { color: '#f5f5f5' }, ticks: { display: hasData } },
                    x: { grid: { display: false }, ticks: { display: hasData } }
                },
                plugins: { legend: { display: false }, tooltip: { enabled: hasData } }
            }
        });
    } catch (e) { }
}

function getWeekNumber(d) {
    const temp = new Date(d.valueOf());
    temp.setDate(temp.getDate() + 4 - (temp.getDay() || 7));
    const yearStart = new Date(temp.getFullYear(), 0, 1);
    return Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
}

function updateMacroRing(ringId, textId, current, goal) {
    const pct = Math.min(100, Math.round((current / goal) * 100));
    const ring = document.getElementById(ringId);
    if (ring) {
        ring.setAttribute('stroke-dasharray', `${pct}, 100`);
    }
    const text = document.getElementById(textId);
    if (text) {
        text.textContent = `${pct}%`;
    }
}

function drawRing(current, goal) {
    const canvas = document.getElementById('calRingCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pct = Math.min(1, current / goal);
    const over = current > goal;

    if (ringChart) ringChart.destroy();

    ringChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: pct < 1 ? [pct, 1 - pct] : [1, 0],
                backgroundColor: [over ? '#ef4444' : '#500000', '#f0e8e8'],
                borderWidth: 0
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

function renderTodayMeals(meals) {
    lastFetchedLogs = meals || []; // Cache for selection logic
    const el = document.getElementById('todayMealsList');
    if (!el) return;
    if (!meals.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">🥗</div><p>No meals logged today.</p><button class="btn btn-primary" onclick="showPage('menu')">Browse Menu</button></div>`;
        updateBulkActions();
        return;
    }
    el.innerHTML = meals.map(m => {
        const isSelected = selectedLoggedMeals.includes(String(m.id));
        return `
    <div class="meal-entry ${isSelected ? 'selected' : ''}">
      <div class="meal-entry-header" onclick="toggleMealSelection('${String(m.id)}')">
        <div class="meal-entry-header-left" style="display: flex; align-items: center;">
          <div class="meal-checkbox-wrapper">
             <input type="checkbox" class="meal-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleMealSelection('${String(m.id)}')">
          </div>
          <div class="meal-entry-left">
            <div class="meal-entry-name">${(m.meal_type || 'meal').charAt(0).toUpperCase() + (m.meal_type || 'meal').slice(1)}</div>
            <div class="meal-entry-meta">${m.item_name}</div>
            <div class="meal-entry-macros">
              ${m.protein || 0}g P · ${m.fat || 0}g F · ${m.carbs || 0}g C
            </div>
          </div>
        </div>
        <div class="meal-entry-right" onclick="event.stopPropagation()">
          <div class="meal-cal-badge">${m.calories || 0} cal</div>
        </div>
      </div>
    </div>
  `}).join('');
    updateBulkActions();
}

function toggleMealSelection(id) {
    const sId = String(id);
    const idx = selectedLoggedMeals.indexOf(sId);
    if (idx >= 0) {
        selectedLoggedMeals.splice(idx, 1);
    } else {
        selectedLoggedMeals.push(sId);
    }
    renderTodayMeals(lastFetchedLogs);
}

function updateBulkActions() {
    const bar = document.getElementById('mealsBulkActions');
    const countEl = document.getElementById('bulkCount');
    if (!bar || !countEl) return;

    if (selectedLoggedMeals.length > 0) {
        bar.style.display = 'flex';
        countEl.textContent = `${selectedLoggedMeals.length} selected`;
    } else {
        bar.style.display = 'none';
    }
}

async function aggregateSelectedMeals() {
    console.log("[Aggregate] Selected IDs:", selectedLoggedMeals);
    const selected = lastFetchedLogs.filter(m => selectedLoggedMeals.includes(String(m.id)));
    console.log("[Aggregate] Matching items found:", selected.length);
    if (selected.length === 0) {
        toast("Select some meals to see the summary.");
        return;
    }

    const agg = selected.reduce((acc, m) => {
        acc.calories += (m.calories || 0);
        acc.protein += (m.protein || 0);
        acc.fat += (m.fat || 0);
        acc.carbs += (m.carbs || 0);
        acc.sodium += (m.sodium || 0);
        acc.fiber += (m.fiber || 0);
        acc.sugars += (m.sugars || 0);
        acc.saturated_fat += (m.saturated_fat || 0);
        acc.trans_fat += (m.trans_fat || 0);
        acc.cholesterol += (m.cholesterol || 0);
        return acc;
    }, {
        name: "Aggregated Meal",
        calories: 0, protein: 0, fat: 0, carbs: 0, sodium: 0,
        fiber: 0, sugars: 0, saturated_fat: 0, trans_fat: 0, cholesterol: 0
    });

    // Rounding
    Object.keys(agg).forEach(k => {
        if (typeof agg[k] === 'number') agg[k] = Math.round(agg[k]);
    });

    const grid = document.getElementById('aggregateStatsGrid');
    grid.innerHTML = `
        <div class="aggregate-stat-card">
            <span class="aggregate-stat-val">${agg.calories}</span>
            <span class="aggregate-stat-lbl">CALORIES</span>
        </div>
        <div class="aggregate-stat-card">
            <span class="aggregate-stat-val">${agg.protein}g</span>
            <span class="aggregate-stat-lbl">PROTEIN</span>
        </div>
        <div class="aggregate-stat-card">
            <span class="aggregate-stat-val">${agg.carbs}g</span>
            <span class="aggregate-stat-lbl">CARBS</span>
        </div>
        <div class="aggregate-stat-card">
            <span class="aggregate-stat-val">${agg.fat}g</span>
            <span class="aggregate-stat-lbl">FAT</span>
        </div>
        <div class="aggregate-stat-card">
            <span class="aggregate-stat-val">${agg.sodium}mg</span>
            <span class="aggregate-stat-lbl">SODIUM</span>
        </div>
        <div class="aggregate-stat-card">
            <span class="aggregate-stat-val">${agg.fiber}g</span>
            <span class="aggregate-stat-lbl">FIBER</span>
        </div>
    `;

    document.getElementById('copyableJson').textContent = JSON.stringify(agg, null, 2);
    document.getElementById('aggregateModalBackdrop').classList.add('open');
}

async function removeSelectedMeals() {
    if (selectedLoggedMeals.length === 0) return;
    if (!confirm(`Permanently delete ${selectedLoggedMeals.length} selected meal logs?`)) return;

    for (const id of selectedLoggedMeals) {
        await authFetch(`${API}/api/user/logs/${id}`, { method: 'DELETE' });
    }
    
    toast(`${selectedLoggedMeals.length} logs removed.`);
    selectedLoggedMeals = [];
    refreshDashboard();
}

function closeAggregateModal() {
    document.getElementById('aggregateModalBackdrop').classList.remove('open');
}

function copyAggregateJson() {
    const text = document.getElementById('copyableJson').textContent;
    navigator.clipboard.writeText(text).then(() => {
        toast('Meal object copied to clipboard!');
    });
}

async function removeMeal(id) {
    if (confirm('Delete this meal log?')) {
        await removeLog(id);
        toast('Logged meal removed');
    }
}

// ── Menu Page (Reused Logic) ─────────────────────────

async function initMenuPage() {
    await loadLocations();
    const dateInp = document.getElementById('dateInput');

    // Set min/max to prevent selecting impossible dates
    const today = new Date();
    const minDate = new Date(); minDate.setDate(today.getDate() - 30);
    const maxDate = new Date(); maxDate.setDate(today.getDate() + 14);

    dateInp.min = formatDate(minDate);
    dateInp.max = formatDate(maxDate);

    if (!dateInp.value) dateInp.value = trackingDate || todayStr();
    updateAvailablePeriods();
    loadMenu();
}

function updateAvailablePeriods() {
    const dateInput = document.getElementById('dateInput');
    const dateStr = dateInput.value || todayStr();
    const day = new Date(dateStr + 'T12:00:00').getDay();
    const isWeekend = (day === 0 || day === 6);

    let firstVisible = null;
    let foundActive = false;

    document.querySelectorAll('.period-pill').forEach(btn => {
        const p = btn.dataset.period;
        const visible = (isWeekend && (p === 'brunch' || p === 'dinner')) || (!isWeekend && p !== 'brunch');
        btn.style.display = visible ? 'block' : 'none';

        if (visible) {
            if (!firstVisible) firstVisible = p;
            if (p === activePeriodSlug) {
                btn.classList.add('active');
                foundActive = true;
            } else {
                btn.classList.remove('active');
            }
        } else {
            btn.classList.remove('active');
        }
    });

    // If current selected period is hidden on this date (e.g. Breakfast on Sunday), switch to Brunch
    if (!foundActive && firstVisible) {
        activePeriodSlug = firstVisible;
        const btn = document.querySelector(`.period-pill[data-period="${activePeriodSlug}"]`);
        if (btn) btn.classList.add('active');
    }
}

function getCurrentPeriodSlug() {
    const hour = new Date().getHours();
    const day = new Date().getDay();
    const isWeekend = (day === 0 || day === 6);

    if (isWeekend) {
        return hour < 15 ? 'brunch' : 'dinner';
    } else {
        if (hour < 10) return 'breakfast';
        if (hour < 15) return 'lunch';
        return 'dinner';
    }
}

async function loadLocations() {
    const res = await fetch(`${API}/api/locations`);
    const data = await res.json();
    const sel = document.getElementById('locationSelect');
    const grouped = data.grouped || {};
    sel.innerHTML = '';
    for (const [group, locs] of Object.entries(grouped)) {
        const og = document.createElement('optgroup');
        og.label = group;
        locs.forEach(loc => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ slug: loc.slug, id: loc.id, name: loc.name });
            opt.textContent = loc.name;
            og.appendChild(opt);
        });
        sel.appendChild(og);
    }
}

async function loadMenu() {
    const sel = document.getElementById('locationSelect');
    if (!sel.value) return;
    const locData = JSON.parse(sel.value);
    const date = document.getElementById('dateInput').value || todayStr();

    // Check if this is a Retail location (most don't have structured menus)
    const isRetail = locData.name.includes('Chick-Fil-A') ||
        locData.name.includes('Panda Express') ||
        locData.name.includes('Pizza') ||
        locData.name.includes('Burgers') ||
        locData.name.includes('Bagels');

    if (isRetail) {
        showLoading(false);
        renderUnsupported(locData.name, activePeriodSlug);
        return;
    }

    showLoading(true);
    console.log(`[Frontend] Fetching menu for: ${locData.slug} | ${activePeriodSlug} | ${date}`);
    const res = await fetch(`${API}/api/menu?locationSlug=${encodeURIComponent(locData.slug)}&periodSlug=${encodeURIComponent(activePeriodSlug)}&date=${date}`);
    const data = await res.json();
    console.log('[Frontend] Menu API response:', data);

    if (data.status === 'ready') {
        showLoading(false);
        const waitStats = await fetchWaitTimes(locData.slug);
        renderMenu(data.stations, locData.name, activePeriodSlug, date, waitStats);
    } else if (data.status === 'scraping') {
        showLoading(false);
        renderScraping(data.step);
        pollScrape(locData.slug, date);
    } else if (data.status === 'failed') {
        showLoading(false);
        console.error('[Frontend] Scrape failed:', data.error);
        renderError(data.error || 'Scrape failed');
    }
}

function pollScrape(slug, date) {
    if (pollTimer) clearInterval(pollTimer);
    console.log(`[Frontend] Started polling for status: ${slug}`);
    pollTimer = setInterval(async () => {
        const res = await fetch(`${API}/api/menu/status?locationSlug=${encodeURIComponent(slug)}&periodSlug=${encodeURIComponent(activePeriodSlug)}&date=${date}`);
        const data = await res.json();
        console.log('[Frontend] Status poll result:', data);

        if (data.status === 'ready') {
            clearInterval(pollTimer);
            loadMenu();
        } else if (data.status === 'failed') {
            clearInterval(pollTimer);
            renderError(data.error || 'Scrape failed');
        } else if (data.status === 'scraping') {
            renderScraping(data.step);
        }
    }, 3000);
}

function renderMenu(stations, locName, period, date, waitStats = []) {
    selectedItems = [];
    updateLogBar();
    const mc = document.getElementById('menuContent');

    const visibleStations = stations.filter(s => s.items && s.items.length > 0);

    if (visibleStations.length === 0) {
        const isFuture = new Date(date) > new Date();
        mc.innerHTML = `
            <div class="location-header">
                <div class="location-title">${locName}</div>
                <div class="location-period">${period}</div>
            </div>
            <div class="empty-state card glass shadow-lg" style="padding: 60px 20px; border-radius: 20px;">
                <div class="empty-icon" style="font-size: 3rem; margin-bottom: 20px;">
                    <i class="fa-solid ${isFuture ? 'fa-calendar-week' : 'fa-moon'}"></i>
                </div>
                <p style="font-size: 1.2rem; margin-bottom: 8px;"><strong>${isFuture ? 'Menu not yet published' : 'Location is closed'}</strong></p>
                <p class="form-hint" style="max-width: 300px; margin: 0 auto;">${isFuture ? 'Dining halls usually publish menus 1 week in advance. Check back soon!' : 'This location may be closed for the selected meal period or date.'}</p>
                <button class="btn btn-outline" style="margin-top: 24px;" onclick="showPage('dashboard')">Back to Dashboard</button>
            </div>
        `;
        return;
    }

    const sel = document.getElementById('locationSelect');
    const locSlug = JSON.parse(sel.value).slug;

    mc.innerHTML = `
    <div class="menu-intro" style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem;">
        <div>
            <span style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 700;">Currently Viewing</span>
            <h1 class="location-title-main" style="font-size: 1.8rem; font-weight: 900; letter-spacing: -0.04em; margin-top: 4px;">${locName}</h1>
        </div>
        <button class="btn btn-sm btn-ghost force-refresh-btn" onclick="forceRescrape()" title="Force Refresh Menu" style="opacity: 0.4; border: 1px solid var(--border); border-radius: 50%; width: 36px; height: 36px; padding: 0;">
            <i class="fa-solid fa-arrows-rotate"></i>
        </button>
    </div>
    ` + visibleStations.map(s => {
        const stats = waitStats.find(ws => ws.station_name === s.name);
        let waitDisplay = '-- Wait';
        if (stats) {
            const avg = stats.avg;
            if (avg < 60) waitDisplay = `${Math.round(avg)}s Wait`;
            else waitDisplay = `${Math.round(avg / 60)}m Wait`;
        }

        return `
        <div class="station-block">
            <div class="station-header-row">
                <div class="station-name">${s.name}</div>
                <div class="station-wait-pill" id="pill-${s.name.replace(/\s+/g, '-')}">
                    <i class="fa-solid fa-clock"></i> ${waitDisplay}
                </div>
            </div>
            
            <div class="wait-reporter-inline card">
                <div class="reporter-header" onclick="toggleWaitReporter(this)">
                    <div class="reporter-label">Is there a line at <strong>${s.name}</strong>?</div>
                    <button class="btn btn-sm btn-ghost reporter-btn">
                        <i class="fa-solid fa-pen-to-square"></i> Report Wait
                    </button>
                </div>
                <div class="reporter-controls" style="display: none;">
                    <div class="controls-inner">
                        <input type="range" class="wait-slider-mini" min="0" max="14" step="1" value="3" 
                            oninput="updateMiniWaitLabel(this)">
                        <div class="slider-footer">
                            <span class="wait-label-mini">1 min</span>
                            <button class="btn btn-primary btn-sm" onclick="submitStationWaitTime('${locSlug}', '${s.name.replace(/'/g, "\\'")}', this)">Submit Report</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="item-grid">
                ${s.items.map(item => {
            const isSelected = selectedItems.find(i => i.name === item.name);
            const servings = isSelected ? isSelected.servings : 1;
            return `
                    <div class="menu-item ${isSelected ? 'selected' : ''}" id="item-${item.name.replace(/\s+/g, '-')}" onclick="toggleItem(this, ${JSON.stringify(item).replace(/"/g, '&quot;')})">
                        <div class="item-name">${item.name}</div>
                        <div class="item-badges">
                            ${(item.badges || []).map(b => `<span class="badge badge-${b}">${b}</span>`).join('')}
                        </div>
                        <div class="item-cal">${item.calories} cal</div>
                        <div class="item-macros-preview">
                            <span class="item-macro">P <strong>${item.protein || 0}g</strong></span>
                            <span class="item-macro">F <strong>${item.fat || 0}g</strong></span>
                            <span class="item-macro">C <strong>${item.carbs || 0}g</strong></span>
                        </div>
                        <div class="item-serving-controls" onclick="event.stopPropagation()">
                            <div class="stepper">
                                <button class="step-btn" onclick="changeServings('${item.name.replace(/'/g, "\\'")}', -1)">−</button>
                                <span class="serving-val">${servings}</span>
                                <button class="step-btn" onclick="changeServings('${item.name.replace(/'/g, "\\'")}', 1)">+</button>
                            </div>
                            <div class="increment-toggle">
                                <button class="inc-btn ${servingIncrement === 0.1 ? 'active' : ''}" onclick="setServingIncrement(0.1)">.1</button>
                                <button class="inc-btn ${servingIncrement === 0.5 ? 'active' : ''}" onclick="setServingIncrement(0.5)">.5</button>
                                <button class="inc-btn ${servingIncrement === 1.0 ? 'active' : ''}" onclick="setServingIncrement(1.0)">1</button>
                            </div>
                        </div>
                    </div>
                `}).join('')}
            </div>
        </div>
    `}).join('');
}

function toggleItem(el, item) {
    const idx = selectedItems.findIndex(i => i.name === item.name);
    if (idx >= 0) {
        selectedItems.splice(idx, 1);
        el.classList.remove('selected');
    } else {
        item.servings = 1;
        // Mocking macros for now as they aren't in the scraper yet, but we want to show them
        // Better to have 0 than undefined
        item.protein = item.protein || 0;
        item.fat = item.fat || 0;
        item.carbs = item.carbs || 0;
        selectedItems.push(item);
        el.classList.add('selected');
    }
    updateLogBar();
}

function changeServings(name, sign) {
    const idx = selectedItems.findIndex(i => i.name === name);
    if (idx < 0) return; // Item not selected

    const delta = sign * servingIncrement;
    selectedItems[idx].servings = Math.max(0.1, parseFloat((selectedItems[idx].servings + delta).toFixed(1)));

    // Update UI for the specific item
    const itemEl = document.getElementById(`item-${name.replace(/\s+/g, '-')}`);
    if (itemEl) {
        const valEl = itemEl.querySelector('.serving-val');
        if (valEl) valEl.textContent = selectedItems[idx].servings;
    }

    updateLogBar();
}

function setServingIncrement(val) {
    servingIncrement = val;
    // Update all increment buttons in the UI without full re-render
    document.querySelectorAll('.inc-btn').forEach(btn => {
        const btnVal = parseFloat(btn.textContent);
        // Special case for ".1" and ".5"
        const isMatch = (btnVal === val) || (val === 0.1 && btn.textContent === '.1') || (val === 0.5 && btn.textContent === '.5') || (val === 1.0 && btn.textContent === '1');
        
        if (isMatch) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    toast(`Increment set to ${val}`);
}

function updateLogBar() {
    const bar = document.getElementById('logBar');
    if (!selectedItems.length) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'block';

    const totals = selectedItems.reduce((acc, i) => {
        acc.cal += (i.calories || 0) * i.servings;
        acc.p += (i.protein || 0) * i.servings;
        acc.f += (i.fat || 0) * i.servings;
        acc.c += (i.carbs || 0) * i.servings;
        return acc;
    }, { cal: 0, p: 0, f: 0, c: 0 });

    document.getElementById('logCount').textContent = `${selectedItems.length} items`;
    document.getElementById('logCalBadge').innerHTML = `
        <span class="macro-val"><strong>${Math.round(totals.cal)}</strong> cal</span>
        <span class="macro-divider">|</span>
        <span class="macro-val"><strong>${Math.round(totals.p)}</strong>g protein</span>
        <span class="macro-val"><strong>${Math.round(totals.f)}</strong>g fat</span>
        <span class="macro-val"><strong>${Math.round(totals.c)}</strong>g carbs</span>
    `;
}

function openLogModal() {
    const d = new Date((trackingDate || todayStr()) + 'T12:00:00');
    const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    
    document.getElementById('logSummary').innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
            <strong style="color: var(--text-2);"><i class="fa-solid fa-calendar-day"></i> Logging Date:</strong>
            <span style="font-weight: 800; color: var(--primary);">${dateStr}</span>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-3); margin-top: 4px;">
            ${selectedItems.length} item(s) selected
        </div>
    `;
    document.getElementById('logModalBackdrop').classList.add('open');
}

function closeLogModal() {
    document.getElementById('logModalBackdrop').classList.remove('open');
}

async function confirmLog() {
    const date = trackingDate || todayStr();
    // Multiply by servings before sending to legacy API or update API to handle servings
    const itemsToLog = selectedItems.map(i => ({
        ...i,
        name: i.servings !== 1 ? `${i.name} (${i.servings} servings)` : i.name,
        calories: Math.round((i.calories || 0) * i.servings),
        protein: Math.round((i.protein || 0) * i.servings),
        fat: Math.round((i.fat || 0) * i.servings),
        carbs: Math.round((i.carbs || 0) * i.servings),
        sodium: Math.round((i.sodium || 0) * i.servings),
        fiber: Math.round((i.fiber || 0) * i.servings),
        sugars: Math.round((i.sugars || 0) * i.servings),
        saturated_fat: Math.round((i.saturated_fat || 0) * i.servings),
        trans_fat: Math.round((i.trans_fat || 0) * i.servings),
        cholesterol: Math.round((i.cholesterol || 0) * i.servings)
    }));

    let allSuccess = true;
    for (const item of itemsToLog) {
        const ok = await addLogEntry(date, activePeriodSlug, [item]);
        if (!ok) allSuccess = false;
    }

    const saveAsShortcut = document.getElementById('saveShortcutCheck').checked;
    if (saveAsShortcut && allSuccess) {
        const name = document.getElementById('mealNameInput').value || `Combo ${new Date().toLocaleTimeString()}`;
        try {
            await authFetch(`${API}/api/user/shortcuts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, items: itemsToLog })
            });
        } catch (e) {
            console.error('Failed to save shortcut', e);
        }
    }

    closeLogModal();
    selectedItems = [];
    updateLogBar();
    showPage('dashboard');

    if (allSuccess) {
        toast('Meal logged!');
    } else {
        toast('Logged with some errors. Partial data may be missing.');
    }
    // Update projection immediately after logging
    updateWeightProjection();
}

function showLoading(show) { 
    const el = document.getElementById('menuLoading');
    if (show) {
        el.style.display = 'flex'; 
    } else {
        el.style.display = 'none';
    }
}

function renderScraping(step) {
    document.getElementById('menuContent').innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p class="loading-title">Extracting nutritional data...</p>
            <div class="scraping-step" style="background: rgba(80,0,0,0.05); padding: 10px 20px; border-radius: 8px; margin-top: 10px;">
                <span style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-3); display: block; margin-bottom: 4px;">Current Step</span>
                <strong style="color: var(--primary);">${step || 'Initializing...'}</strong>
            </div>
        </div>
    `;
}

function renderUnsupported(locName, period) {
    const mc = document.getElementById('menuContent');
    mc.innerHTML = `
        <h3>${locName} - ${period}</h3>
        <div class="empty-state">
            <div class="empty-icon"><i class="fa-solid fa-store-slash"></i></div>
            <p><strong>Menu not yet supported for this location.</strong></p>
            <p class="form-hint">Retail locations like Chick-Fil-A or Panda Express don't publish their live daily menus in a standard format.</p>
        </div>
    `;
}

function renderError(msg) {
    const mc = document.getElementById('menuContent');
    mc.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon text-red"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <p><strong>Something went wrong.</strong></p>
            <p class="form-hint">${msg}</p>
            <button class="btn btn-primary" style="margin-top:1rem" onclick="loadMenu()">Retry</button>
        </div>
    `;
}

function selectPeriod(btn) {
    document.querySelectorAll('.period-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activePeriodSlug = btn.dataset.period;
    loadMenu(); // Auto-reload when period changes
}

function onFilterChange() {
    loadMenu();
}

function clearSelection() {
    selectedItems = [];
    document.querySelectorAll('.menu-item.selected').forEach(el => {
        el.classList.remove('selected');
    });
    updateLogBar();
}

function formatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function todayStr() {
    return formatDate(new Date());
}

// ── Nav Date UI Helpers ──────────────────────────

function updateNavDateDisplay(dateStr) {
    if (!dateStr) return;
    const d = new Date(dateStr + 'T12:00:00');
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const day = d.getDate();
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    const fullDate = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    document.getElementById('navMonth').textContent = month;
    document.getElementById('navDay').textContent = day;
    
    const today = todayStr();
    const navDayNameEl = document.getElementById('navDayName');
    if (dateStr === today) {
        navDayNameEl.textContent = 'Today';
    } else {
        navDayNameEl.textContent = dayName;
    }
    
    document.getElementById('navDateFull').textContent = fullDate;
    
    const navPicker = document.getElementById('navDatePicker');
    if (navPicker) navPicker.value = dateStr;
}

function toggleNavDatePicker() {
    const el = document.getElementById('navDatePicker');
    if (el && typeof el.showPicker === 'function') {
        el.showPicker();
    } else if (el) {
        el.click();
    }
}

function onNavDateChange(newDate) {
    if (!newDate) return;
    trackingDate = newDate;
    updateNavDateDisplay(newDate);
    
    const dashboardPage = document.getElementById('page-dashboard');
    const menuPage = document.getElementById('page-menu');
    
    if (dashboardPage && dashboardPage.classList.contains('active')) {
        refreshDashboard();
    } else if (menuPage && menuPage.classList.contains('active')) {
        const menuDateInput = document.getElementById('dateInput');
        if (menuDateInput) {
            menuDateInput.value = newDate;
            onFilterChange(); 
        }
    }
    
    toast(`Tracking: ${newDate}`);
}

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function openGoalsModal() {
    document.getElementById('goalCaloriesInput').value = currentUser.calorie_goal || 2000;
    document.getElementById('goalProteinInput').value = currentUser.protein_goal || 120;
    document.getElementById('goalFatInput').value = currentUser.fat_goal || 70;
    document.getElementById('goalCarbInput').value = currentUser.carb_goal || 250;
    document.getElementById('userHeight').value = currentUser.height || '';
    document.getElementById('userWeight').value = currentUser.weight || '';
    document.getElementById('advisorSuggestion').innerHTML = 'Enter your metrics above to see suggested goals.';
    document.getElementById('goalsModalBackdrop').classList.add('open');
}

function closeGoalsModal() {
    document.getElementById('goalsModalBackdrop').classList.remove('open');
}

async function saveGoals() {
    const goals = {
        calorieGoal: document.getElementById('goalCaloriesInput').value,
        proteinGoal: document.getElementById('goalProteinInput').value,
        fatGoal: document.getElementById('goalFatInput').value,
        carbGoal: document.getElementById('goalCarbInput').value,
        height: document.getElementById('userHeight').value,
        weight: document.getElementById('userWeight').value
    };

    const res = await authFetch(`${API}/api/user/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(goals)
    });

    if (res.ok) {
        toast('Goals updated!');
        closeGoalsModal();
        // Update local session data so dashboard reflects changes
        currentUser.calorie_goal = parseInt(goals.calorieGoal);
        currentUser.protein_goal = parseInt(goals.proteinGoal);
        currentUser.fat_goal = parseInt(goals.fatGoal);
        currentUser.carb_goal = parseInt(goals.carbGoal);
        if (goals.height) currentUser.height = parseInt(goals.height);
        if (goals.weight) currentUser.weight = parseInt(goals.weight);
        refreshDashboard();
    }
}

document.addEventListener('DOMContentLoaded', checkAuth);
window.onclick = (e) => {
    // Dropdown handling
    const profile = e.target.closest('.user-profile');
    const dropdown = document.getElementById('userDropdown');
    if (!profile && dropdown) {
        dropdown.classList.remove('active');
    }
};

// =============================================================================
// Smart Advisor & Dashboard Expansion
// =============================================================================

function openAddTrackerModal() {
    const backdrop = document.getElementById('addTrackerModal');
    if (backdrop) backdrop.classList.add('open');
}

function closeAddTrackerModal() {
    const backdrop = document.getElementById('addTrackerModal');
    if (backdrop) backdrop.classList.remove('open');
}

async function addMetricToDashboard(metric) {
    if (!currentUser) return;

    let tracked = [];
    try {
        tracked = JSON.parse(currentUser.tracked_nutrients || '[]');
    } catch (e) {
        tracked = [];
    }

    if (tracked.includes(metric)) {
        toast(`${metric.charAt(0).toUpperCase() + metric.slice(1)} is already on your dashboard!`);
        closeAddTrackerModal();
        return;
    }

    tracked.push(metric);

    // Optimistic update
    currentUser.tracked_nutrients = JSON.stringify(tracked);

    const res = await authFetch(`${API}/api/user/nutrients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nutrients: tracked })
    });

    if (res.ok) {
        toast(`Added ${metric} to your dashboard!`);
        closeAddTrackerModal();
        refreshDashboard();
    } else {
        toast('Failed to update dashboard preferences.');
    }
}

async function removeMetricFromDashboard(metric) {
    if (!currentUser) return;
    if (!confirm(`Remove ${metric} from your dashboard?`)) return;

    let tracked = [];
    try {
        tracked = JSON.parse(currentUser.tracked_nutrients || '[]');
    } catch (e) { }

    tracked = tracked.filter(m => m !== metric);
    currentUser.tracked_nutrients = JSON.stringify(tracked);

    const res = await authFetch(`${API}/api/user/nutrients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nutrients: tracked })
    });

    if (res.ok) {
        toast(`Removed ${metric}.`);
        refreshDashboard();
    }
}

function calculateAdvisorSuggested() {
    const h = parseFloat(document.getElementById('userHeight').value);
    const w = parseFloat(document.getElementById('userWeight').value);

    if (!h || !w) {
        document.getElementById('advisorSuggestion').innerHTML = 'Enter your metrics above to see suggested goals.';
        return;
    }

    // Mifflin-St Jeor (assume 20 years old, male for middle-ground)
    // BMR = (10 * weight in kg) + (6.25 * height in cm) - (5 * age) + 5
    const weightKg = w * 0.453592;
    const heightCm = h * 2.54;
    const age = 20;

    const bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5;
    const tdee = Math.round(bmr * 1.4); // Lightly active multiplier

    // Suggest 30/30/40 split (standard)
    const protein = Math.round(w * 0.9); // 0.9g per lb
    const fat = Math.round(w * 0.35);    // 0.35g per lb
    const carbs = Math.round((tdee - (protein * 4) - (fat * 9)) / 4);

    document.getElementById('advisorSuggestion').innerHTML = `
        <strong>Suggested Daily Goals:</strong><br/>
        Calories: <strong>${tdee}</strong> kcal<br/>
        Protein: <strong>${protein}g</strong> • Fats: <strong>${fat}g</strong> • Carbs: <strong>${carbs}g</strong>
        <p style="font-size: 0.7rem; margin-top: 5px; opacity: 0.7;">Based on Mifflin-St Jeor formula for a 20yo lightly active adult.</p>
    `;

    // Store temporarily for applying
    window._lastSuggestion = { tdee, protein, fat, carbs };
}

function applyAdvisorSuggested() {
    if (!window._lastSuggestion) return;
    const { tdee, protein, fat, carbs } = window._lastSuggestion;

    document.getElementById('goalCaloriesInput').value = tdee;
    document.getElementById('goalProteinInput').value = protein;
    document.getElementById('goalFatInput').value = fat;
    document.getElementById('goalCarbInput').value = carbs;

    toast('Applied suggested values!');
}

// Helper to update the macro grid dynamically
function renderDynamicNutrientCard(metric, value, goal = 2400) {
    const labels = {
        sodium: { label: 'Sodium', icon: '🧂', unit: 'mg', goal: 2300, color: 'primary' },
        fiber: { label: 'Fiber', icon: '🥦', unit: 'g', goal: 25, color: 'green' },
        sugar: { label: 'Sugar', icon: '🍭', unit: 'g', goal: 50, color: 'amber' },
        water: { label: 'Water', icon: '💧', unit: 'oz', goal: 100, color: 'blue' }
    };

    const cfg = labels[metric] || { label: metric, icon: '📊', unit: '', goal: 100, color: 'primary' };
    const displayGoal = goal || cfg.goal;
    const pct = Math.min(100, Math.round((value / displayGoal) * 100));

    return `
        <div class="macro-card card dynamic-card">
            <div class="macro-header">
                <div class="macro-header-left">
                    <span class="macro-icon ${metric}">${cfg.icon}</span>
                    <span class="macro-label">${cfg.label}</span>
                </div>
                <button class="macro-remove-btn" onclick="removeMetricFromDashboard('${metric}')">×</button>
            </div>
            <div class="macro-body">
                <div class="macro-info">
                    <div class="macro-main">${Math.round(value)}${cfg.unit} / ${displayGoal}${cfg.unit}</div>
                    <div class="macro-sub">${Math.max(0, displayGoal - value).toFixed(0)}${cfg.unit} remaining</div>
                </div>
                <div class="macro-ring-container">
                    <svg viewBox="0 0 36 36" class="circular-chart ${cfg.color}">
                        <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                        <path class="circle" style="stroke-dasharray: ${pct}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                        <text x="18" y="20.35" class="percentage">${pct}%</text>
                    </svg>
                </div>
            </div>
        </div>
    `;
}

// ── WAIT TIMES Logic ──────────────────────────────
const WAIT_STEPS_VALS = [
    { label: 'Instant', seconds: 0 },
    { label: '15 seconds', seconds: 15 },
    { label: '30 seconds', seconds: 30 },
    { label: '1 min', seconds: 60 },
    { label: '2 min', seconds: 120 },
    { label: '3 min', seconds: 180 },
    { label: '5 min', seconds: 300 },
    { label: '7 min', seconds: 420 },
    { label: '10 min', seconds: 600 },
    { label: '15 min', seconds: 900 },
    { label: '20 min', seconds: 1200 },
    { label: '25 min', seconds: 1500 },
    { label: '30 min', seconds: 1800 },
    { label: '45 min', seconds: 2700 },
    { label: '1 hr', seconds: 3600 }
];

function onWaitSliderInput(val) {
    const step = WAIT_STEPS_VALS[parseInt(val)];
    document.getElementById('waitSliderText').textContent = step.label;
}

async function fetchWaitTimes(slug) {
    try {
        const res = await fetch(`/api/locations/${slug}/wait-time`);
        if (!res.ok) return [];
        const data = await res.json();
        // Ensure it's not HTML if some weird redirect happened
        if (typeof data === 'string' && data.includes('<!DOCTYPE')) return [];
        return data;
    } catch (e) {
        console.error('Wait stats error', e);
        return [];
    }
}

async function forceRescrape() {
    const sel = document.getElementById('locationSelect');
    if (!sel.value) return;
    const locData = JSON.parse(sel.value);
    const date = document.getElementById('dateInput').value || todayStr();

    toast('Force-refreshing menu data...');
    showLoading(true);
    const res = await fetch(`${API}/api/menu?locationSlug=${encodeURIComponent(locData.slug)}&periodSlug=${encodeURIComponent(activePeriodSlug)}&date=${date}&refresh=true`);
    const data = await res.json();

    if (data.status === 'scraping') {
        showLoading(false);
        renderScraping(data.step);
        pollScrape(locData.slug, date);
    } else if (data.status === 'ready') {
        showLoading(false);
        const waitStats = await fetchWaitTimes(locData.slug);
        renderMenu(data.stations, locData.name, activePeriodSlug, date, waitStats);
    }
}

function toggleWaitReporter(header) {
    const card = header.closest('.wait-reporter-inline');
    const controls = card.querySelector('.reporter-controls');
    const isHidden = controls.style.display === 'none';
    controls.style.display = isHidden ? 'block' : 'none';
}

function updateMiniWaitLabel(slider) {
    const label = slider.closest('.reporter-controls').querySelector('.wait-label-mini');
    const step = WAIT_STEPS_VALS[parseInt(slider.value)];
    label.textContent = step.label;
}

async function submitStationWaitTime(locSlug, stationName, btn) {
    const controls = btn.closest('.reporter-controls');
    const slider = controls.querySelector('.wait-slider-mini');
    const stepIdx = slider.value;
    const seconds = WAIT_STEPS_VALS[stepIdx].seconds;

    const res = await authFetch(`/api/locations/${locSlug}/wait-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds, stationName })
    });

    if (res.ok) {
        toast('Wait time reported!');
        // Automatically collapse
        controls.style.display = 'none';

        const data = await res.json();
        // Update the pill
        const stats = (data.stats || []).find(s => s.station_name === stationName);
        if (stats) {
            const pill = document.getElementById(`pill-${stationName.replace(/\s+/g, '-')}`);
            if (pill) {
                const avg = stats.avg;
                const display = avg < 60 ? `${Math.round(avg)}s Wait` : `${Math.round(avg / 60)}m Wait`;
                pill.innerHTML = `<i class="fa-solid fa-clock"></i> ${display}`;
            }
        }
    }
}

/* ── WAIT TIMES ────────────────────────────────── */
// Replaced by inline per-station reporting.

async function submitWaitTime() {
    if (!currentUser) return toast('Log in to report wait times!');
    const loc = document.getElementById('locationSelect').value;
    if (!loc) return toast('Select a location first');

    const slider = document.getElementById('waitTimeSlider');
    const mins = parseInt(slider.value);

    try {
        const res = await authFetch(`${API}/api/locations/${loc}/wait-time`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ waitSeconds: mins * 60 })
        });
        if (res.ok) {
            toast('Wait time reported! Thank you.');
            // reload the wait time to show our update
            const data = await res.json();
            updateWaitDisplay(loc, data);
        }
    } catch (e) {
        console.error(e);
        toast('Failed to report wait time.');
    }
}

async function updateWaitDisplay(slug, stats) {
    const el = document.getElementById('waitTimeBadge');
    if (!el) return;

    if (stats && stats.count > 0) {
        const mins = Math.round(stats.avg / 60);
        el.textContent = `${mins} min wait`;
        el.className = 'wait-badge ' + (mins > 10 ? 'slow' : (mins > 5 ? 'medium' : 'fast'));
        el.style.display = 'inline-block';
    } else {
        el.style.display = 'none';
    }
}

async function forceRescrape() {
    const sel = document.getElementById('locationSelect');
    if (!sel.value) return;
    const locData = JSON.parse(sel.value);
    const date = document.getElementById('dateInput').value || todayStr();

    showLoading(true);
    toast('Triggering fresh menu fetch...');

    const res = await fetch(`${API}/api/menu?locationSlug=${encodeURIComponent(locData.slug)}&periodSlug=${encodeURIComponent(activePeriodSlug)}&date=${date}&refresh=true`);
    const data = await res.json();

    if (data.status === 'ready') {
        showLoading(false);
        renderMenu(data.stations, locData.name, activePeriodSlug, date);
    } else if (data.status === 'scraping') {
        showLoading(false);
        renderScraping(data.step);
        pollScrape(locData.slug, date);
    } else if (data.status === 'failed') {
        showLoading(false);
        renderError(data.error || 'Scrape failed');
    }
}
/* ── WEIGHT ACCOUNTABILITY ────────────────────────── */

async function updateWeightProjection() {
    if (!currentUser) return;

    const habitPeriod = document.getElementById('habitPeriod')?.value || 'today';
    const projectionDays = parseInt(document.getElementById('projectionPeriod')?.value || '30');

    let startD = new Date();
    let endD = new Date();

    if (habitPeriod === 'today') {
        startD = new Date();
    } else if (habitPeriod === 'week') {
        startD.setDate(endD.getDate() - 7);
    } else if (habitPeriod === '2weeks') {
        startD.setDate(endD.getDate() - 14);
    } else if (habitPeriod === 'month') {
        startD.setMonth(endD.getMonth() - 1);
    } else if (habitPeriod === 'year') {
        startD.setFullYear(endD.getFullYear() - 1);
    }

    const startStr = formatDate(startD);
    const endStr = formatDate(endD);

    try {
        const res = await authFetch(`${API}/api/user/logs-range?start=${startStr}&end=${endStr}`);
        const data = await res.json();
        const logs = data.logs || [];

        const weightResultEl = document.getElementById('weightResult');
        const weightDeltaEl = document.getElementById('weightDelta');
        const weightStatsEl = document.getElementById('projectionStats');

        if (logs.length === 0) {
            if (weightResultEl) weightResultEl.textContent = "-- lbs";
            if (weightDeltaEl) weightDeltaEl.textContent = "Log a meal to see projection";
            if (weightStatsEl) weightStatsEl.innerHTML = '<p style="color:var(--text-3); font-size:0.8rem">Waiting for habits...</p>';
            return;
        }

        // Calculate average only based on days that actually have data
        // We split by 'T' to discard any time component, ensuring we only count distinct calendar days
        const uniqueDates = new Set(logs.map(l => l.date.split('T')[0]));
        const daysWithLogs = Math.max(1, uniqueDates.size);

        const totalCals = logs.reduce((acc, l) => acc + (l.calories || 0), 0);
        const totalProt = logs.reduce((acc, l) => acc + (l.protein || 0), 0);
        const totalFat = logs.reduce((acc, l) => acc + (l.fat || 0), 0);
        const totalCarb = logs.reduce((acc, l) => acc + (l.carbs || 0), 0);

        const dailyCals = totalCals / daysWithLogs;
        const dailyProt = totalProt / daysWithLogs;
        const dailyFat = totalFat / daysWithLogs;
        const dailyCarb = totalCarb / daysWithLogs;

        // Update Stat Display
        const statsEl = document.getElementById('projectionStats');
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="p-stat"><strong>${Math.round(dailyCals)}</strong><br/>cals</div>
                <div class="p-stat"><strong>${Math.round(dailyProt)}</strong>g<br/>prot</div>
                <div class="p-stat"><strong>${Math.round(dailyFat)}</strong>g<br/>fat</div>
                <div class="p-stat"><strong>${Math.round(dailyCarb)}</strong>g<br/>carb</div>
            `;
        }

        // TDEE estimate (use goal as fallback or formula)
        let tdee = currentUser.calorie_goal || 2000;
        if (currentUser.weight && currentUser.height) {
            const wKg = currentUser.weight * 0.453592;
            const hCm = currentUser.height * 2.54;
            const age = 20; // Default
            const bmr = (10 * wKg) + (6.25 * hCm) - (5 * age) + 5;
            tdee = Math.round(bmr * 1.4);
        }

        const surplus = dailyCals - tdee;
        const totalSurplus = surplus * projectionDays;
        const weightChange = totalSurplus / 3500;

        const resultEl = document.getElementById('weightResult');
        const deltaEl = document.getElementById('weightDelta');

        if (resultEl && deltaEl) {
            const prefix = weightChange >= 0 ? '+' : '';
            const deltaStr = `${prefix}${weightChange.toFixed(1)} lbs`;

            if (currentUser.weight) {
                const projectedWeight = parseFloat(currentUser.weight) + weightChange;
                resultEl.textContent = `${projectedWeight.toFixed(1)} lbs`;
                deltaEl.textContent = `(${deltaStr})`;
                deltaEl.style.color = weightChange > 0 ? '#ef4444' : '#22c55e';
            } else {
                resultEl.textContent = deltaStr;
                deltaEl.textContent = 'Based on your habits';
                resultEl.style.color = weightChange > 0 ? '#ef4444' : '#22c55e';
            }
        }
    } catch (e) {
        console.error('Failed to update weight projection', e);
    }
}


function clearMealSelection() {
    selectedLoggedMeals = [];
    refreshDashboard();
    toast('Selection cleared');
}

// ── LEADERBOARD ─────────────────────────────
let leaderboardDebounce = null;
async function fetchLeaderboard(query = null) {
    const inputEl = document.getElementById('leaderboardSearchInput');
    const contentEl = document.getElementById('leaderboardContent');
    if (!inputEl || !contentEl) return;
    
    // Ensure query is a string before using it, otherwise fallback to input
    const targetQuery = (typeof query === 'string' && query.trim() !== '') ? query.trim() : inputEl.value.trim();

    if (!targetQuery) {
        contentEl.innerHTML = '<div class="empty-state">Type a food item to see the leaderboard!</div>';
        return;
    }

    try {
        contentEl.innerHTML = '<div class="spinner"></div><p style="text-align:center; font-weight:bold;">Pulling latest records...</p>';
        const res = await authFetch(`${API}/api/leaderboard?item=${encodeURIComponent(targetQuery)}`);
        const data = await res.json();
        
        let headerHtml = `<h3 style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; font-weight: 800; text-transform: uppercase;">Tracking: "${targetQuery}"</h3>`;

        if (!data.leaderboard || data.leaderboard.length === 0) {
            contentEl.innerHTML = headerHtml + `<div class="empty-state">No one has logged "${targetQuery}" yet. Be the first!</div>`;
            return;
        }

        let html = headerHtml;
        let top3 = data.leaderboard.slice(0, 3);
        let rest = data.leaderboard.slice(3);

        if (top3.length > 0) {
            html += `<div class="podium-container" style="display: flex; justify-content: center; align-items: stretch; gap: 8px; margin-bottom: 30px; margin-top: 20px; border-bottom: 2px solid #000; padding-bottom: 15px;">`;
            
            const podiumOrder = [];
            if (top3.length === 1) {
                podiumOrder.push({ user: top3[0], rank: 1, height: '160px', bg: 'var(--primary)', color: '#fff' });
            } else if (top3.length === 2) {
                podiumOrder.push({ user: top3[1], rank: 2, height: '120px', bg: '#e5e5e5', color: '#000' });
                podiumOrder.push({ user: top3[0], rank: 1, height: '160px', bg: 'var(--primary)', color: '#fff' });
            } else {
                podiumOrder.push({ user: top3[1], rank: 2, height: '120px', bg: '#e5e5e5', color: '#000' });
                podiumOrder.push({ user: top3[0], rank: 1, height: '160px', bg: 'var(--primary)', color: '#fff' });
                podiumOrder.push({ user: top3[2], rank: 3, height: '80px', bg: '#dfdfdf', color: '#000' });
            }

            podiumOrder.forEach(item => {
                html += `
                <div style="display: flex; flex-direction: column; width: 120px;">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; flex: 1;">
                        <div style="position: relative; margin-bottom: 8px;">
                            ${item.rank === 1 ? '<div style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 1.5rem;">👑</div>' : ''}
                            <img src="${item.user.picture || 'assets/default-avatar.png'}" style="width: 55px; height: 55px; border-radius: 50%; border: 2px solid #000; background: #fff; object-fit: cover;" onerror="this.src='https://ui-avatars.com/api/?name='+encodeURIComponent('${item.user.name}')"/>
                        </div>
                        <div style="width: 100%; height: ${item.height}; background: ${item.bg}; color: ${item.color}; border: 2px solid #000; display: flex; justify-content: center; align-items: flex-start; padding-top: 10px;">
                            <span style="font-size: 1.5rem; font-weight: 800;">${item.rank}</span>
                        </div>
                    </div>
                    <div style="margin-top: 10px; text-align: center;">
                        <div style="font-size: 0.85rem; font-weight: 800; text-transform: uppercase; line-height: 1.2;">${item.user.name}</div>
                        <div style="font-size: 0.75rem; font-weight: bold; color: var(--primary); margin-top: 4px;">${item.user.count} LOGS</div>
                    </div>
                </div>
                `;
            });
            html += `</div>`;
        }

        if (rest.length > 0) {
            html += `<div class="leaderboard-list">`;
            rest.forEach((user, idx) => {
                const rank = idx + 4;
                html += `
                    <div class="leaderboard-row" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px dashed #000;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div style="font-size: 1.2rem; font-weight: 800; width: 30px;">#${rank}</div>
                            <img src="${user.picture || 'assets/default-avatar.png'}" style="width: 40px; height: 40px; border-radius: 50%; border: 1px solid #000; object-fit: cover;" onerror="this.src='https://ui-avatars.com/api/?name='+encodeURIComponent('${user.name}')"/>
                            <div style="font-weight: 700; font-size: 1rem; text-transform: uppercase;">${user.name}</div>
                        </div>
                        <div style="font-weight: 800; font-size: 1.1rem;">
                            ${user.count} <span style="font-size: 0.7rem; font-weight: normal; font-style: italic;">LOGS</span>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        }
        
        contentEl.innerHTML = html;
    } catch (e) {
        console.error('Leaderboard error', e);
        contentEl.innerHTML = '<div class="empty-state text-red">Failed to load leaderboard.</div>';
    }
}

let mealsCollapsed = false;

function toggleMealsCollapse() {
    mealsCollapsed = !mealsCollapsed;
    const wrapper = document.getElementById('todayMealsListWrapper');
    const icon = document.getElementById('mealsCollapseIcon');
    if (wrapper) {
        if (mealsCollapsed) {
            wrapper.style.maxHeight = '0px';
            wrapper.style.opacity = '0';
            if(icon) icon.style.transform = 'rotate(180deg)';
        } else {
            wrapper.style.maxHeight = '5000px';
            wrapper.style.opacity = '1';
            if(icon) icon.style.transform = 'rotate(0deg)';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('leaderboardSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(leaderboardDebounce);
            leaderboardDebounce = setTimeout(() => {
                fetchLeaderboard(e.target.value);
            }, 500);
        });
    }
});

// ── EXTERNAL CALORIES GAP FILLER ───────────
async function addExternalCalories() {
    const input = document.getElementById('gapCaloriesInput');
    if (!input) return;
    const calories = parseInt(input.value);
    
    if (isNaN(calories) || calories <= 0) {
        toast('Please enter a valid number of calories.');
        return;
    }
    
    const itemToLog = {
        name: 'Filled calorie gap',
        calories: calories,
        portion: '1 Custom',
        protein: 0,
        fat: 0,
        carbs: 0
    };
    
    const date = trackingDate || todayStr();
    
    const success = await addLogEntry(date, 'snack', [itemToLog]);
    
    if (success) {
        input.value = '';
        toast(`Added ${calories} external calories!`);
        // Refresh the dashboard to show new calorie total
        refreshDashboard();
    } else {
        toast('Failed to add external calories.');
    }
}
