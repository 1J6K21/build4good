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
let futureChartInstance = null;
let servingIncrement = 0.5;
let trackingDate = null; // Will be initialized by todayStr() later
let spotlightActive = false;
let currentDayTotals = { cal: 0, p: 0, f: 0, c: 0, sodium: 0, fiber: 0, sugar: 0 };

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
    updateCalorieDebtWidget();
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

    if (name === 'other-food') {
        // Clear previous results when entering page
        document.getElementById('globalSearchResults').innerHTML = '';
        document.getElementById('globalSearchInput').value = '';
    }
    if (name === 'dashboard') refreshDashboard();
    if (name === 'menu') initMenuPage();
    if (name === 'leaderboard') {
        fetchTopLeaderboard();
        fetchLeaderboard();
    }
    // Toggle Station Navigation Controls
    const navControls = document.getElementById('stationNavControls');
    if (navControls) {
        // Only show if we're on the menu page AND there are stations to navigate
        const stations = document.querySelectorAll('.station-block');
        navControls.style.display = (name === 'menu' && stations.length > 0) ? 'flex' : 'none';
    }
}

// ── GLOBAL FOOD SEARCH (USDA API) ─────────────────────────

let globalSearchTimeout = null;

function onGlobalSearchInput() {
    clearTimeout(globalSearchTimeout);
    const query = document.getElementById('globalSearchInput').value.trim();
    if (query.length < 2) {
        document.getElementById('globalSearchResults').innerHTML = '';
        return;
    }
    globalSearchTimeout = setTimeout(() => {
        searchGlobalFood();
    }, 400); // 400ms debounce
}

async function searchGlobalFood() {
    const input = document.getElementById('globalSearchInput');
    const query = input.value.trim();
    if (!query) return;

    const resultsEl = document.getElementById('globalSearchResults');
    const loadingEl = document.getElementById('globalSearchLoading');

    // Only show loading if we don't have many results yet
    if (resultsEl.children.length === 0) {
        resultsEl.innerHTML = '';
        loadingEl.style.display = 'block';
    }

    try {
        const res = await authFetch(`${API}/api/external/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        loadingEl.style.display = 'none';

        if (data.error || !data.foods) {
            resultsEl.innerHTML = `<div class="empty-state"><p>${data.error || 'Connection failed. Check your API key.'}</p></div>`;
            return;
        }

        if (data.foods.length === 0 && query.length > 2) {
            resultsEl.innerHTML = '<div class="empty-state"><p>No results found. Try a broader search.</p></div>';
            return;
        }

        // Update autocomplete datalist
        const datalist = document.getElementById('globalFoodOptions');
        if (datalist) {
            datalist.innerHTML = data.foods.slice(0, 10).map(f => `<option value="${f.description}">`).join('');
        }

        resultsEl.innerHTML = data.foods.map(f => {
            const kcal = f.foodNutrients.find(n => n.nutrientId === 1008 || n.unitName === 'KCAL')?.value || 0;
            const pro = f.foodNutrients.find(n => n.nutrientId === 1003)?.value || 0;
            const fat = f.foodNutrients.find(n => n.nutrientId === 1004)?.value || 0;
            const carb = f.foodNutrients.find(n => n.nutrientId === 1005)?.value || 0;
            
            // Calculate grade for search result
            const { grade, flags } = calculateMealGrade({
                name: f.description,
                calories: kcal,
                protein: pro,
                fat: fat,
                carbs: carb,
                fiber: f.foodNutrients.find(n => n.nutrientId === 1079 || n.nutrientId === 1082 || n.nutrientId === 1084)?.value || 0,
                sugars: f.foodNutrients.find(n => n.nutrientId === 2000 || n.nutrientId === 2001)?.value || 0,
                saturated_fat: f.foodNutrients.find(n => n.nutrientId === 1258)?.value || (fat * 0.3)
            });

            const flagsHtml = (flags || []).map(fl => `
                <div class="grade-reason-badge type-${fl.type}" 
                     onclick="event.stopPropagation(); showNutritionalInsight('${fl.text}', '${(fl.reason || '').replace(/'/g, "\\'")}')"
                     style="font-size: 0.65rem; padding: 3px 10px; cursor: help;">
                    <i class="fa-solid ${fl.icon}"></i> ${fl.text}
                    <i class="fa-solid fa-circle-info" style="margin-left: 4px; opacity: 0.7;"></i>
                </div>
            `).join('');

            return `
            <div class="card result-item" onclick="logGlobalItemByFdcId(${f.fdcId}, '${f.description.replace(/'/g, "\\'")}')" style="cursor: pointer; padding: 15px; display: flex; flex-direction: column; gap: 10px; transition: transform 0.1s;">
               <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="font-weight: 800; font-size: 0.95rem; color: var(--text-1);">${f.description}</div>
                            <div class="item-gpa-badge grade-${grade[0]}">${grade}</div>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-3); text-transform: uppercase; margin-bottom: 8px;">${f.brandName || f.dataType || 'Common Food'}</div>
                        <div style="display: flex; gap: 12px; font-size: 0.75rem; font-weight: 700; color: var(--text-2);">
                            <span><strong style="color:var(--primary)">${Math.round(pro)}g</strong> P</span>
                            <span><strong style="color:var(--primary)">${Math.round(carb)}g</strong> C</span>
                            <span><strong style="color:var(--primary)">${Math.round(fat)}g</strong> F</span>
                        </div>
                    </div>
                    <div style="text-align: right; border-left: 1px solid var(--border); padding-left: 15px; margin-left: 15px;">
                        <div style="font-weight: 900; color: var(--primary); font-size: 1.4rem; line-height: 1;">${Math.round(kcal)}</div>
                        <div style="font-size: 0.6rem; color: var(--text-3); font-weight: 800; letter-spacing: 0.05em;">CALORIES</div>
                    </div>
               </div>
               <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${flagsHtml}
               </div>
            </div>
        `}).join('');
    } catch (e) {
        loadingEl.style.display = 'none';
        toast('Search failed. Check connection.');
    }
}

async function logGlobalItemByFdcId(fdcId, fName) {
    toast(`Fetching details: ${fName}...`);
    try {
        const res = await authFetch(`/api/external/food/${fdcId}`);
        const data = await res.json();
        
        // Map FDC nutrients
        const getVal = (id) => {
            const n = data.foodNutrients.find(x => x.nutrient.id === id);
            return n ? n.amount : 0;
        };

        const item = {
            name: data.description,
            calories: Math.round(getVal(1008) || getVal(1062)),
            protein: Math.round(getVal(1003)),
            fat: Math.round(getVal(1004)),
            carbs: Math.round(getVal(1005)),
            sodium: Math.round(getVal(1093)),
            fiber: Math.round(getVal(1079)),
            sugars: Math.round(getVal(1011) || getVal(2000)),
            saturated_fat: Math.round(getVal(1258)),
            trans_fat: Math.round(getVal(1257)),
            cholesterol: Math.round(getVal(1253)),
            serving_size: 1.0,
            servings: 1.0,
            portion: 1.0
        };

        // Inject into global selectedItems and open log modal
        selectedItems = [item];
        openLogModal();
    } catch (e) {
        toast('Detail fetch failed.');
    }
}

// ── Dashboard ─────────────────────────────

async function updateCalorieDebtWidget() {
    const el = document.getElementById('calorieDebtWidget');
    if (!el) return;

    try {
        const res = await authFetch(`${API}/api/user/calorie-debt`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.daysTracked < 3) {
            el.innerHTML = `
                <div class="debt-lbs" style="color: var(--text-3)">Calculating...</div>
                <div class="debt-since">New User</div>
            `;
            el.setAttribute('data-tooltip', 'Logging 3 or more days reveals your semester trajectory.');
            return;
        }

        const sign = data.direction === 'surplus' ? '+' : '−';
        const colorClass = data.direction === 'surplus' ? 'surplus' : 'deficit';
        const impact = data.lbsImpact.toFixed(1);
        
        let sinceStr = 'SINCE ???';
        if (data.since) {
            const d = new Date(data.since + 'T12:00:00');
            const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
            const day = d.getDate();
            sinceStr = `SINCE ${month} ${day}`;
        }

        el.innerHTML = `
            <div class="debt-lbs ${colorClass}">${sign}${impact} lbs</div>
            <div class="debt-since">${sinceStr}</div>
        `;

        const absCal = Math.abs(data.totalDebtCal).toLocaleString();
        const overUnder = data.direction === 'surplus' ? 'above' : 'below';
        const summary = `${sign}${absCal} cal ${overUnder} goal since your first log. That's roughly ${impact} lbs from dining alone.`;
        el.setAttribute('data-tooltip', summary);

    } catch (e) {
        console.error('Failed to update calorie debt widget', e);
    }
}

async function refreshDashboard() {
    if (!currentUser) return;
    
    // Clear selections on refresh to avoid stale IDs
    selectedLoggedMeals = [];
    updateBulkActions();

    const date = trackingDate || todayStr();
    const logs = await fetchLogs(date);
    
    // Fetch 30-day history for a dynamic "Semester GPA" calculation
    const monthStart = new Date(new Date(date + 'T12:00:00').getTime() - (29 * 24 * 60 * 60 * 1000));
    const rangeRes = await authFetch(`${API}/api/user/logs-range?start=${formatDate(monthStart)}&end=${date}`);
    const rangeData = await rangeRes.json();
    const historicalLogs = rangeData.logs || [];

    currentDayTotals = (logs || []).reduce((acc, l) => {
        acc.cal += (l.calories || 0);
        acc.p += (l.protein || 0);
        acc.f += (l.fat || 0);
        acc.c += (l.carbs || 0);
        acc.sodium += (l.sodium || 0);
        acc.fiber += (l.fiber || 0);
        acc.sugar += (l.sugars || 0);
        return acc;
    }, { cal: 0, p: 0, f: 0, c: 0, sodium: 0, fiber: 0, sugar: 0 });
    const totals = currentDayTotals;

    const calGoal = currentUser.calorie_goal || 2000;
    const proGoal = currentUser.protein_goal;
    const fatGoal = currentUser.fat_goal;
    const carbGoal = currentUser.carb_goal;

    const remainingCal = Math.max(0, calGoal - totals.cal);

    if (document.getElementById('ringCurrent')) document.getElementById('ringCurrent').textContent = Math.round(totals.cal).toLocaleString();
    if (document.getElementById('ringGoal')) document.getElementById('ringGoal').textContent = calGoal.toLocaleString();
    if (document.getElementById('ringRemaining')) {
        document.getElementById('ringRemaining').textContent = remainingCal > 0
            ? `${remainingCal.toLocaleString()} remaining`
            : `${Math.abs(totals.cal - calGoal).toLocaleString()} over goal`;
    }

    if (document.getElementById('statMeals')) document.getElementById('statMeals').textContent = logs.length;
    
    // Streak counter logic
    calculateStreak();

    // Macro Grid Update
    if (!proGoal) {
        if (document.getElementById('proteinMainDisplay')) {
            document.getElementById('proteinMainDisplay').innerHTML = `<span id="totalProtein">${Math.round(totals.p)}</span>g <button class="btn btn-sm btn-ghost" style="padding: 2px 5px; font-size:0.6rem; margin-left:5px" onclick="openGoalsModal()">Set Goal &rarr;</button>`;
        }
        updateMacroRing('proteinRing', 'proteinPctText', totals.p, 1);
    } else {
        if (document.getElementById('proteinMainDisplay')) {
            document.getElementById('proteinMainDisplay').innerHTML = `<span id="totalProtein">${Math.round(totals.p)}</span> / <span id="proteinGoalLabel">${proGoal}</span>g`;
        }
        updateMacroRing('proteinRing', 'proteinPctText', totals.p, proGoal);
    }

    if (!carbGoal) {
        if (document.getElementById('carbsMainDisplay')) {
            document.getElementById('carbsMainDisplay').innerHTML = `<span id="totalCarbs">${Math.round(totals.c)}</span>g <button class="btn btn-sm btn-ghost" style="padding: 2px 5px; font-size:0.6rem; margin-left:5px" onclick="openGoalsModal()">Set Goal &rarr;</button>`;
        }
        updateMacroRing('carbsRing', 'carbsPctText', totals.c, 1);
    } else {
        if (document.getElementById('carbsMainDisplay')) {
            document.getElementById('carbsMainDisplay').innerHTML = `<span id="totalCarbs">${Math.round(totals.c)}</span> / <span id="carbsGoalLabel">${carbGoal}</span>g`;
        }
        updateMacroRing('carbsRing', 'carbsPctText', totals.c, carbGoal);
    }

    if (!fatGoal) {
        if (document.getElementById('fatMainDisplay')) {
            document.getElementById('fatMainDisplay').innerHTML = `<span id="totalFat">${Math.round(totals.f)}</span>g <button class="btn btn-sm btn-ghost" style="padding: 2px 5px; font-size:0.6rem; margin-left:5px" onclick="openGoalsModal()">Set Goal &rarr;</button>`;
        }
        updateMacroRing('fatRing', 'fatPctText', totals.f, 1);
    } else {
        if (document.getElementById('fatMainDisplay')) {
            document.getElementById('fatMainDisplay').innerHTML = `<span id="totalFat">${Math.round(totals.f)}</span> / <span id="fatGoalLabel">${fatGoal}</span>g`;
        }
        updateMacroRing('fatRing', 'fatPctText', totals.f, fatGoal);
    }

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
    try { renderTradeoffTimeline(logs, calGoal); } catch (e) { console.error(e); }
    // Weekly Overview call removed
    try { updateWeightProjection(); } catch (e) { console.error(e); }
    try { updateFutureProjection(); } catch (e) { console.error(e); }
    try { updateInsights(); } catch (e) { console.error(e); }
    try { updateCalorieDebtWidget(); } catch (e) { console.error(e); }

    // Danger Window Banner Integration
    if (sessionStorage.getItem('dangerDismissed_' + date) !== '1') {
        getDangerWindowState(logs, date).then(state => {
            const banner = document.getElementById('dangerWindowBanner');
            const msgEl = document.getElementById('dangerWindowMessage');
            if (state && banner && msgEl) {
                msgEl.textContent = state.message;
                banner.style.display = 'block';
            } else if (banner) {
                banner.style.display = 'none';
            }
        });
    } else {
        const banner = document.getElementById('dangerWindowBanner');
        if (banner) banner.style.display = 'none';
    }

    try { generateBulletin(logs, totals, calGoal); } catch (e) { console.error(e); }
    try { updateHealthGPA(logs, historicalLogs); } catch (e) { console.error(e); }
}

function updateHealthGPA(todayLogs, historicalLogs) {
    if (!currentUser) return;
    
    document.getElementById('gpaMajorDisplay').textContent = `Major: ${currentUser.major || 'Cutting'}`;
    
    // 1. Calculate TRUE Overall GPA (30-day average)
    let hPoints = 0;
    let hWeight = 0;
    historicalLogs.forEach(l => {
        const { points, isExam } = calculateMealGrade(l, currentUser.major, l.logged_at);
        const w = isExam ? 3 : 1;
        hPoints += (points * w);
        hWeight += w;
    });
    
    const overallGPA = hWeight > 0 ? (hPoints / hWeight) : 4.0;
    document.getElementById('gpaFinal').textContent = overallGPA.toFixed(2);

    if (todayLogs.length === 0) {
        document.getElementById('gradeNutrition').textContent = '—';
        document.getElementById('gradeTiming').textContent = '—';
        document.getElementById('gradeConsistency').textContent = '—';
        document.getElementById('gpaTrend').innerHTML = '<i class="fa-solid fa-graduation-cap"></i> SEMESTER IN PROGRESS';
        return;
    }

    // 2. Calculate Today's GPA
    let tPoints = 0;
    let tWeight = 0;
    let timingPenalty = 0;
    
    todayLogs.forEach(l => {
        const { points, isExam } = calculateMealGrade(l, currentUser.major, l.logged_at);
        const w = isExam ? 3 : 1;
        tPoints += (points * w);
        tWeight += w;
        if (isExam) timingPenalty += 1;
    });

    const sessionAvg = tWeight > 0 ? (tPoints / tWeight) : 4.0;
    const sessionGrade = pointsToGrade(sessionAvg);
    
    document.getElementById('gradeNutrition').textContent = sessionGrade;
    document.getElementById('gradeTiming').textContent = timingPenalty > 1 ? 'D' : (timingPenalty > 0 ? 'B' : 'A');

    // 3. Consistency (Static for now, could be dynamic per day)
    document.getElementById('gradeConsistency').textContent = 'B'; 

    // 4. Trend: Compare Session vs Overall (Dynamic)
    const trendEl = document.getElementById('gpaTrend');
    const diff = sessionAvg - overallGPA;
    
    if (Math.abs(diff) < 0.2) {
        trendEl.innerHTML = '<i class="fa-solid fa-graduation-cap"></i> TODAY: Performance stable';
        trendEl.className = 'gpa-trend';
    } else if (diff > 0) {
        trendEl.innerHTML = '<i class="fa-solid fa-caret-up"></i> TODAY: Session performance high';
        trendEl.className = 'gpa-trend';
    } else {
        trendEl.innerHTML = '<i class="fa-solid fa-caret-down"></i> TODAY: Session below average';
        trendEl.className = 'gpa-trend down';
    }
}

function pointsToGrade(pts) {
    if (pts >= 4.0) return 'A';
    if (pts >= 3.0) return 'B';
    if (pts >= 2.0) return 'C';
    if (pts >= 1.0) return 'D';
    return 'F';
}

function generateBulletin(logs, totals, calGoal) {
    const el = document.getElementById('bulletinText');
    const dateEl = document.getElementById('bulletinDate');
    if (!el) return;

    const d = new Date((trackingDate || todayStr()) + 'T12:00:00');
    if (dateEl) dateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();

    let headline = "THE MINDFUL BULLETIN — CAMPUS TRADING NEWS & MACRO MOVES";
    
    if (logs.length === 0) {
        headline = "THE CALM BEFORE THE CALORIES — FIRST LOG OF THE DAY AWAITS";
    } else {
        const pGoal = (currentUser && currentUser.protein_goal) ? currentUser.protein_goal : 60;
        const pPct = (totals.p / pGoal) * 100;
        const cPct = (totals.cal / calGoal) * 100;

        if (cPct > 100) {
            headline = "BUDGET QUOTAS EXCEEDED — CALORIE CEILING BREACHED BY ACTIVE TRADER";
        } else if (pPct > 80) {
            headline = "PROTEIN POWERHOUSE — CAMPUS USER REACHES ANABOLIC RECOVERY PEAK";
        } else if (cPct > 75) {
            headline = "THE LATE DAY LOG — CAUTION ADVISED AS CALORIE CEILING APPROACHES";
        } else if (logs.length > 3) {
            headline = "CONSISTENCY CLIMB — VOLUME TRADING DETECTED ACROSS FOUR MEALS";
        } else if (totals.p > 30) {
             headline = "THE PROTEIN RALLY — STEADY GAINS REPORTED IN THE MORNING SESSIONS";
        }
    }

    el.textContent = headline;
}

async function calculateStreak() {
    const todayStrVal = trackingDate || todayStr();
    const dObj = new Date(todayStrVal + 'T12:00:00');
    const past = new Date(dObj);
    past.setDate(dObj.getDate() - 90);
    const end = todayStrVal;
    const start = formatDate(past);
    try {
        const res = await authFetch(`${API}/api/user/logs-range?start=${start}&end=${end}`);
        const data = await res.json();
        const logs = data.logs || [];
        
        const datesSet = new Set();
        logs.forEach(l => datesSet.add(l.date));
        
        const sortedDates = Array.from(datesSet).sort();
        if (sortedDates.length === 0) {
            if (document.getElementById('statStreak')) document.getElementById('statStreak').innerHTML = '—';
            return;
        }

        let longest = 0;
        let current = 1;
        for (let i = 1; i < sortedDates.length; i++) {
            const d1 = new Date(sortedDates[i-1] + 'T12:00:00');
            const d2 = new Date(sortedDates[i] + 'T12:00:00');
            const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
                current++;
            } else {
                if (current > longest) longest = current;
                current = 1;
            }
        }
        if (current > longest) longest = current;

        const stEl = document.getElementById('statStreak');
        if (stEl) {
            if (longest > 0) {
                stEl.innerHTML = `🔥 ${longest}`;
                
                // Update Newspaper Clippings for streak
                ['left', 'right'].forEach(side => {
                    const container = document.getElementById(`dynamic-${side}-streak`);
                    const titleEl = document.getElementById(`val-${side}-streak-title`);
                    const descEl = document.getElementById(`val-${side}-streak-desc`);
                    if (container && titleEl && descEl) {
                        titleEl.textContent = `${longest} DAYS STRONG`;
                        descEl.textContent = `You've maintained a consistent logging habit for ${longest} days. ${longest > 5 ? 'A remarkable showcase of discipline.' : 'A great start to your journey!'}`;
                        container.style.display = 'block';
                    }
                });
            } else {
                stEl.innerHTML = `—`;
            }
        }
    } catch(e) {
        console.error('Streak calc fail', e);
    }
}

async function getDangerWindowState(logs, trackingDate) {
    const end = trackingDate || todayStr();
    const startDate = new Date(end + 'T12:00:00');
    startDate.setDate(startDate.getDate() - 28);
    const start = formatDate(startDate);

    try {
        const res = await authFetch(`${API}/api/user/logs-range?start=${start}&end=${end}`);
        const data = await res.json();
        const allLogs = data.logs || [];

        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const currentDayNum = new Date(end + 'T12:00:00').getDay();
        const todayCaloriesSoFar = logs.reduce((sum, l) => sum + (l.calories || 0), 0);

        // Demo fallback if no data yet
        if (allLogs.length === 0) {
            if (days[currentDayNum] === 'Thursday') {
                return {
                    isDangerWindow: true,
                    dangerDayOfWeek: "Thursday",
                    avgCaloriesOnDangerDay: 2710,
                    todayCaloriesSoFar: todayCaloriesSoFar,
                    message: "⚠️ DANGER WINDOW — Thursdays are historically your highest calorie day. Log your meals carefully today."
                };
            }
            return null;
        }

        const dayTotals = {};
        allLogs.forEach(log => {
            const d = new Date(log.date + 'T12:00:00').getDay();
            if (!dayTotals[d]) dayTotals[d] = {};
            if (!dayTotals[d][log.date]) dayTotals[d][log.date] = 0;
            dayTotals[d][log.date] += (log.calories || 0);
        });

        let dangerDayOfWeekNum = -1;
        let maxAvg = -1;
        for (let d = 0; d < 7; d++) {
            if (dayTotals[d]) {
                const values = Object.values(dayTotals[d]);
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                if (avg > maxAvg) {
                    maxAvg = avg;
                    dangerDayOfWeekNum = d;
                }
            }
        }

        if (dangerDayOfWeekNum === currentDayNum) {
            return {
                isDangerWindow: true,
                dangerDayOfWeek: days[dangerDayOfWeekNum],
                avgCaloriesOnDangerDay: Math.round(maxAvg),
                todayCaloriesSoFar: Math.round(todayCaloriesSoFar),
                message: `⚠️ DANGER WINDOW — ${days[dangerDayOfWeekNum]}s avg ${Math.round(maxAvg).toLocaleString()} cal for you. You're at ${Math.round(todayCaloriesSoFar).toLocaleString()} today. Stay on track.`
            };
        }
    } catch (e) {
        console.error("Danger window logic failed", e);
    }
    return null;
}

function dismissDangerBanner() {
    const date = trackingDate || todayStr();
    sessionStorage.setItem('dangerDismissed_' + date, '1');
    const banner = document.getElementById('dangerWindowBanner');
    if (banner) banner.style.display = 'none';
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

// Weekly Overview graph removed.

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
            <div class="meal-entry-meta">${m.item_name}${m.serving_size && m.serving_size !== 1 ? ` (${m.serving_size} serving${m.serving_size !== 1 ? 's' : ''})` : ''}</div>
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
        <div style="display: flex; gap: 12px; align-items: center;">
            <button class="btn spotlight-btn ${spotlightActive ? 'active' : ''}" onclick="toggleSpotlight()" title="Spotlight: What to get">
                <i class="fa-solid fa-wand-magic-sparkles"></i> WHAT TO GET
            </button>
            <button class="btn btn-sm btn-ghost force-refresh-btn" onclick="forceRescrape()" title="Force Refresh Menu" style="opacity: 0.4; border: 1px solid var(--border); border-radius: 50%; width: 36px; height: 36px; padding: 0;">
                <i class="fa-solid fa-rotate-right"></i>
            </button>
        </div>
    </div>
    ` + (spotlightActive ? getSpotlightHtml(visibleStations, waitStats, locSlug) : getStandardMenuHtml(visibleStations, waitStats, locSlug));

    // Show navigation controls if stations are present
    const navControls = document.getElementById('stationNavControls');
    if (navControls) navControls.style.display = 'flex';
}

function toggleSpotlight() {
    spotlightActive = !spotlightActive;
    loadMenu();
    if (spotlightActive) toast("Spotlight active: Highlighting the best options for your goals.");
}

function gradeToPoints(grade) {
    const map = { 'A+': 4.3, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7, 'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D': 1.0, 'F': 0.0 };
    return map[grade] || 0;
}

function calculateMealGrade(item, major, timestamp = Date.now()) {
    const { score, flags } = scoreFoodItem(item); 
    
    // 1. Determine Exam Status
    const hour = new Date(timestamp).getHours();
    const isLateNight = hour >= 21 || hour < 5;
    const isExam = isLateNight; 
    const examType = isLateNight ? 'Late Night Exam' : '';

    // 2. Map Score (Pure Health) to Grade
    let grade = 'C';
    if (score >= 35) grade = 'A+';
    else if (score >= 25) grade = 'A';
    else if (score >= 18) grade = 'A-';
    else if (score >= 12) grade = 'B+';
    else if (score >= 6) grade = 'B';
    else if (score >= 1) grade = 'B-';
    else if (score >= -3) grade = 'C+';
    else if (score >= -8) grade = 'C';
    else if (score >= -15) grade = 'C-';
    else if (score >= -25) grade = 'D';
    else grade = 'F';

    return { grade, isExam, examType, points: gradeToPoints(grade), flags: flags || [] };
}

function scoreFoodItem(item) {
    if (!item) return { score: 0, type: 'neutral', flags: [] };

    // 0. SANITIZE INPUTS (Fixes the rendering crash)
    const name = (item.item_name || item.name || '').toLowerCase();
    const major = (currentUser?.major || 'General Health').toLowerCase();

    // 0. SANITIZE INPUTS & MAJOR-AWARE SCALING
    const pro = parseFloat(item.protein || item.p) || 0;
    const fib = parseFloat(item.fiber || item.fib) || 0;
    const cal = parseFloat(item.calories || item.cal) || 0;
    const fat = parseFloat(item.fat || item.f) || 0;
    const carbs = parseFloat(item.carbs || item.carb || item.c) || 0;
    const sugar = parseFloat(item.sugars || item.sugar || item.sug) || 0;
    const satFat = parseFloat(item.saturated_fat || item.satFat || item.sat) || 0;
    const sodium = parseFloat(item.sodium || item.na) || 0;

    // Bulking Major Buff: High-calorie items are less penalized
    let calWeight = cal < 250 ? 0.12 : 0.45;
    if (major === 'bulking' && cal > 400 && pro > 20) calWeight = 0.18; 
    
    // 1. DATA PREP
    const pDensity = (pro * 4) / Math.max(cal, 1);
    const pPct = (pro * 4) / Math.max(cal, 1); // For checks
    const calDensity = cal / 500; // Relative to a standard meal
    const satFatRatio = satFat / Math.max(fat, 1);
    const sodiumDensity = sodium / Math.max(cal, 1);
    const sugarDensity = (sugar * 4) / Math.max(cal, 1);

    const produceKeywords = ['tomato', 'broccoli', 'spinach', 'kale', 'apple', 'banana', 'orange', 'fruit', 'berry', 'berries', 'carrot', 'cucumber', 'pepper', 'lettuce', 'cabbage', 'vegetable', 'salad', 'onion', 'corn', 'ginger', 'garlic', 'bean', 'brussels', 'sprout', 'hash', 'potato', 'mushroom', 'pepper'];
    const proteinKeywords = ['egg', 'chicken', 'turkey', 'tofu', 'salmon', 'fish', 'beef', 'steak', 'pork', 'sausage', 'omelet', 'poached', 'scrambled'];
    
    const ingredients = (item.ingredients || '').toLowerCase();
    const isProduce = produceKeywords.some(k => name.includes(k)) && cal < 500 && sugar < 25;
    const isWholeProtein = proteinKeywords.some(k => name.includes(k)) && cal < 700;

    // 1.1 DATA-DRIVEN PROCESSING CHECK (The "Ingredient List" Fix)
    let processingPenalty = 0;
    const processTriggers = ['syrup', 'bleached', 'enriched', 'hydrogenated', 'modified', 'carra', 'nitrate', 'isolate', 'refined', 'artificial', 'msg', 'natural flavor', 'gum', 'sucralose', 'aspartame'];
    const hits = processTriggers.filter(t => ingredients.includes(t) || name.includes('sandwich') || name.includes('burger'));
    if (hits.length > 1) {
        processingPenalty = hits.length * 10;
    }

    // 2. THE AGNOSTIC HEALTH FORMULA
    let score = 0;
    let flags = [];

    // A. Anchoring (Produce Protection)
    if (isProduce) {
        score = 25; // Base A
        if (cal < 120) score = 40; // A+ for fillers
        if (cal < 40) flags.push({ text: 'Low Cal Filler', icon: 'fa-leaf', type: 'good' });
    } else {
        // High-Quality Protein base
        score = (pro * 4.5) + (fib * 12);
    }

    // B. The Penalties (Scale per calorie more reasonably)
    score -= (cal * calWeight);
    score -= processingPenalty;
    
    // Sodium & Fat
    score -= (sodium / 25);
    score -= (satFat * (isWholeProtein ? 5 : 22)); // 4x penalty for industrial sat-fat vs natural meat/egg fat

    // C. The Efficiency Buffs (The Egg/Steak Savior)
    // Low-carb protein efficiency is the ultimate metabolic win
    const carbDensity = (carbs * 4) / Math.max(cal, 1);
    if (pDensity > 0.20 && (carbDensity < 0.25 || cal < 250)) {
        score += 35; // Significant boost for metabolic efficiency (Eggs are 0.26 P, <0.1 C)
        flags.push({ text: 'Metabolic Win', icon: 'fa-bolt', type: 'good' });
    }
    if (fib > 3) {
        score += 20; 
        flags.push({ text: 'Fiber Rich', icon: 'fa-shield-heart', type: 'good' });
    }

    // D. Insight Flags (BIO-INHERENT SIGNALING)
    if (hits.length > 1) {
        flags.push({ 
            text: 'Industrial Ingredients', 
            icon: 'fa-industry', 
            type: 'danger',
            reason: `Detected additives: ${hits.join(', ')}.`
        });
    }
    if (sugarDensity > 0.45) {
        score -= 25;
        flags.push({ 
            text: 'Sugar Loaded', 
            icon: 'fa-ice-cream', 
            type: 'danger',
            reason: "Over 45% of calories come from simple sugars, causing high glycemic load." 
        });
    }
    if (satFatRatio > 0.70 && !isWholeProtein) {
         score -= 25;
         flags.push({ 
            text: 'Heavy Saturated Fat', 
            icon: 'fa-bottle-droplet', 
            type: 'warn',
            reason: "Contains a high ratio of saturated lipids common in industrial oils."
         });
    }
    if (flags.find(f => f.text === 'Metabolic Win')) {
        flags.find(f => f.text === 'Metabolic Win').reason = "High protein and low carb density creates a metabolically efficient profile.";
    }
    if (flags.find(f => f.text === 'Low Cal Filler')) {
        flags.find(f => f.text === 'Low Cal Filler').reason = "Extremely low calorie density allows for high volume satiety.";
    }

    // 3. Classification
    let type = 'neutral';
    const isModifier = cal < 100 && pro < 8 && !name.includes('egg');

    if (isModifier) {
        if (score > 10) type = 'modifier-good';
        else if (score < -5) type = 'modifier-bad';
        else type = 'modifier-neutral';
        score = Math.max(-10, Math.min(score, 10)); // Flatten modifiers
    } else {
        if (score >= 12) type = 'meal-top';
        else if (score < -15) type = 'meal-heavy';
    }

    return { score, type, flags };
}

function getSpotlightHtml(stations, waitStats, locSlug) {
    const scoredStations = stations.map(s => {
        const itemsWithScores = s.items.map(item => {
            const { score, type } = scoreFoodItem(item);
            return { ...item, _score: score, _type: type };
        });

        // Station score = weight the substantial meals more than the modifications
        const meals = itemsWithScores.filter(i => i._type.startsWith('meal'));
        const modifiers = itemsWithScores.filter(i => i._type.startsWith('modifier'));
        
        // A station's "Recommendation Level" is driven by its best meal, 
        // but buffered by how many 'bad' modifiers it has.
        let stationScore = meals.length > 0 
            ? Math.max(...meals.map(m => m._score)) 
            : (modifiers.length > 0 ? (modifiers.reduce((sum, i) => sum + i._score, 0) / modifiers.length) : -99);

        return { ...s, items: itemsWithScores, _stationScore: stationScore };
    });

    scoredStations.sort((a, b) => b._stationScore - a._stationScore);

    return scoredStations.map(s => renderStation(s, waitStats, locSlug, true)).join('');
}

function getStandardMenuHtml(stations, waitStats, locSlug) {
    return stations.map(s => renderStation(s, waitStats, locSlug, false)).join('');
}

function renderStation(s, waitStats, locSlug, isSpotlight) {
    const stats = waitStats.find(ws => ws.station_name === s.name);
    let waitDisplay = '-- Wait';
    if (stats) {
        const avg = stats.avg;
        if (avg < 60) waitDisplay = `${Math.round(avg)}s Wait`;
        else waitDisplay = `${Math.round(avg / 60)}m Wait`;
    }

    // Within station, sort items if spotlight is active (except toppings)
    const items = [...s.items];
    if (isSpotlight && !s._isToppingStation) {
        items.sort((a, b) => b._score - a._score);
    }

    return `
    <div class="station-block ${isSpotlight && s._stationScore < -5 && !s._isToppingStation ? 'station-dimmed' : ''}">
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
            ${items.map(item => renderItem(item, isSpotlight)).join('')}
        </div>
    </div>
    `;
}

function renderItem(item, isSpotlight) {
    const isSelected = selectedItems.find(i => i.name === item.name);
    const servings = isSelected ? isSelected.servings : 1;
    
    let spotlightClass = '';
    let spotlightBadge = '';
    
    // Calculate grade for display
    const { grade, isExam } = calculateMealGrade(item, (currentUser ? currentUser.major : 'Cutting'));

    if (isSpotlight) {
        if (item._type === 'meal-top') {
            spotlightClass = 'spotlight-highlight';
            spotlightBadge = '<div class="spotlight-badge recommend"><i class="fa-solid fa-star"></i> TOP PICK</div>';
        } else if (item._type === 'modifier-good') {
            spotlightClass = 'spotlight-modifier';
            spotlightBadge = '<div class="spotlight-badge modifier"><i class="fa-solid fa-plus"></i> GOOD ADD-ON</div>';
        } else if (item._type === 'meal-heavy') {
            spotlightClass = 'spotlight-dim';
            spotlightBadge = '<div class="spotlight-badge heavy"><i class="fa-solid fa-weight-hanging"></i> HEAVY</div>';
        } else if (item._type === 'modifier-bad') {
             spotlightClass = 'spotlight-dim-soft';
        }
    }

    return `
    <div class="menu-item ${isSelected ? 'selected' : ''} ${spotlightClass}" id="item-${item.name.replace(/\s+/g, '-')}" onclick="toggleItem(this, ${JSON.stringify(item).replace(/"/g, '&quot;')})">
        ${spotlightBadge}
        <div style="display: flex; align-items: flex-start; gap: 10px;">
            <div class="item-name">${item.name}</div>
            <div class="item-gpa-badge grade-${grade[0]}">${grade}</div>
        </div>
        <div class="item-badges">
            ${(item.badges || []).map(b => `<span class="badge badge-${b}">${b}</span>`).join('')}
        </div>
        <div class="item-cal">${item.calories} cal</div>
        <div class="item-macros-preview">
            <span class="item-macro">P <strong>${item.protein || 0}g</strong></span>
            <span class="item-macro">F <strong>${item.fat || 0}g</strong></span>
            <span class="item-macro">C <strong>${item.carbs || 0}g</strong></span>
        </div>
        ${getItemFlags(item)}
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
    `;
}

function getItemFlags(item) {
    const { flags } = calculateMealGrade(item, 'General');
    if (!flags || flags.length === 0) return '';
    
    return `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px;">
        ${flags.map(fl => `
            <div class="grade-reason-badge type-${fl.type}" 
                 onclick="event.stopPropagation(); showNutritionalInsight('${fl.text}', '${(fl.reason || '').replace(/'/g, "\\'")}')"
                 style="font-size: 0.65rem; padding: 3px 10px; cursor: help;">
                <i class="fa-solid ${fl.icon}"></i> ${fl.text}
                <i class="fa-solid fa-circle-info" style="margin-left: 4px; opacity: 0.7;"></i>
            </div>
        `).join('')}
    </div>`;
}

function showNutritionalInsight(title, reason) {
    if (!reason) return;
    toast(`<strong>${title}</strong><br/>${reason}`);
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

    const calGoal = (currentUser && currentUser.calorie_goal) ? currentUser.calorie_goal : 2000;
    const pct = Math.round((totals.cal / calGoal) * 100);

    document.getElementById('logCount').textContent = `${selectedItems.length} items`;
    document.getElementById('logCalBadge').innerHTML = `
        <span class="macro-val"><strong>${Math.round(totals.cal)}</strong> cal</span>
        <span class="macro-divider">|</span>
        <span class="macro-val"><strong>${Math.round(totals.p)}</strong>g protein</span>
        <span class="macro-val"><strong>${Math.round(totals.f)}</strong>g fat</span>
        <span class="macro-val"><strong>${Math.round(totals.c)}</strong>g carbs</span>
    `;
    const pctEl = document.getElementById('logGoalPct');
    if (pctEl) {
        pctEl.textContent = `${pct}% of goal`;
        pctEl.style.color = pct > 60 ? '#ef4444' : pct > 35 ? '#f59e0b' : '#10b981';
    }

    renderNegotiator(pct);
}

function renderNegotiator(totalPct) {
    const panel = document.getElementById('negotiatorPanel');
    if (!panel) return;
    
    let trapItem = null;
    let maxCal = 0;
    
    for (const item of selectedItems) {
        const cal = (item.calories || 0) * item.servings;
        const pro = item.protein || 0;
        const fib = item.fiber || 0;
        const isHighProtein = pro >= 15;
        
        if ((cal >= 500) || (cal >= 350 && !isHighProtein && fib < 2)) {
            if (cal > maxCal) {
                maxCal = cal;
                trapItem = item;
            }
        }
    }
    
    if (!trapItem) {
        panel.style.display = 'none';
        panel.classList.remove('show');
        return;
    }
    
    panel.style.display = 'flex';
    panel.classList.add('show');
    
    const walkMiles = Math.max(1, Math.round(maxCal / 100));
    const runMins = Math.max(5, Math.round(maxCal / 11));
    const goal = (currentUser && currentUser.calorie_goal) ? currentUser.calorie_goal : 2000;
    const itemPct = Math.round((maxCal / goal) * 100);
    
    let swapMsg = '';
    let nameLower = trapItem.name.toLowerCase();
    if (nameLower.includes('fries')) {
        swapMsg = `Skip the fries &rarr; save ${Math.round(maxCal)} cal`;
    } else if (nameLower.includes('burger')) {
        swapMsg = 'Swap to grilled chicken &rarr; save ~200 cal';
    } else if (nameLower.includes('soda') || nameLower.includes('drink')) {
        swapMsg = 'Skip the drink &rarr; dessert unlocked';
    } else if (nameLower.includes('pizza')) {
        swapMsg = `Drop one slice &rarr; save ~${Math.round(maxCal / trapItem.servings / 2)} cal`;
    } else {
        swapMsg = `Halve the portion &rarr; save ${Math.round(maxCal / 2)} cal`;
    }

    panel.innerHTML = `
        <div class="negotiator-header">
            <div class="negotiator-title">
                <i class="fa-solid fa-triangle-exclamation"></i> 
                Watch out — ${trapItem.name} is a trap meal
            </div>
            <button class="btn-close" style="font-size:1.2rem; cursor:pointer;" onclick="dismissNegotiator()">×</button>
        </div>
        <div class="negotiator-stats">
            <div class="negotiator-stat"><i class="fa-solid fa-wallet"></i> <span>Costs <strong>${itemPct}%</strong> of daily budget</span></div>
            <div class="negotiator-stat"><i class="fa-solid fa-person-running"></i> <span>Equals <strong>${runMins} min</strong> running</span></div>
            <div class="negotiator-stat"><i class="fa-solid fa-person-walking"></i> <span>Or <strong>${walkMiles} miles</strong> walking</span></div>
            <div class="negotiator-stat"><i class="fa-solid fa-burger"></i> <span>Calorie equivalent: <strong>${Math.max(1, Math.round((maxCal/350)*10)/10)} burgers</strong></span></div>
        </div>
        <div class="negotiator-swap" style="background: rgba(245, 158, 11, 0.1); border: 2px dashed var(--amber); padding: 15px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
            <div style="font-weight: 700; color: #92400e;">🤝 ${swapMsg}</div>
            <button class="btn btn-sm" onclick="applySwap('${trapItem.name.replace(/'/g, "\\'")}')" 
                style="background: var(--amber); color: white; font-weight: 950; letter-spacing: 0.05em; padding: 10px 18px; border-radius: 100px; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);">
                <i class="fa-solid fa-graduation-cap"></i> EARN EXTRA CREDIT
            </button>
        </div>
    `;
}

function dismissNegotiator() {
    const panel = document.getElementById('negotiatorPanel');
    if (panel) panel.style.display = 'none';
}

function applySwap(itemName) {
    const idx = selectedItems.findIndex(i => i.name === itemName);
    if (idx >= 0) {
        if (selectedItems[idx].servings > 0.5) {
            selectedItems[idx].servings = Math.max(0.5, selectedItems[idx].servings / 2);
            // Updating serving UI
            const itemEl = document.getElementById(`item-${itemName.replace(/\s+/g, '-')}`);
            if (itemEl) {
                const valEl = itemEl.querySelector('.serving-val');
                if (valEl) valEl.textContent = selectedItems[idx].servings;
            }
        } else {
            selectedItems.splice(idx, 1);
            const el = document.getElementById(`item-${itemName.replace(/\s+/g, '-')}`);
            if (el) el.classList.remove('selected');
        }
        updateLogBar();
    }
}

function openLogModal() {
    const d = new Date((trackingDate || todayStr()) + 'T12:00:00');
    const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    
    let summaryHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
            <strong style="color: var(--text-2);"><i class="fa-solid fa-calendar-day"></i> Logging Date:</strong>
            <span style="font-weight: 800; color: var(--primary);">${dateStr}</span>
        </div>
    `;

    if (selectedItems.length === 1) {
        const item = selectedItems[0];
        const s = item.servings || 1;
        summaryHtml += `
            <div style="margin-top: 15px; background: var(--surface2); padding: 15px; border-radius: 12px; border: 1px solid var(--border);">
                <div style="font-weight: 850; font-size: 1rem; color: var(--primary); margin-bottom: 8px;">${item.name}</div>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center;">
                    <div class="modal-mini-metric">
                        <div style="font-size: 1.1rem; font-weight: 900; color: var(--primary);">${Math.round(item.calories * s)}</div>
                        <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-3); text-transform: uppercase;">Cals</div>
                    </div>
                    <div class="modal-mini-metric" style="border-left: 1px solid rgba(0,0,0,0.05);">
                        <div style="font-size: 1.1rem; font-weight: 900; color: var(--primary);">${Math.round(item.protein * s)}g</div>
                        <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-3); text-transform: uppercase;">Prot</div>
                    </div>
                    <div class="modal-mini-metric" style="border-left: 1px solid rgba(0,0,0,0.05);">
                        <div style="font-size: 1.1rem; font-weight: 900; color: var(--primary);">${Math.round(item.carbs * s)}g</div>
                        <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-3); text-transform: uppercase;">Carb</div>
                    </div>
                    <div class="modal-mini-metric" style="border-left: 1px solid rgba(0,0,0,0.05);">
                        <div style="font-size: 1.1rem; font-weight: 900; color: var(--primary);">${Math.round(item.fat * s)}g</div>
                        <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-3); text-transform: uppercase;">Fat</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        const totals = selectedItems.reduce((acc, i) => {
            const s = i.servings || 1;
            acc.cal += (i.calories || 0) * s;
            return acc;
        }, { cal: 0 });

        summaryHtml += `
            <div style="margin-top: 15px; background: var(--surface2); padding: 15px; border-radius: 12px; border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 0.85rem; font-weight: 800; color: var(--text-2);">${selectedItems.length} items selected</div>
                <div style="font-weight: 900; color: var(--primary); font-size: 1.1rem;">${Math.round(totals.cal)} <span style="font-size:0.7rem; font-weight:700; color:var(--text-3)">TOT CALS</span></div>
            </div>
        `;
    }

    document.getElementById('logSummary').innerHTML = summaryHtml;
    
    // Select the appropriate meal type based on activePeriodSlug
    document.querySelectorAll('#mealTypeControl .segment-btn').forEach(b => {
        b.classList.remove('active');
        const t = b.dataset.type.toLowerCase();
        const ap = (activePeriodSlug || '').toLowerCase();
        if (t === ap || (ap === 'brunch' && t === 'breakfast')) {
            b.classList.add('active');
        }
    });
    if (!document.querySelector('#mealTypeControl .segment-btn.active')) {
        const fallback = document.querySelector('#mealTypeControl .segment-btn');
        if (fallback) fallback.classList.add('active');
    }
    
    document.getElementById('logModalBackdrop').classList.add('open');
}

function selectMealType(btn) {
    document.querySelectorAll('#mealTypeControl .segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function closeLogModal() {
    document.getElementById('logModalBackdrop').classList.remove('open');
}

async function confirmLog() {
    const date = trackingDate || todayStr();
    // Multiply by servings before sending to legacy API or update API to handle servings
    const itemsToLog = selectedItems.map(i => ({
        ...i,
        portion: i.servings,
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
    const activeMealBtn = document.querySelector('#mealTypeControl .segment-btn.active');
    let mealType = activePeriodSlug || 'lunch';
    if (activeMealBtn) {
        mealType = activeMealBtn.dataset.type.toLowerCase();
    }

    for (const item of itemsToLog) {
        const ok = await addLogEntry(date, mealType, [item]);
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
    updateCalorieDebtWidget();
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
    if (!t) return;
    t.innerHTML = msg; 
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 4000);
}

function openGoalsModal() {
    document.getElementById('goalCaloriesInput').value = currentUser.calorie_goal || 2000;
    document.getElementById('goalProteinInput').value = currentUser.protein_goal || 120;
    document.getElementById('goalFatInput').value = currentUser.fat_goal || 70;
    document.getElementById('goalCarbInput').value = currentUser.carb_goal || 250;
    document.getElementById('userHeight').value = currentUser.height || '';
    document.getElementById('userWeight').value = currentUser.weight || '';
    
    const savedActivity = localStorage.getItem('userActivity') || '1.55';
    const savedGoal = localStorage.getItem('userGoal') || '0';
    if(document.getElementById('userActivity')) document.getElementById('userActivity').value = savedActivity;
    if(document.getElementById('userGoal')) document.getElementById('userGoal').value = savedGoal;
    
    document.getElementById('advisorSuggestion').innerHTML = 'Enter your metrics above to see suggested goals based on average activity levels.';
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

    if(document.getElementById('userActivity')) localStorage.setItem('userActivity', document.getElementById('userActivity').value);
    if(document.getElementById('userGoal')) localStorage.setItem('userGoal', document.getElementById('userGoal').value);

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
    const activityLvl = document.getElementById('userActivity') ? parseFloat(document.getElementById('userActivity').value) : 1.55;
    const goalChange = document.getElementById('userGoal') ? parseFloat(document.getElementById('userGoal').value) : 0;

    if (!h || !w) {
        document.getElementById('advisorSuggestion').innerHTML = 'Enter your metrics above to see suggested goals based on average activity levels.';
        return;
    }

    // Mifflin-St Jeor (assume 20 years old, male for middle-ground)
    // BMR = (10 * weight in kg) + (6.25 * height in cm) - (5 * age) + 5
    const weightKg = w * 0.453592;
    const heightCm = h * 2.54;
    const age = 20;

    const bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5;
    let tdee = Math.round(bmr * activityLvl);
    tdee += goalChange;

    // Suggest macros based on standard split with protein prioritization
    const protein = Math.round(w * 0.9); // 0.9g per lb
    const fat = Math.round(w * 0.35);    // 0.35g per lb
    const carbs = Math.max(0, Math.round((tdee - (protein * 4) - (fat * 9)) / 4));

    document.getElementById('advisorSuggestion').innerHTML = `
        <strong>Suggested Daily Goals:</strong><br/>
        Calories: <strong>${tdee}</strong> kcal<br/>
        Protein: <strong>${protein}g</strong> • Fats: <strong>${fat}g</strong> • Carbs: <strong>${carbs}g</strong>
        <p style="font-size: 0.7rem; margin-top: 5px; opacity: 0.7;">Based on your inputs and goals.</p>
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
    saveGoals();
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

        const projectionDays = parseInt(document.getElementById('projectionPeriod')?.value || '90');
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

window.simBaseline = null;
let lastWeightDelta = 0;

async function initSimulatorBaseline() {
    if (window.simBaseline) return window.simBaseline;
    
    console.log("[Simulator] Initializing baseline from last 14 days...");
    let endD = new Date();
    let startD = new Date();
    startD.setDate(endD.getDate() - 13); // 14 days total
    
    const startStr = formatDate(startD);
    const endStr = formatDate(endD);
    
    try {
        const res = await authFetch(`${API}/api/user/logs-range?start=${startStr}&end=${endStr}`);
        const data = await res.json();
        const logs = data.logs || [];
        
        const days = 14;
        const breakdown = logs.reduce((acc, l) => {
            let mt = (l.meal_type || 'snack').toLowerCase();
            if (mt === 'brunch') mt = 'lunch';
            if (acc[mt] !== undefined) acc[mt] += (l.calories || 0);
            else acc.snack += (l.calories || 0);
            return acc;
        }, { breakfast: 0, lunch: 0, dinner: 0, snack: 0 });
        
        window.simBaseline = {
            breakfast: Math.round(breakdown.breakfast / days),
            lunch: Math.round(breakdown.lunch / days),
            dinner: Math.round(breakdown.dinner / days),
            snack: Math.round(breakdown.snack / days),
            total: Math.round((breakdown.breakfast + breakdown.lunch + breakdown.dinner + breakdown.snack) / days)
        };
        
        // Update Static Labels
        if (document.getElementById('simBreakfastBaseline')) document.getElementById('simBreakfastBaseline').textContent = `Your avg: ${window.simBaseline.breakfast} cal`;
        if (document.getElementById('simLunchBaseline')) document.getElementById('simLunchBaseline').textContent = `Your avg: ${window.simBaseline.lunch} cal`;
        if (document.getElementById('simDinnerBaseline')) document.getElementById('simDinnerBaseline').textContent = `Your avg: ${window.simBaseline.dinner} cal`;
        if (document.getElementById('simSnackBaseline')) document.getElementById('simSnackBaseline').textContent = `Your avg: ${window.simBaseline.snack} cal`;
        
        return window.simBaseline;
    } catch (e) {
        console.error("Baseline fetch failed", e);
        return null;
    }
}

async function updateFutureProjection() {
    if (!currentUser) return;
    
    const baseline = await initSimulatorBaseline();
    if (!baseline) return;

    const projectionDays = parseInt(document.getElementById('simPeriod')?.value || '90');
    
    const breakfastMod = parseInt(document.getElementById('simBreakfast')?.value || '0');
    const lunchMod = parseInt(document.getElementById('simLunch')?.value || '0');
    const dinnerMod = parseInt(document.getElementById('simDinner')?.value || '0');
    const snackMod = parseInt(document.getElementById('simSnack')?.value || '0');
    
    // Update live slider labels
    const updateLabel = (id, base, mod) => {
        const el = document.getElementById(id);
        if (!el) return;
        const newVal = Math.max(0, base + mod);
        el.textContent = `New: ${newVal} cal → ${(mod >= 0 ? '+' : '')}${mod}/day`;
    };

    updateLabel('simBreakfastLabel', baseline.breakfast, breakfastMod);
    updateLabel('simLunchLabel', baseline.lunch, lunchMod);
    updateLabel('simDinnerLabel', baseline.dinner, dinnerMod);
    updateLabel('simSnackLabel', baseline.snack, snackMod);

    const simDailyAvg = Math.max(0, baseline.breakfast + breakfastMod) + 
                        Math.max(0, baseline.lunch + lunchMod) + 
                        Math.max(0, baseline.dinner + dinnerMod) + 
                        Math.max(0, baseline.snack + snackMod);

    if (document.getElementById('simNewAvg')) document.getElementById('simNewAvg').textContent = Math.round(simDailyAvg) + ' cals';

    // Math: Weight delta = (simDailyAvg - baselineAvg) * days / 3500
    const weightDelta = (simDailyAvg - baseline.total) * projectionDays / 3500;
    
    // Hero Number Update
    const heroEl = document.getElementById('simConsequenceNumber');
    if (heroEl) {
        const mainNum = heroEl.querySelector('.main-number');
        const sub = heroEl.querySelector('.sub-text');
        
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + projectionDays);
        const monthName = targetDate.toLocaleString('default', { month: 'long' });

        const formattedDelta = (weightDelta >= 0 ? '+' : '−') + Math.abs(weightDelta).toFixed(1);
        mainNum.textContent = `${formattedDelta} lbs by ${monthName}`;
        
        if (weightDelta > 0.1) mainNum.style.color = 'var(--red)';
        else if (weightDelta < -0.1) mainNum.style.color = 'var(--green)';
        else mainNum.style.color = 'var(--text-3)';

        // Subtext logic
        if (Math.abs(weightDelta) < 0.1) {
            sub.textContent = "Maintain current habits → no weight change.";
        } else if (weightDelta < 0) {
            const savePerWeek = Math.abs(simDailyAvg - baseline.total) * 7;
            if (savePerWeek > 2500) sub.textContent = `Cut ${Math.round(savePerWeek/700)} big meals/week → save ${Math.abs(weightDelta).toFixed(1)} lbs by ${monthName}`;
            else sub.textContent = `Small daily discipline → save ${Math.abs(weightDelta).toFixed(1)} lbs by ${monthName}`;
        } else {
            sub.textContent = `Extra ${Math.round(simDailyAvg - baseline.total)} cal daily → adding up by ${monthName}.`;
        }

        // Animation
        if ((lastWeightDelta <= 0 && weightDelta > 0) || (lastWeightDelta >= 0 && weightDelta < 0)) {
            const flashClass = weightDelta > 0 ? 'flash-red' : 'flash-green';
            heroEl.classList.remove('flash-red', 'flash-green');
            void heroEl.offsetWidth; // trigger reflow
            heroEl.classList.add(flashClass);
        }
        lastWeightDelta = weightDelta;
    }

    // Update the chart for visual context
    const startWeight = parseFloat(currentUser.weight) || 150;
    const labels = [];
    const baselinePoints = [];
    const simPoints = [];
    
    for (let i = 0; i <= projectionDays; i += Math.max(1, Math.floor(projectionDays/10))) {
        labels.push('Day ' + i);
        baselinePoints.push(startWeight);
        simPoints.push(startWeight + ((simDailyAvg - baseline.total) * i / 3500));
    }

    const canvas = document.getElementById('futureChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (futureChartInstance) futureChartInstance.destroy();
    
    futureChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                   label: 'Current Habits', data: baselinePoints, borderColor: '#94a3b8', borderDash: [5, 5], fill: false, tension: 0.3, pointRadius: 0
                },
                {
                   label: 'Simulated Habits', data: simPoints, borderColor: '#500000', backgroundColor: 'rgba(80, 0, 0, 0.05)', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 3
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: {
                y: { title: { display: true, text: 'Weight (lbs)', font: { weight: 'bold' } }, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            },
            plugins: {
                legend: { position: 'top', align: 'end', labels: { boxWidth: 12, font: { weight: 'bold', size: 11 } } },
                tooltip: {
                    callbacks: { label: (context) => {
                           let label = context.dataset.label || '';
                           if (label) label += ': ';
                           if (context.parsed.y !== null) label += context.parsed.y.toFixed(1) + ' lbs';
                           return label;
                    }}
                }
            }
        }
    });
}

window.getSimulatorState = function() {
    if (!window.simBaseline) return null;
    const projectionDays = parseInt(document.getElementById('simPeriod')?.value || '90');
    const breakfastMod = parseInt(document.getElementById('simBreakfast')?.value || '0');
    const lunchMod = parseInt(document.getElementById('simLunch')?.value || '0');
    const dinnerMod = parseInt(document.getElementById('simDinner')?.value || '0');
    const snackMod = parseInt(document.getElementById('simSnack')?.value || '0');
    
    const simDailyAvg = Math.max(0, window.simBaseline.breakfast + breakfastMod) + 
                        Math.max(0, window.simBaseline.lunch + lunchMod) + 
                        Math.max(0, window.simBaseline.dinner + dinnerMod) + 
                        Math.max(0, window.simBaseline.snack + snackMod);

    return {
        baseline: window.simBaseline,
        mods: { breakfastMod, lunchMod, dinnerMod, snackMod },
        projectionDays,
        simDailyAvg,
        weightDelta: (simDailyAvg - window.simBaseline.total) * projectionDays / 3500
    };
};

function resetSimulator() {
    ['simBreakfast', 'simLunch', 'simDinner', 'simSnack'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 0;
    });
    updateFutureProjection();
}


function clearMealSelection() {
    selectedLoggedMeals = [];
    refreshDashboard();
    toast('Selection cleared');
}

// ── LEADERBOARD ─────────────────────────────
async function fetchTopLeaderboard() {
    const topEl = document.getElementById('topLeaderboardContent');
    if (!topEl) return;
    
    try {
        topEl.innerHTML = '<div class="spinner"></div><p style="text-align:center; font-weight:bold;">Loading campus favorites...</p>';
        const res = await authFetch(`${API}/api/leaderboard/top`);
        const items = await res.json();
        
        let headerHtml = `<h3 style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; font-weight: 800; text-transform: uppercase;">🏆 This Week's Campus Favorites</h3>`;

        if (!Array.isArray(items) || items.length === 0 || items.every(i => i.total_servings === 0)) {
            topEl.innerHTML = headerHtml + `<div class="empty-state">📊 No campus data yet — be the first to log a meal!</div>`;
            return;
        }

        let html = headerHtml;
        let top3 = items.slice(0, 3);
        let rest = items.slice(3, 10);

        if (top3.length > 0) {
            html += `<div class="podium-container" style="display: flex; justify-content: center; align-items: stretch; gap: 8px; margin-bottom: 30px; margin-top: 20px; border-bottom: 2px solid #000; padding-bottom: 15px;">`;
            
            const podiumOrder = [];
            if (top3.length === 1) {
                podiumOrder.push({ item: top3[0], rank: 1, height: '160px', bg: '#FFD700', color: '#000' });
            } else if (top3.length === 2) {
                podiumOrder.push({ item: top3[1], rank: 2, height: '120px', bg: '#C0C0C0', color: '#000' });
                podiumOrder.push({ item: top3[0], rank: 1, height: '160px', bg: '#FFD700', color: '#000' });
            } else {
                podiumOrder.push({ item: top3[1], rank: 2, height: '120px', bg: '#C0C0C0', color: '#000' });
                podiumOrder.push({ item: top3[0], rank: 1, height: '160px', bg: '#FFD700', color: '#000' });
                podiumOrder.push({ item: top3[2], rank: 3, height: '80px', bg: '#CD7F32', color: '#000' });
            }

            podiumOrder.forEach(p => {
                html += `
                <div style="display: flex; flex-direction: column; width: 120px;">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; flex: 1;">
                        <div style="width: 100%; height: ${p.height}; background: ${p.bg}; color: ${p.color}; border: 2px solid #000; display: flex; justify-content: center; align-items: flex-start; padding-top: 10px; position: relative;">
                            ${p.rank === 1 ? '<div style="position: absolute; top: -25px; left: 50%; transform: translateX(-50%); font-size: 1.5rem;">👑</div>' : ''}
                            <span style="font-size: 1.5rem; font-weight: 800;">${p.rank}</span>
                        </div>
                    </div>
                    <div style="margin-top: 10px; text-align: center;">
                        <div style="font-size: 0.85rem; font-weight: 800; text-transform: uppercase; line-height: 1.2;">${p.item.item_name}</div>
                        <div style="font-size: 0.75rem; font-weight: bold; color: var(--primary); margin-top: 4px;">${Number(p.item.total_servings).toLocaleString(undefined, { maximumFractionDigits: 1 })} SERVINGS</div>
                        <div style="font-size: 0.65rem; color: var(--text-3); margin-top: 2px;">${p.item.unique_users} Users</div>
                    </div>
                </div>
                `;
            });
            html += `</div>`;
        }

        if (rest.length > 0) {
            html += `<div class="leaderboard-list">`;
            rest.forEach((p, idx) => {
                const rank = idx + 4;
                html += `
                    <div class="leaderboard-row" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px dashed #000;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div style="font-weight: 900; font-size: 1.2rem; min-width: 25px;">#${rank}</div>
                            <div style="font-weight: 700; font-size: 1rem; text-transform: uppercase;">${p.item_name}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 800; font-size: 1.1rem;">
                                ${Number(p.total_servings).toLocaleString(undefined, { maximumFractionDigits: 1 })} <span style="font-size: 0.7rem; font-weight: normal; font-style: italic;">SERVINGS</span>
                            </div>
                            <div style="font-size: 0.7rem; color: var(--text-3);">${p.unique_users} Users</div>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        }
        
        topEl.innerHTML = html;
    } catch (e) {
        console.error('Top Leaderboard error', e);
        topEl.innerHTML = '<div class="empty-state text-red">Failed to load top campus favorites.</div>';
    }
}

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
                        <div style="font-size: 0.75rem; font-weight: bold; color: var(--primary); margin-top: 4px;">${Number(item.user.count).toLocaleString(undefined, { maximumFractionDigits: 1 })} SERVINGS</div>
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
                            ${Number(user.count).toLocaleString(undefined, { maximumFractionDigits: 1 })} <span style="font-size: 0.7rem; font-weight: normal; font-style: italic;">SERVINGS</span>
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

let mealsCollapsed = true;

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

// ══════════════════════════════════════════════
//  INSIGHT ENGINE — Causation-Style Analytics
// ══════════════════════════════════════════════

async function updateInsights() {
    if (!currentUser) return;
    const heatmapDays = parseInt(document.getElementById('heatmapPeriod')?.value || '28');
    const culpritDays = parseInt(document.getElementById('culpritPeriod')?.value || '14');
    const days = Math.max(heatmapDays, culpritDays);

    const endD = new Date();
    const startD = new Date();
    startD.setDate(endD.getDate() - (days - 1));

    try {
        const res = await authFetch(`${API}/api/user/logs-range?start=${formatDate(startD)}&end=${formatDate(endD)}`);
        const data = await res.json();
        const logs = data.logs || [];
        renderDangerDayInsight(logs);
        renderMealHeatmapInsight(logs);
        renderCulpritInsight(logs);
        updateNewspaperClippings(logs);
    } catch(e) {
        console.error('[Insights] Failed to load:', e);
    }
}

// ── INSIGHT: MEAL CONSISTENCY HEATMAP ──────────────────────
function renderMealHeatmapInsight(logs) {
    const container = document.getElementById('mealHeatmapGrid');
    if (!container) return;

    const heatmapDays = parseInt(document.getElementById('heatmapPeriod')?.value || '28');
    const calGoal = currentUser.calorie_goal || 2000;

    // Per-meal calorie targets as % of daily goal
    const TARGETS = {
        breakfast: calGoal * 0.25,
        brunch:    calGoal * 0.30,
        lunch:     calGoal * 0.35,
        dinner:    calGoal * 0.35,
        snack:     calGoal * 0.10,
        shortcut:  calGoal * 0.15,
    };

    const MEAL_ROWS  = ['breakfast', 'lunch', 'dinner', 'snack'];
    const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

    // Build the date array (oldest → newest)
    const dates = [];
    const endD = new Date();
    for (let i = heatmapDays - 1; i >= 0; i--) {
        const d = new Date(endD);
        d.setDate(d.getDate() - i);
        dates.push(formatDate(d));
    }

    // Index logs: { date: { meal_type: totalCals } }
    const logMap = {};
    const datesWithAnyData = new Set();
    logs.forEach(l => {
        const d = l.date.split('T')[0];
        // Only include dates in our window
        if (!dates.includes(d)) return;
        if (!logMap[d]) logMap[d] = {};
        const type = (l.meal_type || 'snack').toLowerCase();
        logMap[d][type] = (logMap[d][type] || 0) + (l.calories || 0);
        datesWithAnyData.add(d);
    });

    const todayStr = formatDate(new Date());

    // Determine cell size based on date count
    const cellSize = heatmapDays <= 14 ? 22 : heatmapDays <= 28 ? 18 : heatmapDays <= 60 ? 14 : 10;
    const gap      = heatmapDays <= 60 ? 3 : 2;

    // ── Build HTML ────────────────────────────────────────────
    const labelW = 80; // px for row labels

    let html = `<div class="hm-grid-wrap" style="--hm-cell:${cellSize}px; --hm-gap:${gap}px; --hm-label:${labelW}px;">`;

    // Date header row (every 5 days)
    html += `<div class="hm-header-row">`;
    html += `<div class="hm-row-lbl" style="min-width:${labelW}px"></div>`;
    dates.forEach((d, i) => {
        const isToday = d === todayStr;
        if (i % 5 === 0 || isToday) {
            const dt = new Date(d + 'T12:00:00');
            const label = `${dt.getMonth()+1}/${dt.getDate()}`;
            html += `<div class="hm-col-date ${isToday ? 'hm-col-today' : ''}">${label}</div>`;
        } else {
            html += `<div class="hm-col-date"></div>`;
        }
    });
    html += `</div>`;

    // One row per meal type
    MEAL_ROWS.forEach(mealType => {
        const target = TARGETS[mealType];

        html += `<div class="hm-data-row">`;
        html += `<div class="hm-row-lbl" style="min-width:${labelW}px">${MEAL_LABELS[mealType]}</div>`;

        dates.forEach(d => {
            const hasAnyData = datesWithAnyData.has(d);
            const isPast     = d <= todayStr;

            // Brunch counts as breakfast
            let cals = logMap[d]?.[mealType] || 0;
            if (mealType === 'breakfast' && logMap[d]?.brunch) {
                cals += logMap[d].brunch;
            }

            const { bg, border, label } = getMealCellStyle(cals, target, hasAnyData, isPast);
            const tip = `${d} · ${MEAL_LABELS[mealType]}: ${cals > 0 ? cals + ' cal (' + label + ')' : label}`;

            html += `<div class="hm-cell ${d === todayStr ? 'hm-cell-today' : ''}" 
                style="background:${bg}; border-color:${border};" 
                title="${tip}"></div>`;
        });

        html += `</div>`;
    });

    html += `</div>`; // hm-grid-wrap
    container.innerHTML = html;
}

function getMealCellStyle(actualCals, targetCals, hasAnyDataOnDay, isPast) {
    // Future day
    if (!isPast) return { bg: '#f9fafb', border: '#e5e7eb', label: 'Future' };
    // No log data at all for this day
    if (actualCals === 0 && !hasAnyDataOnDay) return { bg: '#e5e7eb', border: '#d1d5db', label: 'No data' };
    // Skipped (day had other logs but not this meal)
    if (actualCals === 0) return { bg: '#fef08a', border: '#fde047', label: 'Skipped' };

    const ratio = actualCals / targetCals;
    if (ratio < 0.40) return { bg: '#fbbf24', border: '#f59e0b', label: 'Way under' };
    if (ratio < 0.70) return { bg: '#fde68a', border: '#fcd34d', label: 'Under target' };
    if (ratio < 1.00) return { bg: '#86efac', border: '#4ade80', label: 'Just right ↓' };
    if (ratio <= 1.30) return { bg: '#16a34a', border: '#15803d', label: 'On target ✓' };
    if (ratio <= 1.75) return { bg: '#f97316', border: '#ea580c', label: 'Over target' };
    return { bg: '#dc2626', border: '#b91c1c', label: 'Way over ↑' };
}

// ── INSIGHT 1: DANGER DAY ──────────────────────
function renderDangerDayInsight(logs) {
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DAY_FULL  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Sum calories and count log-days per weekday
    const dayCals  = [0,0,0,0,0,0,0];
    const dayCount = [0,0,0,0,0,0,0];
    const seenDates = {};

    logs.forEach(l => {
        const dow = new Date(l.date + 'T12:00:00').getDay();
        dayCals[dow] += (l.calories || 0);
        const key = `${dow}_${l.date}`;
        if (!seenDates[key]) {
            seenDates[key] = true;
            dayCount[dow]++;
        }
    });

    // Average calories per-day (only days with data)
    const avgCals = dayCals.map((c, i) => dayCount[i] > 0 ? Math.round(c / dayCount[i]) : 0);
    const maxVal   = Math.max(...avgCals, 1);
    const maxIdx   = avgCals.indexOf(Math.max(...avgCals));
    const hasDays  = avgCals.some(v => v > 0);

    const heatmap = document.getElementById('dayHeatmap');
    const badge   = document.getElementById('dangerDayBadge');
    const callout = document.getElementById('dangerDayCallout');

    if (!heatmap) return;

    heatmap.innerHTML = DAY_NAMES.map((d, i) => {
        const val     = avgCals[i];
        const pct     = val > 0 ? Math.round((val / maxVal) * 100) : 0;
        const isDanger = i === maxIdx && hasDays;
        return `
            <div class="heatmap-col">
                <div class="heatmap-bar-wrap">
                    <div class="heatmap-bar ${isDanger ? 'danger' : ''}" style="height:${pct}%">
                        ${isDanger ? '<i class="fa-solid fa-skull-crossbones heatmap-skull"></i>' : ''}
                    </div>
                </div>
                <div class="heatmap-label ${isDanger ? 'danger-label' : ''}">${d}</div>
                ${val > 0 ? `<div class="heatmap-val">${val >= 1000 ? (val/1000).toFixed(1)+'k' : val}</div>` : ''}
            </div>
        `;
    }).join('');

    if (hasDays) {
        const calGoal = currentUser.calorie_goal || 2000;
        const surplusDelta = maxVal - calGoal;
        const sign = surplusDelta > 0 ? '+' : '';
        badge.textContent = DAY_FULL[maxIdx];
        badge.classList.add('danger');
        callout.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>
            <span><strong>${DAY_FULL[maxIdx]}s</strong> average ${maxVal.toLocaleString()} cal — 
            ${surplusDelta > 0
                ? `<strong style="color:#ef4444">${sign}${surplusDelta} over goal.</strong> Your biggest risk day.`
                : `still within goal — you're doing well on ${DAY_FULL[maxIdx]}s.`}
            </span>`;
    } else {
        badge.textContent = '—';
        badge.classList.remove('danger');
        callout.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>Log more meals to unlock this insight.</span>`;
    }
}

// ── INSIGHT 2: MEAL TIMING BREAKDOWN ──────────────────────
function renderMealTimingInsight(logs) {
    const PERIODS = ['breakfast','brunch','lunch','dinner','snack','shortcut'];
    const EMOJIS  = { breakfast:'☀️', brunch:'🌤️', lunch:'🌞', dinner:'🌙', snack:'🍎', shortcut:'⚡' };
    const LABELS  = { breakfast:'Breakfast', brunch:'Brunch', lunch:'Lunch', dinner:'Dinner', snack:'Snack', shortcut:'Quick Log' };

    const calsByPeriod = {};
    PERIODS.forEach(p => calsByPeriod[p] = 0);

    logs.forEach(l => {
        const type = (l.meal_type || 'snack').toLowerCase();
        if (!calsByPeriod[type]) calsByPeriod[type] = 0;
        calsByPeriod[type] += (l.calories || 0);
    });

    const totalCals = Object.values(calsByPeriod).reduce((a,b) => a + b, 0);
    const hasTiming = totalCals > 0;

    const timingBars  = document.getElementById('timingBars');
    const timingBadge = document.getElementById('timingCulpritBadge');
    const timingCallout = document.getElementById('timingCallout');
    if (!timingBars) return;

    if (!hasTiming) {
        timingBars.innerHTML = '';
        timingBadge.textContent = '—';
        timingCallout.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>Log meals across different periods to unlock this insight.</span>`;
        return;
    }

    // Sort by calories descending
    const sorted = PERIODS
        .filter(p => calsByPeriod[p] > 0)
        .sort((a,b) => calsByPeriod[b] - calsByPeriod[a]);

    const maxPeriodCals = calsByPeriod[sorted[0]] || 1;

    timingBars.innerHTML = sorted.map(p => {
        const cal  = calsByPeriod[p];
        const pct  = Math.round((cal / totalCals) * 100);
        const barW = Math.round((cal / maxPeriodCals) * 100);
        const isTop = p === sorted[0];
        return `
            <div class="timing-bar-row ${isTop ? 'timing-top' : ''}">
                <div class="timing-period-label">
                    <span class="timing-emoji">${EMOJIS[p] || '🍽️'}</span>
                    <span>${LABELS[p] || p}</span>
                </div>
                <div class="timing-track">
                    <div class="timing-fill ${isTop ? 'top' : ''}" style="width:${barW}%"></div>
                </div>
                <div class="timing-stats">
                    <span class="timing-pct ${isTop ? 'top-pct' : ''}">${pct}%</span>
                    <span class="timing-cal">${cal.toLocaleString()} cal</span>
                </div>
            </div>
        `;
    }).join('');

    const topPeriod = sorted[0];
    const topPct    = Math.round((calsByPeriod[topPeriod] / totalCals) * 100);
    timingBadge.textContent = LABELS[topPeriod] || topPeriod;

    // Generate a sharp insight callout
    let calloutText;
    if (topPeriod === 'dinner' && topPct > 40) {
        calloutText = `<strong>Dinner accounts for ${topPct}% of your calories.</strong> Late eating is your biggest contributor — consider shifting calories earlier.`;
    } else if (topPeriod === 'snack' && topPct > 25) {
        calloutText = `<strong>Snacks are ${topPct}% of your intake.</strong> Liquid or untracked calories often hide here — review what counts as a "snack."`;
    } else if (topPeriod === 'lunch' && topPct > 45) {
        calloutText = `<strong>Lunch dominates at ${topPct}% of your calories.</strong> Great for front-loading energy — just make sure dinner stays lean.`;
    } else {
        calloutText = `<strong>${LABELS[topPeriod]} is your heaviest meal</strong> at ${topPct}% of your total calories logged.`;
    }
    timingCallout.innerHTML = `<i class="fa-solid fa-lightbulb"></i><span>${calloutText}</span>`;
}

// ── INSIGHT 3: TOP CALORIE CULPRITS ──────────────────────
function renderCulpritInsight(logs) {
    const calGoal = currentUser.calorie_goal || 2000;

    const culpritList = document.getElementById('culpritList');
    const macrocalSplit = document.getElementById('macrocalSplit');
    if (!culpritList) return;

    if (!logs.length) {
        culpritList.innerHTML = `<div class="insight-callout"><i class="fa-solid fa-circle-info"></i> <span>Log meals to see your top contributors.</span></div>`;
        if (macrocalSplit) macrocalSplit.style.display = 'none';
        return;
    }

    // Aggregate calories per item_name
    const itemMap = {};
    logs.forEach(l => {
        const name = l.item_name || 'Unknown';
        if (!itemMap[name]) {
            itemMap[name] = { calories: 0, protein: 0, fat: 0, carbs: 0, count: 0 };
        }
        itemMap[name].calories += (l.calories || 0);
        itemMap[name].protein  += (l.protein || 0);
        itemMap[name].fat      += (l.fat || 0);
        itemMap[name].carbs    += (l.carbs || 0);
        itemMap[name].count++;
    });

    const sorted = Object.entries(itemMap)
        .sort((a,b) => b[1].calories - a[1].calories)
        .slice(0, 5);

    const totalLogged = logs.reduce((acc, l) => acc + (l.calories || 0), 0);
    const uniqueDays  = new Set(logs.map(l => l.date)).size || 1;
    const avgDailyCals = totalLogged / uniqueDays;
    const maxItemCals  = sorted[0]?.[1]?.calories || 1;

    culpritList.innerHTML = sorted.map(([name, stats], idx) => {
        const pct    = Math.round((stats.calories / totalLogged) * 100);
        const barPct = Math.round((stats.calories / maxItemCals) * 100);
        const medals = ['🥇','🥈','🥉','',''];
        const avgPerDay = (stats.calories / uniqueDays).toFixed(0);
        return `
            <div class="culprit-row">
                <div class="culprit-rank">${medals[idx] || `#${idx+1}`}</div>
                <div class="culprit-info">
                    <div class="culprit-name" title="${name}">${name.length > 32 ? name.slice(0,32)+'…' : name}</div>
                    <div class="culprit-bar-track">
                        <div class="culprit-bar-fill ${idx === 0 ? 'top' : ''}" style="width:${barPct}%"></div>
                    </div>
                </div>
                <div class="culprit-stats">
                    <span class="culprit-pct ${idx === 0 ? 'top-pct' : ''}">${pct}%</span>
                    <span class="culprit-cal">${stats.calories.toLocaleString()} total</span>
                    <span class="culprit-avg">~${avgPerDay} cal/day</span>
                </div>
            </div>
        `;
    }).join('');

    // Macro-calorie source split
    const totalProt  = logs.reduce((a,l) => a + (l.protein || 0), 0);
    const totalFat   = logs.reduce((a,l) => a + (l.fat || 0), 0);
    const totalCarb  = logs.reduce((a,l) => a + (l.carbs || 0), 0);

    const calFromProt = totalProt * 4;
    const calFromFat  = totalFat * 9;
    const calFromCarb = totalCarb * 4;
    const calFromMacros = calFromProt + calFromFat + calFromCarb || 1;

    const protPct = Math.round((calFromProt / calFromMacros) * 100);
    const fatPct  = Math.round((calFromFat  / calFromMacros) * 100);
    const carbPct = Math.round((calFromCarb / calFromMacros) * 100);

    document.getElementById('splitProtein').style.width = protPct + '%';
    document.getElementById('splitCarbs').style.width   = carbPct + '%';
    document.getElementById('splitFat').style.width     = fatPct  + '%';
    document.getElementById('splitProteinPct').textContent = protPct + '%';
    document.getElementById('splitCarbsPct').textContent   = carbPct + '%';
    document.getElementById('splitFatPct').textContent     = fatPct  + '%';
    if (macrocalSplit) macrocalSplit.style.display = 'block';
}

/**
 * Updates the Newspaper Clippings in the sidebars with dynamic personalized data.
 */
function updateNewspaperClippings(logs) {
    if (!logs || !logs.length) return;

    // 1. Most Logged Item
    const itemFreq = {};
    logs.forEach(l => {
        const name = l.item_name || 'Unknown';
        itemFreq[name] = (itemFreq[name] || 0) + (l.serving_size || 1);
    });
    const sortedItems = Object.entries(itemFreq).sort((a,b) => b[1] - a[1]);
    const topItem = sortedItems[0];

    if (topItem) {
        const name = topItem[0];
        const count = Math.round(topItem[1] * 10) / 10;
        const totalCals = logs.filter(l => l.item_name === name).reduce((sum, l) => sum + (l.calories || 0), 0);

        const title = name.toUpperCase();
        const desc = `You've consumed ${count} serving${count !== 1 ? 's' : ''} of ${name} recently, totaling ${totalCals.toLocaleString()} calories. A consistent favorite in your diet.`;

        ['left', 'right'].forEach(side => {
            const container = document.getElementById(`dynamic-${side}-most-logged`);
            const titleEl = document.getElementById(`val-${side}-most-logged-title`);
            const descEl = document.getElementById(`val-${side}-most-logged-desc`);
            if (container && titleEl && descEl) {
                titleEl.textContent = title;
                descEl.textContent = desc;
                container.style.display = 'block';
            }
        });
    }

    // 2. Biggest Danger Day (from logs)
    const dayCals = [0,0,0,0,0,0,0];
    const dayCount = [0,0,0,0,0,0,0];
    const seenDates = {};
    logs.forEach(l => {
        const dow = new Date(l.date + 'T12:00:00').getDay();
        dayCals[dow] += (l.calories || 0);
        const key = `${dow}_${l.date}`;
        if (!seenDates[key]) {
            seenDates[key] = true;
            dayCount[dow]++;
        }
    });
    const avgCals = dayCals.map((c, i) => dayCount[i] > 0 ? Math.round(c / dayCount[i]) : 0);
    const maxIdx = avgCals.indexOf(Math.max(...avgCals));
    const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    if (avgCals[maxIdx] > 0) {
        const dayName = DAY_FULL[maxIdx];
        const avg = avgCals[maxIdx];
        const calGoal = currentUser.calorie_goal || 2000;
        const diff = avg - calGoal;

        const title = `${dayName.toUpperCase()}S ALERT`;
        const desc = `On average, you consume ${avg.toLocaleString()} calories on ${dayName}s. ${diff > 0 ? `That's ${diff} over your daily goal.` : 'Keep up the discipline!'}`;

        ['left', 'right'].forEach(side => {
            const container = document.getElementById(`dynamic-${side}-dangerDay`);
            const titleEl = document.getElementById(`val-${side}-dangerDay-title`);
            const descEl = document.getElementById(`val-${side}-dangerDay-desc`);
            if (container && titleEl && descEl) {
                titleEl.textContent = title;
                descEl.textContent = desc;
                container.style.display = 'block';
            }
        });
    }

    // 3. Longest Streak (We'll wait for calculateStreak to finish or use its result)
    // Actually, calculateStreak is async and updates the DOM. We can just poll or call it.
    // Let's modify calculateStreak to also update the clippings.
}

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

// ══════════════════════════════════════════════
//  DINING HALL TWIN — Mirror Feature
// ══════════════════════════════════════════════

let currentTwinIndex = 0;
let currentHighlightIndex = 0;
let mirrorDataCache = null;

async function fetchMirror() {
    const days = document.getElementById('mirrorDays')?.value || '30';

    const loading = document.getElementById('mirrorLoading');
    const noTwin  = document.getElementById('mirrorNoTwin');
    const content = document.getElementById('mirrorContent');

    if (loading) loading.style.display = 'block';
    if (noTwin)  noTwin.style.display  = 'none';
    if (content) content.style.display = 'none';

    try {
        const res  = await authFetch(`${API}/api/mirror?days=${days}`);
        const data = await res.json();

        if (loading) loading.style.display = 'none';

        if (!data || !data.twins || data.twins.length === 0) {
            if (noTwin) noTwin.style.display = 'block';
            return;
        }

        mirrorDataCache = data;
        currentTwinIndex = 0;
        renderMirror();
        if (content) content.style.display = 'block';

    } catch (e) {
        console.error('Mirror fetch error', e);
        if (loading) loading.style.display = 'none';
        if (noTwin)  noTwin.style.display  = 'block';
    }
}

function prevTwin() {
    if (!mirrorDataCache || !mirrorDataCache.twins) return;
    currentTwinIndex = (currentTwinIndex - 1 + mirrorDataCache.twins.length) % mirrorDataCache.twins.length;
    currentHighlightIndex = 0;
    renderMirror();
}

function nextTwin() {
    if (!mirrorDataCache || !mirrorDataCache.twins) return;
    currentTwinIndex = (currentTwinIndex + 1) % mirrorDataCache.twins.length;
    currentHighlightIndex = 0;
    renderMirror();
}

function prevHighlight() {
    const match = mirrorDataCache?.twins[currentTwinIndex];
    if (!match || !match.twin.highlights || match.twin.highlights.length === 0) return;
    currentHighlightIndex = (currentHighlightIndex - 1 + match.twin.highlights.length) % match.twin.highlights.length;
    renderMirrorHighlight();
}

function nextHighlight() {
    const match = mirrorDataCache?.twins[currentTwinIndex];
    if (!match || !match.twin.highlights || match.twin.highlights.length === 0) return;
    currentHighlightIndex = (currentHighlightIndex + 1) % match.twin.highlights.length;
    renderMirrorHighlight();
}

function renderMirror() {
    if (!mirrorDataCache) return;
    const { me, twins, days } = mirrorDataCache;
    const match = twins[currentTwinIndex];
    if (!match) return;
    
    const { twin, similarity, sharedFoods } = match;
    
    const counterEl = document.getElementById('mirrorTwinCounter');
    if (counterEl) counterEl.textContent = `Peer Match ${currentTwinIndex + 1} of ${twins.length}`;

    // Similarity Reason (Fix 2)
    const reasonEl = document.getElementById('mirrorSimReason');
    if (reasonEl) {
        const statsToCompare = [
            { key: 'avg_protein', label: 'protein/day', unit: 'g' },
            { key: 'avg_carbs',   label: 'carbs/day',   unit: 'g' },
            { key: 'avg_fat',     label: 'fat/day',     unit: 'g' }
        ];
        // Sort by closest match
        statsToCompare.sort((a,b) => {
            const diffA = Math.abs(me[a.key] - twin[a.key]);
            const diffB = Math.abs(me[b.key] - twin[b.key]);
            return diffA - diffB;
        });
        const top2 = statsToCompare.slice(0, 2);
        const reasonStr = `You both average ${Math.round(twin[top2[0].key])}${top2[0].unit} ${top2[0].label} and have nearly identical ${top2[1].label}.`;
        reasonEl.textContent = reasonStr;
    }
    // Similarity banner
    const simEl  = document.getElementById('mirrorSimilarityPct');
    const simBar = document.getElementById('mirrorSimBar');
    if (simEl)  simEl.textContent = `${Math.min(similarity, 100)}%`;
    if (simBar) {
        simBar.style.width = '0%';
        setTimeout(() => { simBar.style.width = `${Math.min(similarity, 100)}%`; }, 120);
    }

    // Avatars + names
    const fallbackUrl = n => `https://ui-avatars.com/api/?name=${encodeURIComponent(n)}&background=1e293b&color=fff&bold=true`;

    const myPic = document.getElementById('mirrorMyPic');
    if (myPic) {
        myPic.src     = me.picture || fallbackUrl(me.name);
        myPic.onerror = () => { myPic.src = fallbackUrl(me.name); };
    }
    const twinPic = document.getElementById('mirrorTwinPic');
    if (twinPic) {
        twinPic.src     = twin.picture || fallbackUrl(twin.name);
        twinPic.onerror = () => { twinPic.src = fallbackUrl(twin.name); };
    }

    const myNameEl   = document.getElementById('mirrorMyName');
    const twinNameEl = document.getElementById('mirrorTwinName');
    if (myNameEl)   myNameEl.textContent   = me.name   || 'You';
    if (twinNameEl) twinNameEl.textContent = twin.name || 'Twin';

    const myLogsEl   = document.getElementById('mirrorMyLogs');
    const twinLogsEl = document.getElementById('mirrorTwinLogs');
    if (myLogsEl)   myLogsEl.textContent   = `${me.log_count} logs (${days}d)`;
    if (twinLogsEl) twinLogsEl.textContent = `${twin.log_count} logs (${days}d)`;

    // Stat rows — NBA comparison style
    const stats = [
        { label: 'AVG CALORIES', myVal: me.avg_cal,     twinVal: twin.avg_cal,     unit: 'cal', higherIsBad: true  },
        { label: 'AVG PROTEIN',  myVal: me.avg_protein, twinVal: twin.avg_protein, unit: 'g',   higherIsBad: false },
        { label: 'AVG CARBS',    myVal: me.avg_carbs,   twinVal: twin.avg_carbs,   unit: 'g',   higherIsBad: null  },
        { label: 'AVG FAT',      myVal: me.avg_fat,     twinVal: twin.avg_fat,     unit: 'g',   higherIsBad: null  },
    ];

    const rowsEl = document.getElementById('mirrorStatRows');
    if (rowsEl) {
        rowsEl.innerHTML = stats.map(s => {
            const myBetter   = s.higherIsBad === null ? false : (s.higherIsBad ? s.myVal < s.twinVal : s.myVal > s.twinVal);
            const twinBetter = s.higherIsBad === null ? false : (s.higherIsBad ? s.twinVal < s.myVal  : s.twinVal > s.myVal);

            const maxVal   = Math.max(s.myVal, s.twinVal, 1);
            const myBarW   = Math.round((s.myVal   / maxVal) * 100);
            const twinBarW = Math.round((s.twinVal / maxVal) * 100);
            const unitStr  = s.unit === 'cal' ? '' : s.unit;

            return `
            <div class="mirror-stat-row">
                <div class="mirror-stat-side me-side">
                    <span class="mirror-stat-val ${myBetter ? 'winner-val' : ''}">${s.myVal.toLocaleString()}${unitStr}</span>
                    <div class="mirror-bar-track">
                        <div class="mirror-bar-fill me-bar ${myBetter ? 'winner-bar' : ''}" style="width:${myBarW}%"></div>
                    </div>
                </div>
                <div class="mirror-center-stat">${s.label}</div>
                <div class="mirror-stat-side twin-side">
                    <div class="mirror-bar-track">
                        <div class="mirror-bar-fill twin-bar ${twinBetter ? 'winner-bar-twin' : ''}" style="width:${twinBarW}%"></div>
                    </div>
                    <span class="mirror-stat-val ${twinBetter ? 'winner-val' : ''}">${s.twinVal.toLocaleString()}${unitStr}</span>
                </div>
            </div>`;
        }).join('');
    }

    // Shared foods
    const sharedEl = document.getElementById('mirrorSharedFoods');
    if (sharedEl) {
        if (!sharedFoods || sharedFoods.length === 0) {
            sharedEl.innerHTML = '<p style="color:var(--text-3);font-size:0.85rem;">No foods logged in common during this period.</p>';
        } else {
            sharedEl.innerHTML = sharedFoods.map((f, i) => `
                <div class="mirror-food-chip">
                    <span class="mirror-food-num">${i + 1}</span>
                    <span class="mirror-food-name">${f}</span>
                </div>
            `).join('');
        }
    }

    // Outcomes narrative
    const outEl = document.getElementById('mirrorOutcomes');
    if (outEl) {
        const avgCal = twin.avg_cal;
        const surplus = avgCal - 2000;
        let msg, cls;
        if (surplus > 300) {
            msg = `⚠️ This student is leaning towards a <strong>surplus</strong> (~${avgCal} cal/day). Could be a great model for a bulk.`;
            cls = 'outcome-warn';
        } else if (surplus < -300) {
            msg = `✅ This student maintains a <strong>deficit</strong> (~${avgCal} cal/day). Consistent with cutting body weight.`;
            cls = 'outcome-good';
        } else {
            msg = `⚖️ This student eats near <strong>maintenance</strong> (~${avgCal} cal/day). Good for a slow body recomposition.`;
            cls = 'outcome-neutral';
        }
        outEl.innerHTML = `<div class="mirror-outcome-badge ${cls}">${msg}</div>`;
    }

    // Peer Highlights
    renderMirrorHighlight();
}

function renderMirrorHighlight() {
    const highlightsEl = document.getElementById('mirrorHighlightsRow');
    if (!highlightsEl) return;
    const match = mirrorDataCache?.twins[currentTwinIndex];
    if (!match) return;

    if (match.twin.highlights && match.twin.highlights.length > 0) {
        
        const highlightCount = match.twin.highlights.length;
        currentHighlightIndex = currentHighlightIndex % highlightCount;
        const hl = match.twin.highlights[currentHighlightIndex];
        
        // Format nice date
        const dateStr = new Date(hl.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        
        let headerNav = '';
        if (highlightCount > 1) {
             headerNav = `
             <div style="display:flex; justify-content:space-between; align-items:center; background: var(--surface); padding: 4px 8px; margin-bottom: 12px; border-radius: 8px; border: 1px solid var(--border);">
                 <button class="btn" onclick="prevHighlight()" style="padding: 2px 10px; font-size: 0.95rem; background:transparent;"><i class="fa-solid fa-chevron-left"></i></button>
                 <span style="font-size: 0.72rem; font-weight: 800; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-2);">Highlight ${currentHighlightIndex + 1} of ${highlightCount}</span>
                 <button class="btn" onclick="nextHighlight()" style="padding: 2px 10px; font-size: 0.95rem; background:transparent;"><i class="fa-solid fa-chevron-right"></i></button>
             </div>
             `;
        }

        let hHtml = `
            ${headerNav}
            <div style="margin-bottom: 14px; background: var(--surface2); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 0.75rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-3);">${hl.title} • ${dateStr}</span>
                    <span style="font-size: 1rem; font-weight: 900; color: #10b981;">${hl.metricLabel}</span>
                </div>
                <div style="display: flex; gap: 15px; font-size: 0.82rem; font-weight: 700; color: var(--text-2);">
                    <span>${hl.total_cals.toLocaleString()} <span style="font-size: 0.65rem; color: var(--text-3);">CALS</span></span>
                    <span>${hl.total_protein}g <span style="font-size: 0.65rem; color: var(--text-3);">PRO</span></span>
                    <span>${hl.total_carbs}g <span style="font-size: 0.65rem; color: var(--text-3);">CARB</span></span>
                </div>
            </div>
        `;
        
        const meals = { breakfast: [], lunch: [], dinner: [], snack: [] };
        hl.logs.forEach(l => {
            const mt = (l.meal_type || 'snack').toLowerCase();
            if (meals[mt]) meals[mt].push(l);
        });
        
        const mealColors = { breakfast: 'var(--primary)', lunch: 'var(--green)', dinner: 'var(--amber)', snack: 'var(--purple, #8b5cf6)' };
        
        ['breakfast', 'lunch', 'dinner', 'snack'].forEach(m => {
           if (meals[m].length > 0) {
               hHtml += `<div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; font-weight: 900; text-transform: uppercase; margin: 14px 0 6px; color: ${mealColors[m]};">
                   <i class="fa-solid fa-circle" style="font-size: 0.4rem;"></i> ${m}
               </div>`;
               meals[m].forEach(l => {
                   hHtml += `
                   <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; padding: 6px 0; border-bottom: 1px dashed var(--border);">
                       <span style="font-weight: 600; color: var(--text); flex: 1; padding-right: 10px; line-height: 1.3;">${l.item_name}</span>
                       <div style="text-align: right; min-width: 60px;">
                           <div style="font-weight: 800; color: var(--primary);">${l.protein}g <span style="font-size: 0.65rem; color: var(--text-3); font-weight: 700;">PRO</span></div>
                           <div style="font-weight: 600; color: var(--text-3); font-size: 0.7rem;">${l.calories} cal</div>
                       </div>
                   </div>`;
               });
           }
        });
        
        highlightsEl.innerHTML = hHtml;
    } else {
         // Fallback Highlights (Fix 3)
         let fallbackHtml = '';
         for (let i = 0; i < 3; i++) {
             fallbackHtml += `
             <div style="margin-bottom: 12px; background: var(--surface2); padding: 16px; border-radius: var(--radius-sm); border: 1px dashed var(--border); opacity: 0.6; display: flex; align-items: center; gap: 12px;">
                 <i class="fa-solid fa-lock" style="font-size: 1.2rem; color: var(--text-3);"></i>
                 <div>
                     <div style="font-size: 0.8rem; font-weight: 800; color: var(--text-3); text-transform: uppercase; margin-bottom: 4px;">Locked Highlight</div>
                     <div style="font-size: 0.85rem; color: var(--text-2); font-weight: 600;">Log 7+ days to unlock real peer highlights.</div>
                 </div>
             </div>`;
         }
         highlightsEl.innerHTML = fallbackHtml;
    }
}

// ── Tradeoff Timeline (Day-level Optimization) ─────────────────────────
function renderTradeoffTimeline(logs, dailyGoal) {
    const container = document.getElementById('tradeoffTimelineContainer');
    if (!container) return;

    const consumed = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
    logs.forEach(l => {
        let mt = (l.meal_type || 'snack').toLowerCase();
        if (mt === 'brunch') mt = 'lunch';
        if (consumed[mt] !== undefined) {
            consumed[mt] += (l.calories || 0);
        } else {
            consumed.snack += (l.calories || 0);
        }
    });

    const totalConsumed = Object.values(consumed).reduce((a, b) => a + b, 0);
    const remaining = Math.max(0, dailyGoal - totalConsumed);

    const getPct = (cals) => (cals / dailyGoal) * 100;
    
    const bPct = getPct(consumed.breakfast);
    const lPct = getPct(consumed.lunch);
    const dPct = getPct(consumed.dinner);
    const sPct = getPct(consumed.snack);
    const rPct = Math.max(0, 100 - (bPct + lPct + dPct + sPct));

    const renderBlock = (meal, pct) => {
        if (pct <= 0) return '';
        return `
            <div class="bucket-fill ${meal}" style="width: ${pct}%" title="${meal.charAt(0).toUpperCase() + meal.slice(1)}">
                ${pct > 8 ? `<span>${Math.round(consumed[meal])}</span>` : ''}
            </div>
        `;
    };

    container.innerHTML = `
        <div class="bucket-track">
            ${renderBlock('breakfast', bPct)}
            ${renderBlock('lunch', lPct)}
            ${renderBlock('dinner', dPct)}
            ${renderBlock('snack', sPct)}
            <div class="bucket-remaining" style="width: ${rPct}%;">
                ${rPct > 15 ? `${Math.round(remaining)} LEFT` : ''}
            </div>
        </div>
        <div class="tradeoff-legend">
            ${totalConsumed > 0 ? `
                <div class="tradeoff-legend-item"><div class="tradeoff-dot" style="background:var(--primary);"></div>Breakfast</div>
                <div class="tradeoff-legend-item"><div class="tradeoff-dot" style="background:var(--green);"></div>Lunch</div>
                <div class="tradeoff-legend-item"><div class="tradeoff-dot" style="background:var(--amber);"></div>Dinner</div>
                <div class="tradeoff-legend-item"><div class="tradeoff-dot" style="background:var(--purple, #8b5cf6);"></div>Snack</div>
            ` : `<div style="color: var(--text-3); font-size: 0.85rem;">Log calories to see them fill up your bucket.</div>`}
        </div>
    `;

    document.getElementById('tradeoffTotal').textContent = Math.round(totalConsumed).toLocaleString();
}

// ── EXPERIMENTS ────────────────────────────────────

function openNewExperimentModal() {
    document.getElementById('newExperimentModal').classList.add('open');
}

function closeNewExperimentModal() {
    document.getElementById('newExperimentModal').classList.remove('open');
}

async function createNewExperiment() {
    const title = document.getElementById('expTitle').value;
    const durationDays = document.getElementById('expDuration').value;
    const startDate = trackingDate || todayStr();

    if (!title) {
        toast('Please enter a hypothesis or rule.');
        return;
    }

    const res = await authFetch(`${API}/api/user/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, durationDays, startDate })
    });

    if (res.ok) {
        closeNewExperimentModal();
        document.getElementById('expTitle').value = '';
        toast('Experiment Started!');
        fetchExperiments();
    }
}

async function fetchExperiments() {
    const res = await authFetch(`${API}/api/user/experiments`);
    const data = await res.json();
    renderExperiments(data.experiments || []);
}

function renderExperiments(experiments) {
    const list = document.getElementById('experimentsList');
    if (!experiments.length) {
        list.innerHTML = `
            <div class="card" style="padding: 20px; border: 2px dashed #cbd5e1; background: #f8fafc;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                    <div>
                        <div class="insight-eyebrow" style="margin-bottom: 5px; color: #64748b;"><i class="fa-solid fa-flask"></i> EXAMPLE</div>
                        <h3 style="margin: 0; font-size: 1.25rem; color: #475569;">7-Day High Protein Challenge — CONCLUDED</h3>
                        <p style="margin: 5px 0 0; font-size: 0.85rem; color: #94a3b8;">Started a week ago • 7 Day Trial</p>
                    </div>
                </div>
                <div style="background: rgba(0,0,0,0.03); border-radius: 8px; padding: 10px; color: #475569;">
                    <div style="font-weight: bold; margin-bottom: 8px; font-size: 0.85rem; text-transform: uppercase;">Results</div>
                    <div style="font-size: 0.9rem; line-height: 1.5;">
                        <span style="color: var(--green); font-weight: bold;">−0.9 lbs</span> (Weight: 164.0 → 163.1 lbs)<br>
                        Days on track: 6/7 (86%)<br>
                        Avg hunger: 2.4 / 5<br>
                        <div style="margin-top: 5px; font-style: italic;">"You stayed consistent. High protein reduced hunger by day 3."</div>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    list.innerHTML = experiments.map(exp => {
        const totalLogs = exp.logs.length;
        const remaining = Math.max(0, exp.duration_days - totalLogs);
        
        let logsHtml = exp.logs.map(log => {
            const consistencyColor = log.consistency == 1 ? 'var(--red)' : (log.consistency == 2 ? 'var(--gold)' : 'var(--green)');
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding: 8px 0; font-size: 0.85rem;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${consistencyColor};"></span>
                        <div>
                            <strong>${log.date}:</strong> ${log.notes || 'No notes'}
                            ${log.auto_calories != null ? `<div style="font-size: 0.75rem; color: var(--text-3); margin-top: 2px;">Today's logged calories: ${log.auto_calories.toLocaleString()}</div>` : ''}
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center; color: var(--text-2);">
                         <div>${log.weight ? log.weight + ' lbs | ' : ''} Hunger: ${log.hunger_level}/5</div>
                         <button class="btn btn-ghost" style="padding: 2px 6px; color: var(--text-3); font-size: 0.8rem;" onclick="deleteExperimentLog(${exp.id}, ${log.id})" title="Delete Log Entry">
                            <i class="fa-solid fa-trash-can"></i>
                         </button>
                    </div>
                </div>
            `;
        }).join('');

        if (exp.logs.length === 0) {
            logsHtml = `<div style="padding: 10px; color: var(--text-2); font-size: 0.9rem; font-style: italic;">No logs yet. Check in today!</div>`;
        }

        let summaryHtml = '';
        if (exp.status === 'concluded' && exp.summary) {
            const wDelta = exp.summary.weightDelta;
            const wColor = wDelta > 0 ? 'var(--red)' : (wDelta < 0 ? 'var(--green)' : 'var(--text)');
            const wSign = wDelta > 0 ? '+' : '';
            summaryHtml = `
                <div style="margin-top: 15px; background: rgba(0,0,0,0.03); border-radius: 8px; padding: 15px;">
                    <div style="font-weight: 800; font-size: 0.9rem; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em; color: var(--text-2);">Results</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; text-align: center; margin-bottom: 10px;">
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 800; color: ${wColor};">${wSign}${wDelta} lbs</div>
                            <div style="font-size: 0.7rem; color: var(--text-3); text-transform: uppercase;">Weight Change</div>
                        </div>
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 800;">${exp.summary.daysOnTrack}/${exp.duration_days}</div>
                            <div style="font-size: 0.7rem; color: var(--text-3); text-transform: uppercase;">Days On Track (${exp.summary.consistencyPct}%)</div>
                        </div>
                        <div>
                            <div style="font-size: 1.1rem; font-weight: 800;">${exp.summary.avgHunger} / 5</div>
                            <div style="font-size: 0.7rem; color: var(--text-3); text-transform: uppercase;">Avg Hunger</div>
                        </div>
                    </div>
                    <div style="font-style: italic; font-size: 0.85rem; color: var(--text-2); text-align: center;">
                        "You stayed consistent. High protein reduced hunger by day 3."
                    </div>
                </div>
            `;
        }

        return `
            <div class="card" style="padding: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                    <div>
                        <div class="insight-eyebrow" style="margin-bottom: 5px;"><i class="fa-solid fa-hourglass-half"></i> ${exp.status === 'concluded' ? 'CONCLUDED' : `${remaining} DAYS LEFT`}</div>
                        <h3 style="margin: 0; font-size: 1.25rem;">${exp.title}</h3>
                        <p style="margin: 5px 0 0; font-size: 0.85rem; color: var(--text-2);">Started ${exp.start_date} • ${exp.duration_days} Day Trial</p>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${exp.status !== 'concluded' ? `<button class="btn btn-primary btn-sm" onclick="openLogExperimentModal(${exp.id})" ${remaining === 0 ? 'disabled' : ''}>${remaining === 0 ? 'Done' : 'Log Today'}</button>` : ''}
                        <button class="btn btn-sm btn-ghost" style="color: var(--red); border: 1px solid rgba(239, 68, 68, 0.2);" onclick="deleteExperiment(${exp.id})" title="Delete Experiment">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <div style="background: rgba(0,0,0,0.02); border-radius: 8px; padding: 10px;">
                    <div style="font-weight: bold; margin-bottom: 8px; font-size: 0.85rem; text-transform: uppercase;">Experiment Data</div>
                    ${logsHtml}
                </div>
                ${summaryHtml}
            </div>
        `;
    }).join('');
}

function openLogExperimentModal(expId) {
    document.getElementById('logExpId').value = expId;
    document.getElementById('logExperimentModal').classList.add('open');
}

function closeLogExperimentModal() {
    document.getElementById('logExperimentModal').classList.remove('open');
}

async function submitExperimentLog() {
    const expId = document.getElementById('logExpId').value;
    const weight = document.getElementById('logExpWeight').value;
    const hunger = document.getElementById('logExpHunger').value;
    const consistency = document.getElementById('logExpConsistency').value;
    const notes = document.getElementById('logExpNotes').value;
    const date = trackingDate || todayStr();

    const res = await authFetch(`${API}/api/user/experiments/${expId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            date, 
            weight: weight ? parseFloat(weight) : null, 
            hungerLevel: parseInt(hunger), 
            consistency: parseInt(consistency), 
            notes 
        })
    });

    if (res.ok) {
        closeLogExperimentModal();
        toast('Experiment Data Logged!');
        fetchExperiments();
    }
}

async function deleteExperiment(id) {
    if (!confirm('Are you sure you want to delete this experiment and all its logs?')) return;
    
    const res = await authFetch(`${API}/api/user/experiments/${id}`, {
        method: 'DELETE'
    });
    
    if (res.ok) {
        toast('Experiment Deleted');
        fetchExperiments();
    } else {
        toast('Failed to delete experiment');
    }
}

async function deleteExperimentLog(expId, logId) {
    if (!confirm('Delete this log entry?')) return;
    
    const res = await authFetch(`${API}/api/user/experiments/${expId}/logs/${logId}`, {
        method: 'DELETE'
    });
    
    if (res.ok) {
        toast('Log Deleted');
        fetchExperiments();
    } else {
        toast('Failed to delete log');
    }
}

// ── SHAREABLE REPORT CARD ────────────────────────────

async function openReportCardModal(forcedLogs = null, forcedRangeStr = null, isSingleDay = false) {
    if (!currentUser) return;
    
    try {
        const date = trackingDate || todayStr();
        const logs = forcedLogs || (await fetchLogs(date)) || [];
        
        console.log('[ReportCard] Generating with logs count:', logs.length);
    
    // 1. Basic Info
    document.getElementById('reportUserName').textContent = (currentUser.name || 'STUDENT').toUpperCase();
    document.getElementById('reportMajor').textContent = (currentUser.major || 'GENERAL HEALTH').toUpperCase();
    
    // 2. Date Range
    if (forcedRangeStr) {
        document.getElementById('reportDateRange').textContent = forcedRangeStr;
    } else {
        const d = new Date(date + 'T12:00:00');
        const startStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
        document.getElementById('reportDateRange').textContent = `${startStr} - ${startStr}, 2026`;
    }
    
    // 3. GPA & Grades
    const calGoal = currentUser.calorie_goal || 2000;
    
    const totals = (logs || []).reduce((acc, l) => {
        acc.cal += (l.calories || 0);
        acc.p += (l.protein || 0);
        acc.f += (l.fat || 0);
        acc.c += (l.carbs || 0);
        return acc;
    }, { cal: 0, p: 0, f: 0, c: 0 });

    let totalPoints = 0;
    let totalWeight = 0;
    let nutritionScore = 0;
    let timingPenalty = 0;
    
    const gradedLogs = logs.map(l => {
        const { grade, points, isExam, examType } = calculateMealGrade(l, currentUser.major, l.logged_at);
        const weight = isExam ? 3 : 1;
        totalPoints += (points * weight);
        totalWeight += weight;
        nutritionScore += points;
        if (isExam) timingPenalty += 1;
        return { ...l, grade, points, isExam, examType };
    });

    // ── HONEST PERIOD CALCULATION ──
    // We calculate the GPA purely from the logs provided for this period.
    const finalGpaVal = totalWeight > 0 ? (totalPoints / totalWeight) : (parseFloat(currentUser.gpa) || 4.0);
    const finalGpaStr = finalGpaVal.toFixed(2);
    
    // Display GPA with animation
    const gpaEl = document.getElementById('reportGpaValue');
    animateGpaValue(gpaEl, 0, finalGpaVal, 1000);
    
    const gpaLetter = pointsToGrade(finalGpaVal);
    document.getElementById('reportGpaLetter').textContent = gpaLetter;
    
    // Status based on GPA
    let status = 'SATISFACTORY';
    if (finalGpaVal >= 3.8) status = "DEAN'S LIST";
    else if (finalGpaVal >= 3.4) status = 'HONOR ROLL';
    else if (finalGpaVal < 2.0) status = 'ACADEMIC PROBATION';
    document.getElementById('reportGpaStatus').textContent = status;
    
    // Trend Indicator
    const trendEl = document.getElementById('reportGpaTrend');
    const diffModal = finalGpaVal - (parseFloat(currentUser.gpa) || 3.42);
    
    if (Math.abs(diffModal) < 0.1) {
        trendEl.innerHTML = '<i class="fa-solid fa-graduation-cap"></i> PERFORMANCE STABLE';
        trendEl.style.color = '#333';
    } else if (diffModal > 0) {
        trendEl.innerHTML = '<i class="fa-solid fa-arrow-trend-up"></i> TRENDING ABOVE AVG';
        trendEl.style.color = '#166534';
    } else {
        trendEl.innerHTML = '<i class="fa-solid fa-arrow-trend-down"></i> TRENDING BELOW AVG';
        trendEl.style.color = '#991b1b';
    }
    
    // 4. Detailed Results
    const nutritionAvg = logs.length > 0 ? nutritionScore / logs.length : 4.0;
    const nutrGrade = pointsToGrade(nutritionAvg);
    document.getElementById('reportNutrResult').textContent = `${Math.round(Math.min(100, (nutritionAvg / 4) * 100))}/100`;
    document.getElementById('reportNutrGrade').textContent = nutrGrade;
    document.getElementById('reportNutrGrade').style.background = getGradeColor(nutrGrade);
    document.getElementById('reportNutrGrade').style.color = 'white';

    const timingGrade = timingPenalty > 1 ? 'D' : (timingPenalty > 0 ? 'B' : 'A');
    document.getElementById('reportTimingResult').textContent = timingPenalty > 0 ? `${timingPenalty} IRREGULARITY` : 'OPTIMAL';
    document.getElementById('reportTimingGrade').textContent = timingGrade;
    document.getElementById('reportTimingGrade').style.background = getGradeColor(timingGrade);
    document.getElementById('reportTimingGrade').style.color = 'white';

    const pGoal = currentUser.protein_goal || 100;
    const pDiff = Math.abs(totals.p - pGoal) / pGoal;
    const consGrade = pDiff < 0.15 ? 'A' : (pDiff < 0.3 ? 'B' : 'C');
    document.getElementById('reportConsResult').textContent = `±${Math.round(pDiff * 100)}% VAR`;
    document.getElementById('reportConsGrade').textContent = consGrade;
    document.getElementById('reportConsGrade').style.background = getGradeColor(consGrade);
    document.getElementById('reportConsGrade').style.color = 'white';

    const discGrade = finalGpaVal >= 3.0 ? 'A' : (finalGpaVal >= 2.0 ? 'B' : 'C');
    document.getElementById('reportDiscGrade').textContent = discGrade;
    document.getElementById('reportDiscGrade').style.background = getGradeColor(discGrade);
    document.getElementById('reportDiscGrade').style.color = 'white';

    // 5. Ledger (Key Events)
    const ledgerEl = document.getElementById('reportLedger');
    ledgerEl.innerHTML = gradedLogs.slice(0, 6).map(l => `
        <div class="ledger-item">
            <div class="ledger-time">${new Date(l.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="ledger-event">${(l.item_name || l.name || 'Meal').substring(0, 18)}</div>
            <div class="ledger-grade">${l.grade}</div>
        </div>
    `).join('') || '<div class="empty-extra" style="padding: 20px 0;">No activity logged today.</div>';

    // 6. Extra Credit (Smart Swaps)
    const extraEl = document.getElementById('reportExtraCredit');
    const produceItems = logs.filter(l => {
        const n = (l.item_name || l.name || '').toLowerCase();
        return n.includes('fruit') || n.includes('salad') || n.includes('broccoli') || n.includes('spinach') || n.includes('apple') || n.includes('banana');
    });
    
    if (produceItems.length > 0) {
        extraEl.innerHTML = produceItems.slice(0, 2).map(i => {
            const displayName = (i.item_name || i.name || 'Produce').toUpperCase();
            return `
            <div class="extra-item">
                <span class="extra-name">SWAP: ${displayName.substring(0, 22)}</span>
                <span class="extra-points">+0.05 GPA</span>
            </div>
            `;
        }).join('');
    } else if (finalGpaVal >= 3.5 && logs.length > 0) {
        extraEl.innerHTML = `
            <div class="extra-item">
                <span class="extra-name">ADHERENCE BONUS</span>
                <span class="extra-points">+0.10 GPA</span>
            </div>
        `;
    } else {
        extraEl.innerHTML = '<div class="empty-extra">No extra credit recorded this period.</div>';
    }

    // 7. Reflection
    const reflectionEl = document.getElementById('reportReflection');
    reflectionEl.textContent = generatePersonalReflection(finalGpaVal, timingPenalty, produceItems.length);

    // 8. ID
    document.getElementById('reportId').textContent = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Show Modal
    const backdrop = document.getElementById('reportCardModalBackdrop');
    if (backdrop) backdrop.style.display = 'flex';
    
    } catch (e) {
        console.error('[ReportCard] Error generating modal:', e);
        toast('Failed to load report card data.');
    }
}

async function openReportCardModalWithSettings() {
    if (!currentUser) return;
    const period = document.getElementById('reportPeriodSelect').value;
    const endDate = trackingDate || todayStr();
    let startDate = endDate;
    let rangeStr = "";

    toast('Analyzing Historical Trends...');

    if (period === 'max') {
        startDate = '2025-01-01'; 
        rangeStr = "ALL TIME HISTORY";
    } else {
        const days = parseInt(period);
        const d = new Date(endDate + 'T12:00:00');
        d.setDate(d.getDate() - (days - 1));
        startDate = formatDate(d);
    }

    try {
        const res = await authFetch(`${API}/api/user/logs-range?start=${startDate}&end=${endDate}`);
        const data = await res.json();
        const logs = data.logs || [];
        
        if (!rangeStr) {
            const s = new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
            const e = new Date(endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
            rangeStr = `${s} - ${e}, 2026`;
        }
        
        openReportCardModal(logs, rangeStr, (period === '1' || !period));
    } catch (e) {
        console.error(e);
        toast('Failed to fetch historical range.');
    }
}

function animateGpaValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.textContent = (progress * (end - start) + start).toFixed(2);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function getGradeColor(grade) {
    if (grade.startsWith('A')) return '#166534';
    if (grade.startsWith('B')) return '#1e40af';
    if (grade.startsWith('C')) return '#854d0e';
    return '#991b1b';
}

function generatePersonalReflection(gpa, timingPenalty, produceCount) {
    if (gpa >= 3.7) {
        return `"My consistency has been a major highlight this period. By prioritizing high-protein and nutrient-dense options, I've managed to stay well within my target zones while fueling effectively for my ${(currentUser.major || 'health').toLowerCase()} goals. The extra credit produce swaps are paying off."`;
    } else if (gpa >= 3.0) {
        let msg = `"I'm generally on the right track, but slight deviations in `;
        if (timingPenalty > 0) msg += 'meal timing and late-night intake ';
        else msg += 'macro balance ';
        msg += `are capping my performance potential. A few more smart swaps and tighter consistency in the afternoon will be key to reaching Dean's List status."`;
        return msg;
    } else {
        return `"This has been a challenging week for my nutritional habits. My ledger shows several entries that don't align with my ${(currentUser.major || 'health').toLowerCase()} major. I need to focus on logging higher quality whole foods and reducing late-night calorie spikes to recover my GPA."`;
    }
}

function closeReportCardModal() {
    document.getElementById('reportCardModalBackdrop').style.display = 'none';
}

function exportReportAsImage() {
    const element = document.getElementById('exportableReport');
    const originalShadow = element.style.boxShadow;
    element.style.boxShadow = 'none'; // Remove shadow for clean export
    
    toast('Preparing high-res snapshot...');
    
    html2canvas(element, {
        scale: 3, // Very high res for sharing
        useCORS: true,
        backgroundColor: '#fdfdfb',
        logging: false,
        onclone: (clonedDoc) => {
            // Ensure icons are visible in clone if needed
            const report = clonedDoc.getElementById('exportableReport');
            report.style.boxShadow = 'none';
        }
    }).then(canvas => {
        element.style.boxShadow = originalShadow;
        const link = document.createElement('a');
        link.download = `Mindful_Macros_Report_${new Date().toISOString().split('T')[0]}.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
        toast('Transcript downloaded! 🎓');
    }).catch(err => {
        console.error('Export failed', err);
        toast('Export failed. Try again.');
        element.style.boxShadow = originalShadow;
    });
}

// ── Station Navigation ──────────────────────────

function jumpToNextStation() {
    const stations = document.querySelectorAll('.station-block');
    if (!stations.length) return;
    
    const headerOffset = 100; // Account for sticky navbar and filter bar
    let currentIndex = -1;
    
    // Find current station index
    stations.forEach((s, i) => {
        const rect = s.getBoundingClientRect();
        if (rect.top <= headerOffset + 20) {
            currentIndex = i;
        }
    });

    let nextIndex = currentIndex + 1;
    
    // IF at the last one, do nothing (don't loop)
    if (nextIndex >= stations.length) {
        toast('End of menu');
        return;
    }
    
    const target = stations[nextIndex];
    const offsetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerOffset;
    
    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
}

function jumpToPrevStation() {
    const stations = document.querySelectorAll('.station-block');
    if (!stations.length) return;
    
    const headerOffset = 100;
    let currentIndex = -1;
    
    stations.forEach((s, i) => {
        const rect = s.getBoundingClientRect();
        if (rect.top <= headerOffset + 20) {
            currentIndex = i;
        }
    });

    // To go "Up":
    // If we're scrolled a bit into the current station, go to the top of THIS one first.
    // If we're already at the top of the current one, go to the previous one.
    if (currentIndex < 0) {
        toast('Top of menu');
        return;
    }

    const currentRect = stations[currentIndex].getBoundingClientRect();
    let prevIndex;
    
    if (currentRect.top < headerOffset - 15) {
        prevIndex = currentIndex;
    } else {
        prevIndex = currentIndex - 1;
    }

    if (prevIndex < 0) {
        toast('Top of menu');
        return;
    }
    
    const target = stations[prevIndex];
    const offsetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerOffset;
    
    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
}

// ── End of Mindful Macros Application Logic ──

