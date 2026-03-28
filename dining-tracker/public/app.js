/* ════════════════════════════════════════════
   Aggie Dining Tracker — Frontend App (Authenticated)
   ════════════════════════════════════════════ */

const API = '';
let currentUser = null;
let selectedItems = [];
let activePeriodSlug = getCurrentPeriodSlug();
let activePeriodId = '';
let pollTimer = null;
let ringChart = null;
let weekChart = null;

// ── Token Storage ─────────────────────────────
function getToken() { return localStorage.getItem('auth_token'); }
function setToken(t) { localStorage.setItem('auth_token', t); }
function clearToken() { localStorage.removeItem('auth_token'); }

// authFetch: wraps fetch() with Authorization header automatically
async function authFetch(url, opts = {}) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...opts, headers });
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
    const totalCal = items.reduce((s, i) => s + (i.calories || 0), 0);
    for (const item of items) {
        await authFetch(`${API}/api/user/logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, mealType, item })
        });
    }
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
}

// ── Dashboard ─────────────────────────────

async function refreshDashboard() {
    if (!currentUser) return;

    const date = todayStr();
    const todayLogs = await fetchLogs(date);
    const totals = todayLogs.reduce((acc, l) => {
        acc.cal += (l.calories || 0);
        acc.p += (l.protein || 0);
        acc.f += (l.fat || 0);
        acc.c += (l.carbs || 0);
        return acc;
    }, { cal: 0, p: 0, f: 0, c: 0 });

    const goal = currentUser.calorie_goal || 2000;
    const remaining = Math.max(0, goal - totals.cal);

    document.getElementById('ringCurrent').textContent = totals.cal.toLocaleString();
    document.getElementById('ringGoal').textContent = goal.toLocaleString();
    document.getElementById('ringRemaining').textContent = remaining > 0
        ? `${remaining.toLocaleString()} remaining`
        : `${(totals.cal - goal).toLocaleString()} over goal`;

    document.getElementById('macroProtein').textContent = `${totals.p}g`;
    document.getElementById('macroFat').textContent = `${totals.f}g`;
    document.getElementById('macroCarbs').textContent = `${totals.c}g`;

    document.getElementById('todayDateLabel').textContent =
        new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    // Group logs by meal_type for display
    const grouped = {};
    todayLogs.forEach(l => {
        if (!grouped[l.meal_type]) grouped[l.meal_type] = { type: l.meal_type, cals: 0, protein: 0, fat: 0, carbs: 0, items: [], id: l.id };
        grouped[l.meal_type].cals += l.calories;
        grouped[l.meal_type].protein += (l.protein || 0);
        grouped[l.meal_type].fat += (l.fat || 0);
        grouped[l.meal_type].carbs += (l.carbs || 0);
        grouped[l.meal_type].items.push(l.item_name);
    });

    document.getElementById('statMeals').textContent = Object.keys(grouped).length;

    // Simplified streak (just check last few days)
    document.getElementById('statStreak').textContent = "?"; // Could fetch more history here

    drawRing(totals.cal, goal);
    renderTodayMeals(Object.values(grouped));
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
    const el = document.getElementById('todayMealsList');
    if (!el) return;
    if (!meals.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">🥗</div><p>No meals logged today.</p><button class="btn btn-primary" onclick="showPage('menu')">Browse Menu</button></div>`;
        return;
    }
    el.innerHTML = meals.map(m => `
    <div class="meal-entry">
      <div class="meal-entry-header">
        <div class="meal-entry-left">
          <div class="meal-entry-name">${m.type.charAt(0).toUpperCase() + m.type.slice(1)}</div>
          <div class="meal-entry-meta">${m.items.join(', ')}</div>
          <div class="meal-entry-macros">
            ${m.protein}g P · ${m.fat}g F · ${m.carbs}g C
          </div>
        </div>
        <div class="meal-entry-right">
          <div class="meal-cal-badge">${m.cals} cal</div>
          <button class="meal-delete-btn" onclick="removeMeal('${m.id}')">🗑</button>
        </div>
      </div>
    </div>
  `).join('');
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

    dateInp.min = minDate.toISOString().split('T')[0];
    dateInp.max = maxDate.toISOString().split('T')[0];

    if (!dateInp.value) dateInp.value = todayStr();
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
        renderMenu(data.stations, locData.name, activePeriodSlug, date);
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

function renderMenu(stations, locName, period, date) {
    selectedItems = [];
    updateLogBar();
    const mc = document.getElementById('menuContent');

    if (!stations || stations.length === 0) {
        const isFuture = new Date(date) > new Date();
        mc.innerHTML = `
            <h3>${locName} - ${period}</h3>
            <div class="empty-state card glass shadow-lg" style="padding: 60px 20px; border-radius: 20px;">
                <div class="empty-icon" style="font-size: 4rem; margin-bottom: 20px;">${isFuture ? '📅' : '🌙'}</div>
                <p style="font-size: 1.2rem; margin-bottom: 8px;"><strong>${isFuture ? 'Menu not yet published' : 'Location is closed'}</strong></p>
                <p class="form-hint" style="max-width: 300px; margin: 0 auto;">${isFuture ? 'Dining halls usually publish menus 1 week in advance. Check back soon!' : 'This location may be closed for the selected meal period or date.'}</p>
                <button class="btn btn-ghost" style="margin-top: 24px;" onclick="showPage('dashboard')">Back to Dashboard</button>
            </div>
        `;
        return;
    }

    mc.innerHTML = `<h3>${locName} - ${period}</h3>` + stations.map(s => `
        <div class="station-block">
            <div class="station-name">${s.name}</div>
            <div class="item-grid">
                ${s.items.map(item => {
        const isSelected = selectedItems.find(i => i.name === item.name);
        const servings = isSelected ? isSelected.servings : 1;
        return `
                    <div class="menu-item ${isSelected ? 'selected' : ''}" id="item-${item.name.replace(/\s+/g, '-')}" onclick="toggleItem(this, ${JSON.stringify(item).replace(/"/g, '&quot;')})">
                        <div class="item-name">${item.name}</div>
                        <div class="item-cal">${item.calories} cal</div>
                        <div class="item-macros-preview">
                            <span class="item-macro">P <strong>${item.protein || 0}g</strong></span>
                            <span class="item-macro">F <strong>${item.fat || 0}g</strong></span>
                            <span class="item-macro">C <strong>${item.carbs || 0}g</strong></span>
                        </div>
                        <div class="item-serving-controls" onclick="event.stopPropagation()">
                            <button class="step-btn" onclick="changeServings('${item.name.replace(/'/g, "\\'")}', -0.5)">−</button>
                            <span class="serving-val">${servings}</span>
                            <button class="step-btn" onclick="changeServings('${item.name.replace(/'/g, "\\'")}', 0.5)">+</button>
                        </div>
                    </div>
                `}).join('')}
            </div>
        </div>
    `).join('');
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

function changeServings(name, delta) {
    const idx = selectedItems.findIndex(i => i.name === name);
    if (idx < 0) return; // Item not selected

    selectedItems[idx].servings = Math.max(0.5, selectedItems[idx].servings + delta);

    // Update UI for the specific item
    const itemEl = document.getElementById(`item-${name.replace(/\s+/g, '-')}`);
    if (itemEl) {
        const valEl = itemEl.querySelector('.serving-val');
        if (valEl) valEl.textContent = selectedItems[idx].servings;
    }

    updateLogBar();
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
    document.getElementById('logModalBackdrop').classList.add('open');
}

function closeLogModal() {
    document.getElementById('logModalBackdrop').classList.remove('open');
}

async function confirmLog() {
    const date = todayStr();
    // Multiply by servings before sending to legacy API or update API to handle servings
    const itemsToLog = selectedItems.map(i => ({
        ...i,
        name: i.servings !== 1 ? `${i.name} (${i.servings} servings)` : i.name,
        calories: Math.round((i.calories || 0) * i.servings),
        protein: Math.round((i.protein || 0) * i.servings),
        fat: Math.round((i.fat || 0) * i.servings),
        carbs: Math.round((i.carbs || 0) * i.servings)
    }));

    for (const item of itemsToLog) {
        await addLogEntry(date, activePeriodSlug, [item]);
    }

    closeLogModal();
    selectedItems = [];
    updateLogBar();
    showPage('dashboard');
    toast('Meal logged!');
}

function showLoading(show) { document.getElementById('menuLoading').style.display = show ? 'block' : 'none'; }
function renderScraping(step) {
    document.getElementById('menuContent').innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p class="loading-title">Extracting nutritional data...</p>
            <div class="scraping-step" style="background: rgba(80,0,0,0.05); padding: 10px 20px; border-radius: 8px; margin-top: 10px;">
                <span style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-3); display: block; margin-bottom: 4px;">Current Step</span>
                <strong style="color: var(--maroon);">${step || 'Initializing...'}</strong>
            </div>
        </div>
    `;
}

function renderUnsupported(locName, period) {
    const mc = document.getElementById('menuContent');
    mc.innerHTML = `
        <h3>${locName} - ${period}</h3>
        <div class="empty-state">
            <div class="empty-icon">📍</div>
            <p><strong>Menu not yet supported for this location.</strong></p>
            <p class="form-hint">Retail locations like Chick-Fil-A or Panda Express don't publish their live daily menus in a standard format.</p>
        </div>
    `;
}

function renderError(msg) {
    const mc = document.getElementById('menuContent');
    mc.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">⚠️</div>
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

function todayStr() { return new Date().toISOString().split('T')[0]; }

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

document.addEventListener('DOMContentLoaded', checkAuth);
window.onclick = (e) => { if (!e.target.closest('.user-profile')) document.getElementById('userDropdown').classList.remove('active'); };
