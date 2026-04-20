// Firebase configuration - Replace with your Firebase project config
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { 
    getAuth, 
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { 
    getFirestore, 
    collection, 
    doc, 
    setDoc, 
    getDoc, 
    getDocs, 
    deleteDoc,
    query, 
    where, 
    orderBy 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDXX6imI8m0RptM9YPbZGxKdE1543dQSQI",
    authDomain: "headache-tracker-md-2026.firebaseapp.com",
    projectId: "headache-tracker-md-2026",
    storageBucket: "headache-tracker-md-2026.firebasestorage.app",
    messagingSenderId: "434266145380",
    appId: "1:434266145380:web:cdfcc78be1996e0c2d5571"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// App State
let currentUser = null;
let useLocalStorage = false;
let entries = {};
let charts = {};
let isLoadingForm = false; // Flag to prevent auto-save during form population
let previousDate = null; // Track the previous date for saving before navigation

// DOM Elements
const authSection = document.getElementById('authSection');
const mainApp = document.getElementById('mainApp');
const authStatus = document.getElementById('authStatus');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authError = document.getElementById('authError');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');
const skipAuthBtn = document.getElementById('skipAuthBtn');
const headacheForm = document.getElementById('headacheForm');
const logDate = document.getElementById('logDate');
const entryStatus = document.getElementById('entryStatus');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeDatePicker();
    setupEventListeners();
    setupAuthStateListener();
    showBuildTime();
});

// Auth State Listener
function setupAuthStateListener() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            useLocalStorage = false;
            await loadEntriesFromFirestore();
            await loadThemePreference();
            await populateApiKeyField();
            await populateGarminFields();
            showMainApp();
            updateAuthStatus();
        } else if (useLocalStorage) {
            loadEntriesFromLocalStorage();
            loadThemePreference();
            populateApiKeyField();
            populateGarminFields();
            showMainApp();
            updateAuthStatus();
        }
    });
}

// Event Listeners
function setupEventListeners() {
    // Auth
    signInBtn.addEventListener('click', handleSignIn);
    signUpBtn.addEventListener('click', handleSignUp);
    document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
    document.getElementById('resetPasswordBtn').addEventListener('click', handleResetPassword);
    skipAuthBtn.addEventListener('click', handleSkipAuth);

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Date Navigation
    document.getElementById('prevDay').addEventListener('click', () => navigateDate(-1));
    document.getElementById('nextDay').addEventListener('click', () => navigateDate(1));
    document.getElementById('todayBtn').addEventListener('click', goToToday);
    logDate.addEventListener('change', async () => {
        // Save any pending changes to the PREVIOUS date before switching
        if (saveTimeout && previousDate) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
            await forceSaveForDate(previousDate);
        }
        await loadEntryForDate(logDate.value);
    });

    // Form
    document.getElementById('clearBtn').addEventListener('click', clearForm);

    // Auto-save on any form input change
    headacheForm.querySelectorAll('input, textarea').forEach(input => {
        input.addEventListener('change', autoSave);
    });

    // Text inputs - auto-save after 5 seconds of no typing
    headacheForm.querySelectorAll('input[type="text"], textarea').forEach(input => {
        let textTimeout = null;
        input.addEventListener('input', () => {
            if (textTimeout) clearTimeout(textTimeout);
            textTimeout = setTimeout(autoSave, 5000);
        });
    });

    // Range inputs - update display values and auto-save
    document.querySelectorAll('input[type="range"]').forEach(input => {
        input.addEventListener('input', (e) => {
            e.target.nextElementSibling.textContent = e.target.value;
            autoSave();
        });
    });

    // Stepper buttons for medication inputs
    document.querySelectorAll('.stepper-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepper = e.target.closest('.stepper');
            const input = stepper.querySelector('input[type="number"]');
            const min = parseInt(input.min) || 0;
            const max = parseInt(input.max) || 99;
            let value = parseInt(input.value) || 0;
            
            if (btn.classList.contains('plus') && value < max) {
                input.value = value + 1;
            } else if (btn.classList.contains('minus') && value > min) {
                input.value = value - 1;
            }
            
            autoSave();
        });
    });

    // History
    document.getElementById('historyMonth').addEventListener('change', () => loadHistory(false));
    document.getElementById('showAllHistory').addEventListener('click', () => loadHistory(true));

    // Charts
    document.getElementById('chartRange').addEventListener('change', renderCharts);
    document.getElementById('refreshCharts').addEventListener('click', renderCharts);
    document.getElementById('rollingAvgSlider').addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        document.getElementById('rollingAvgValue').textContent = val;
        document.getElementById('rollingAvgPlural').textContent = val > 1 ? 's' : '';
        renderCharts();
    });

    // Export
    document.getElementById('exportCSV').addEventListener('click', exportCSV);
    document.getElementById('exportReport').addEventListener('click', exportReport);
    document.getElementById('exportJSON').addEventListener('click', exportJSON);
    document.getElementById('importBtn').addEventListener('click', importJSON);

    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const theme = e.currentTarget.dataset.theme;
            setTheme(theme);
        });
    });

    // AI Analysis
    document.getElementById('saveApiKeyBtn').addEventListener('click', async () => {
        const key = document.getElementById('anthropicApiKey').value.trim();
        await saveApiKey(key);
        showToast(key ? 'API key saved' : 'API key cleared', 'success');
    });
    document.getElementById('generateAnalysisBtn').addEventListener('click', generateAIAnalysis);

    // Garmin
    document.getElementById('saveGarminBtn').addEventListener('click', async () => {
        const username = document.getElementById('garminUsername').value.trim();
        const password = document.getElementById('garminPassword').value;
        await saveGarminCredentials(username, password);
        garminCredsCache = { username, password };
        garminLinked = !!(username && password);
        updateGarminPanel();
        updateGarminConnectUI();
        showToast(username ? 'Garmin credentials saved' : 'Garmin credentials cleared', 'success');
    });
    document.getElementById('syncGarminBtn').addEventListener('click', syncGarminData);
    document.getElementById('syncGarminAllBtn').addEventListener('click', syncGarminMissingDays);
    // Food log
    document.getElementById('addMealManualBtn').addEventListener('click', async () => {
        const date = logDate.value;
        if (!date) { showToast('Please select a date first', 'error'); return; }
        const container = document.getElementById('foodLogEntries');

        // Guess meal type from time of day
        // Load history and show suggestions
        const allHistory = await loadAllFoodHistory();
        showFoodAddPanel(date, mealTypeFromTime(), allHistory, container);
    });

    document.getElementById('foodPhotoInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = ''; // allow same file again
        const date = logDate.value;
        if (!date) { showToast('Please select a date first', 'error'); return; }
        await handleFoodPhoto(file, date);
    });

    // Food Checker
    let foodCheckerTimer = null;
    let foodCheckerLastQuery = '';
    const foodCheckerEl = document.getElementById('foodCheckerInput');
    const triggerFoodCheck = () => {
        clearTimeout(foodCheckerTimer);
        const val = foodCheckerEl.value.trim();
        const scoreEl = document.getElementById('foodCheckerScore');
        const altEl = document.getElementById('foodCheckerAlt');
        if (!val) { scoreEl.innerHTML = ''; altEl.innerHTML = ''; altEl.classList.remove('visible'); foodCheckerLastQuery = ''; return; }
        if (val === foodCheckerLastQuery) return;
        foodCheckerLastQuery = val;
        scoreEl.innerHTML = '<span class="food-checker-spinner"></span>';
        altEl.innerHTML = '';
        altEl.classList.remove('visible');
        checkFoodHistamine(val);
    };
    foodCheckerEl.addEventListener('input', () => {
        clearTimeout(foodCheckerTimer);
        const val = foodCheckerEl.value.trim();
        const scoreEl = document.getElementById('foodCheckerScore');
        const altEl = document.getElementById('foodCheckerAlt');
        if (!val) { scoreEl.innerHTML = ''; altEl.innerHTML = ''; altEl.classList.remove('visible'); foodCheckerLastQuery = ''; return; }
        foodCheckerTimer = setTimeout(triggerFoodCheck, 4000);
    });
    foodCheckerEl.addEventListener('blur', triggerFoodCheck);

    document.getElementById('copyGarminCmd').addEventListener('click', () => {
        const cmd = document.getElementById('garminCommand').textContent;
        navigator.clipboard.writeText(cmd).then(() => {
            const btn = document.getElementById('copyGarminCmd');
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy', 2000);
        });
    });
}

// Auth Handlers
async function handleSignIn() {
    const email = authEmail.value.trim();
    const password = authPassword.value;
    
    if (!email || !password) {
        showAuthError('Please enter email and password');
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    }
}

async function handleResetPassword() {
    const email = authEmail.value.trim();
    if (!email) {
        showAuthError('Please enter your email address first');
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        authError.style.color = '#34A853';
        authError.textContent = 'Password reset email sent! Check your inbox.';
        setTimeout(() => {
            authError.textContent = '';
            authError.style.color = '';
        }, 5000);
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    }
}

async function handleSignUp() {
    const email = authEmail.value.trim();
    const password = authPassword.value;
    
    if (!email || !password) {
        showAuthError('Please enter email and password');
        return;
    }

    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters');
        return;
    }

    try {
        await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    }
}

async function handleGoogleSignIn() {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    }
}

function handleSkipAuth() {
    useLocalStorage = true;
    currentUser = null;
    loadEntriesFromLocalStorage();
    populateApiKeyField();
    populateGarminFields();
    showMainApp();
    updateAuthStatus();
}

async function handleSignOut() {
    if (currentUser) {
        await signOut(auth);
    }
    currentUser = null;
    useLocalStorage = false;
    entries = {};
    authSection.style.display = 'flex';
    mainApp.style.display = 'none';
    authStatus.innerHTML = '';
}

function showAuthError(message) {
    authError.textContent = message;
    setTimeout(() => authError.textContent = '', 5000);
}

function getAuthErrorMessage(code) {
    const messages = {
        'auth/invalid-email': 'Invalid email address',
        'auth/user-disabled': 'This account has been disabled',
        'auth/user-not-found': 'No account found with this email',
        'auth/wrong-password': 'Incorrect password',
        'auth/email-already-in-use': 'An account already exists with this email',
        'auth/weak-password': 'Password is too weak',
        'auth/invalid-credential': 'Invalid email or password'
    };
    return messages[code] || 'An error occurred. Please try again.';
}

function showMainApp() {
    authSection.style.display = 'none';
    mainApp.style.display = 'block';
    // Re-apply garmin panel visibility now that mainApp is visible in the DOM
    updateGarminPanel();
    loadEntryForDate(logDate.value);
}

function updateAuthStatus() {
    if (currentUser) {
        authStatus.innerHTML = `
            Signed in as <strong>${currentUser.email}</strong>
            <button id="signOutBtn">Sign Out</button>
        `;
        document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
    } else if (useLocalStorage) {
        authStatus.innerHTML = `
            Using local storage only
            <button id="signOutBtn">Switch Account</button>
        `;
        document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
    }
}

// Date Functions
function initializeDatePicker() {
    const today = new Date().toISOString().split('T')[0];
    logDate.value = today;
    document.getElementById('historyMonth').value = today.substring(0, 7);
    
    // Set export date range defaults
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    document.getElementById('exportFrom').value = thirtyDaysAgo.toISOString().split('T')[0];
    document.getElementById('exportTo').value = today;
}

async function navigateDate(days) {
    // Save any pending changes for current date before switching
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
        await forceSaveForDate(previousDate || logDate.value);
    }
    
    const current = new Date(logDate.value);
    current.setDate(current.getDate() + days);
    logDate.value = current.toISOString().split('T')[0];
    await loadEntryForDate(logDate.value);
}

async function goToToday() {
    // Save any pending changes for current date before switching
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
        await forceSaveForDate(previousDate || logDate.value);
    }
    
    logDate.value = new Date().toISOString().split('T')[0];
    await loadEntryForDate(logDate.value);
}

// Tab Navigation
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });

    if (tabId === 'history') loadHistory();
    if (tabId === 'charts') renderCharts();
}

// Data Storage - Firestore
async function loadEntriesFromFirestore() {
    try {
        const entriesRef = collection(db, 'users', currentUser.uid, 'entries');
        const snapshot = await getDocs(entriesRef);
        entries = {};
        snapshot.forEach(doc => {
            entries[doc.id] = doc.data();
        });
    } catch (error) {
        console.error('Error loading entries:', error);
        showToast('Error loading data', 'error');
    }
}

async function saveEntryToFirestore(date, data) {
    // Update local cache first for immediate feedback
    entries[date] = data;
    
    try {
        const entryRef = doc(db, 'users', currentUser.uid, 'entries', date);
        await setDoc(entryRef, { ...data, updatedAt: new Date().toISOString() });
    } catch (error) {
        console.error('Error saving entry to Firestore:', error);
        // Revert local cache on error
        delete entries[date];
        throw error;
    }
}

async function deleteEntryFromFirestore(date) {
    try {
        const entryRef = doc(db, 'users', currentUser.uid, 'entries', date);
        await deleteDoc(entryRef);
        delete entries[date];
    } catch (error) {
        console.error('Error deleting entry:', error);
        showToast('Error deleting data', 'error');
        throw error;
    }
}

// Data Storage - Local Storage
function loadEntriesFromLocalStorage() {
    const stored = localStorage.getItem('headacheTracker_entries');
    entries = stored ? JSON.parse(stored) : {};
}

function saveEntryToLocalStorage(date, data) {
    entries[date] = data;
    localStorage.setItem('headacheTracker_entries', JSON.stringify(entries));
}

function deleteEntryFromLocalStorage(date) {
    delete entries[date];
    localStorage.setItem('headacheTracker_entries', JSON.stringify(entries));
}

// Save/Load Entry
async function saveEntry(date, data) {
    if (currentUser) {
        await saveEntryToFirestore(date, data);
    } else {
        saveEntryToLocalStorage(date, data);
    }
}

async function deleteEntry(date) {
    if (currentUser) {
        await deleteEntryFromFirestore(date);
    } else {
        deleteEntryFromLocalStorage(date);
    }
}

async function loadEntryForDate(date) {
    // Clear any pending auto-save timeout (saving handled by caller before date change)
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    
    // Clear auto-save status
    const statusEl = document.getElementById('autoSaveStatus');
    if (statusEl) statusEl.textContent = '';
    
    const entry = entries[date];
    
    // Set flag to prevent auto-save during form population
    isLoadingForm = true;
    
    if (entry) {
        entryStatus.textContent = '✓ Entry exists for this date';
        entryStatus.className = 'entry-status exists';
        populateForm(entry);
    } else {
        entryStatus.textContent = 'No entry for this date - create one below';
        entryStatus.className = 'entry-status new';
        clearForm();
    }
    
    // Update previousDate to track what date we're currently on
    previousDate = date;
    
    // Re-enable auto-save after a short delay
    setTimeout(() => {
        isLoadingForm = false;
    }, 100);

    // Show cached Garmin data for this date
    displayGarminData(date);
    // Load food log for this date
    renderFoodLog(date);
}

function populateForm(entry) {
    const form = headacheForm;
    
    // Pain levels
    form.painLevel.value = entry.painLevel || 0;
    form.peakPain.value = entry.peakPain || 0;
    
    // Symptoms
    form.tinnitus.value = entry.tinnitus || 0;
    form.ocular.value = entry.ocular || 0;
    form.querySelector('[name="sleepIssues"]').value = entry.sleepIssues || 0;
    
    // Medications
    form.paracetamol.value = entry.paracetamol || 0;
    form.ibuprofen.value = entry.ibuprofen || 0;
    form.aspirin.value = entry.aspirin || 0;
    form.triptan.value = entry.triptan || 0;
    form.ice.value = entry.ice || entry.codeine || 0;
    form.otherMeds.value = entry.otherMeds || '';
    
    // Additional
    form.triggers.value = entry.triggers || '';
    form.notes.value = entry.notes || '';
    // Auto-expand notes textarea to fit content
    const notesEl = form.notes;
    notesEl.style.height = 'auto';
    notesEl.style.height = notesEl.scrollHeight + 'px';

    // Update range display values
    form.querySelectorAll('input[type="range"]').forEach(input => {
        input.nextElementSibling.textContent = input.value;
    });
}

function clearForm() {
    headacheForm.reset();
    headacheForm.querySelectorAll('input[type="range"]').forEach(input => {
        input.nextElementSibling.textContent = '0';
    });
}

// Force save form to a specific date (used when changing dates)
async function forceSaveForDate(date) {
    if (!date) return;
    
    const form = headacheForm;
    
    const data = {
        date,
        painLevel: parseInt(form.painLevel.value) || 0,
        peakPain: parseInt(form.peakPain.value) || 0,
        tinnitus: parseInt(form.tinnitus.value) || 0,
        ocular: parseInt(form.ocular.value) || 0,
        sleepIssues: parseInt(form.querySelector('[name="sleepIssues"]').value) || 0,
        paracetamol: parseInt(form.paracetamol.value) || 0,
        ibuprofen: parseInt(form.ibuprofen.value) || 0,
        aspirin: parseInt(form.aspirin.value) || 0,
        triptan: parseInt(form.triptan.value) || 0,
        ice: parseInt(form.ice.value) || 0,
        otherMeds: form.otherMeds.value.trim(),
        triggers: form.triggers.value.trim(),
        notes: form.notes.value.trim()
    };

    try {
        await saveEntry(date, data);
    } catch (error) {
        console.error('Force save error:', error);
    }
}

// Force save current form (legacy - uses logDate.value)
async function forceSaveCurrentForm() {
    await forceSaveForDate(logDate.value);
}

// Auto-save with debouncing
let saveTimeout = null;
function autoSave() {
    // Don't auto-save during form population
    if (isLoadingForm) return;
    
    // Debounce saves to avoid too many requests
    if (saveTimeout) clearTimeout(saveTimeout);
    
    const statusEl = document.getElementById('autoSaveStatus');
    statusEl.textContent = 'Saving...';
    statusEl.className = 'auto-save-status saving';
    
    saveTimeout = setTimeout(async () => {
        const form = headacheForm;
        const date = logDate.value;
        
        const data = {
            date,
            painLevel: parseInt(form.painLevel.value) || 0,
            peakPain: parseInt(form.peakPain.value) || 0,
            tinnitus: parseInt(form.tinnitus.value) || 0,
            ocular: parseInt(form.ocular.value) || 0,
            sleepIssues: parseInt(form.querySelector('[name="sleepIssues"]').value) || 0,
            paracetamol: parseInt(form.paracetamol.value) || 0,
            ibuprofen: parseInt(form.ibuprofen.value) || 0,
            aspirin: parseInt(form.aspirin.value) || 0,
            triptan: parseInt(form.triptan.value) || 0,
            ice: parseInt(form.ice.value) || 0,
            otherMeds: form.otherMeds.value.trim(),
            triggers: form.triggers.value.trim(),
            notes: form.notes.value.trim()
        };

        try {
            await saveEntry(date, data);
            statusEl.textContent = '✓ Saved';
            statusEl.className = 'auto-save-status saved';
            entryStatus.textContent = '✓ Entry exists for this date';
            entryStatus.className = 'entry-status exists';
            
            // Clear status after 2 seconds
            setTimeout(() => {
                statusEl.textContent = '';
            }, 2000);
        } catch (error) {
            console.error('Auto-save error:', error);
            statusEl.textContent = '✗ Save failed';
            statusEl.className = 'auto-save-status error';
        }
    }, 500);
}

// History
async function loadHistory(showAll = false) {
    const historyList = document.getElementById('historyList');
    const monthFilter = document.getElementById('historyMonth').value;

    let filteredEntries = Object.entries(entries);

    if (!showAll && monthFilter) {
        filteredEntries = filteredEntries.filter(([date]) => date.startsWith(monthFilter));
    }

    filteredEntries.sort((a, b) => new Date(b[0]) - new Date(a[0]));

    if (filteredEntries.length === 0) {
        historyList.innerHTML = '<div class="no-entries">No entries found for this period</div>';
        return;
    }

    // Pre-load Garmin + food data for all dates in parallel
    const dates = filteredEntries.map(([date]) => date);
    await Promise.all(dates.map(async date => {
        if (garminLinked && garminCache[date] === undefined) {
            garminCache[date] = await loadGarminDayData(date);
        }
        if (histamineCache[date] === undefined) {
            const meals = await loadFoodEntries(date);
            histamineCache[date] = meals.length > 0 ? { score: computeDailyHistamine(meals), meals } : null;
        }
    }));

    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    historyList.innerHTML = filteredEntries.map(([date, entry]) => {
        const g = garminLinked ? garminCache[date] : null;
        const food = histamineCache[date];

        const garminHtml = g ? (() => {
            const parts = [];
            if (g.steps != null) parts.push(`<span class="metric"><label>Steps:</label> ${g.steps.toLocaleString()}</span>`);
            if (g.sleepHours != null) parts.push(`<span class="metric"><label>Sleep:</label> ${g.sleepHours}h</span>`);
            if (g.sleepScore != null) parts.push(`<span class="metric"><label>Sleep Score:</label> ${g.sleepScore}</span>`);
            if (g.restingHR != null) parts.push(`<span class="metric"><label>Resting HR:</label> ${g.restingHR} bpm</span>`);
            if (g.maxHR != null) parts.push(`<span class="metric"><label>Max HR:</label> ${g.maxHR} bpm</span>`);
            if (g.hrv != null) parts.push(`<span class="metric"><label>HRV:</label> ${g.hrv} ms</span>`);
            if (g.avgStress != null) parts.push(`<span class="metric"><label>Avg Stress:</label> ${g.avgStress}</span>`);
            if (g.maxStress != null) parts.push(`<span class="metric"><label>Max Stress:</label> ${g.maxStress}</span>`);
            if (g.bodyBatteryHigh != null) parts.push(`<span class="metric"><label>Body Battery:</label> ${g.bodyBatteryLow ?? '?'}–${g.bodyBatteryHigh}</span>`);
            if (parts.length === 0) return '';
            return `<div class="history-section"><h4>Garmin</h4><div class="history-metrics">${parts.join('')}</div></div>`;
        })() : '';

        const foodHtml = food ? (() => {
            const dayScore = food.score;
            const scoreColor = dayScore == null ? '#aaa' : dayScore >= 3 ? '#e74c3c' : dayScore >= 2 ? '#e67e22' : dayScore >= 1 ? '#f1c40f' : '#27ae60';
            const mealLines = (food.meals || []).map(m => {
                const h = typeof m.histamine_score === 'number' ? m.histamine_score : null;
                const badge = h != null ? `<span style="font-weight:600;color:${h >= 3 ? '#e74c3c' : h >= 2 ? '#e67e22' : h >= 1 ? '#f1c40f' : '#27ae60'}"> H:${h}/4</span>` : '';
                const cal = m.estimated_calories ? ` · ${m.estimated_calories} kcal` : '';
                return `<div class="food-history-meal"><span class="food-meal-type">${esc(m.mealType || 'meal')}</span> ${esc(m.description || '')}${badge}${cal}</div>`;
            }).join('');
            return `<div class="history-section history-section-full"><h4>Food & Histamine ${dayScore != null ? `<span style="color:${scoreColor};font-weight:600">(day: ${dayScore.toFixed(1)}/4)</span>` : ''}</h4><div class="food-history-meals">${mealLines}</div></div>`;
        })() : '';

        return `
        <div class="history-item" data-date="${date}">
            <div class="history-header">
                <div class="history-date">${formatDate(date)}</div>
                <div class="history-actions">
                    <button class="edit-btn" onclick="editEntry('${date}')">Edit</button>
                    <button class="delete-btn" onclick="confirmDelete('${date}')">Delete</button>
                </div>
            </div>
            <div class="history-grid">
                <div class="history-section">
                    <h4>Pain Levels</h4>
                    <div class="history-metrics">
                        <span class="metric"><label>Overall:</label> ${entry.painLevel}/4</span>
                        <span class="metric"><label>Peak:</label> ${entry.peakPain}/4</span>
                    </div>
                </div>
                <div class="history-section">
                    <h4>Symptoms</h4>
                    <div class="history-metrics">
                        <span class="metric"><label>Tinnitus:</label> ${entry.tinnitus || 0}/4</span>
                        <span class="metric"><label>Ocular:</label> ${entry.ocular || 0}/4</span>
                        <span class="metric"><label>Sleep:</label> ${entry.sleepIssues || 0}/4</span>
                    </div>
                </div>
                <div class="history-section">
                    <h4>Medications</h4>
                    <div class="history-metrics">
                        ${entry.paracetamol ? `<span class="metric"><label>Paracetamol:</label> ${entry.paracetamol}</span>` : ''}
                        ${entry.ibuprofen ? `<span class="metric"><label>Ibuprofen:</label> ${entry.ibuprofen}</span>` : ''}
                        ${entry.aspirin ? `<span class="metric"><label>Aspirin:</label> ${entry.aspirin}</span>` : ''}
                        ${entry.triptan ? `<span class="metric"><label>Sumatriptan:</label> ${entry.triptan}</span>` : ''}
                        ${(entry.ice || entry.codeine) ? `<span class="metric"><label>Ice:</label> ${(entry.ice || entry.codeine)}</span>` : ''}
                        ${entry.otherMeds ? `<span class="metric"><label>Other:</label> ${entry.otherMeds}</span>` : ''}
                        ${!entry.paracetamol && !entry.ibuprofen && !entry.aspirin && !entry.triptan && !(entry.ice || entry.codeine) && !entry.otherMeds ? '<span class="metric none">None</span>' : ''}
                    </div>
                </div>
                ${garminHtml}
            </div>
            ${foodHtml}
            ${entry.triggers || entry.notes ? `
            <div class="history-notes">
                ${entry.triggers ? `<div class="history-note"><label>Triggers:</label> ${esc(entry.triggers)}</div>` : ''}
                ${entry.notes ? `<div class="history-note"><label>Notes:</label> ${esc(entry.notes)}</div>` : ''}
            </div>
            ` : ''}
        </div>`;
    }).join('');
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getTotalMeds(entry) {
    return (entry.paracetamol || 0) + (entry.ibuprofen || 0) + 
           (entry.aspirin || 0) + (entry.triptan || 0) + ((entry.ice || entry.codeine) || 0);
}

window.editEntry = function(date) {
    logDate.value = date;
    loadEntryForDate(date);
    switchTab('log');
};

window.confirmDelete = async function(date) {
    if (confirm(`Delete entry for ${formatDate(date)}?`)) {
        try {
            await deleteEntry(date);
            showToast('Entry deleted', 'success');
            loadHistory();
        } catch (error) {
            showToast('Failed to delete entry', 'error');
        }
    }
};

// Charts
async function renderCharts() {
    const range = document.getElementById('chartRange').value;
    const data = getChartData(range);

    // Pre-load garmin data for all dates in range
    if (garminLinked) {
        const dates = data.dates.map((_, i) => {
            const e = Object.entries(entries).sort((a, b) => new Date(a[0]) - new Date(b[0]));
            // recover original date strings from filtered entries
            return null;
        });
        // Use the raw date keys instead
        const rawDates = Object.keys(entries).sort();
        const filteredRaw = range === 'all' ? rawDates : (() => {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - parseInt(range));
            return rawDates.filter(d => new Date(d) >= cutoff);
        })();
        await Promise.all(filteredRaw.map(async date => {
            if (garminCache[date] === undefined) {
                garminCache[date] = await loadGarminDayData(date);
            }
        }));
    }

    // Pre-load food histamine scores for all dates in range
    const rawDatesForFood = Object.keys(entries).sort();
    const filteredRawForFood = range === 'all' ? rawDatesForFood : (() => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - parseInt(range));
        return rawDatesForFood.filter(d => new Date(d) >= cutoff);
    })();
    await Promise.all(filteredRawForFood.map(async date => {
        if (histamineCache[date] === undefined) {
            const meals = await loadFoodEntries(date);
            histamineCache[date] = meals.length > 0 ? { score: computeDailyHistamine(meals), meals } : null;
        }
    }));

    renderCombinedChart(data);
    renderStats(data);
    renderTrends();
    renderAIReportHistory();
}

function getChartData(range) {
    let filteredEntries = Object.entries(entries);
    let calendarDays = 0;

    if (range !== 'all') {
        const days = parseInt(range);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        filteredEntries = filteredEntries.filter(([date]) => new Date(date) >= cutoff);
        calendarDays = days;
    } else {
        // For 'all time', calculate days from earliest entry to today
        if (filteredEntries.length > 0) {
            const sortedDates = filteredEntries.map(([date]) => new Date(date)).sort((a, b) => a - b);
            const earliest = sortedDates[0];
            const today = new Date();
            calendarDays = Math.ceil((today - earliest) / (1000 * 60 * 60 * 24)) + 1;
        }
    }

    filteredEntries.sort((a, b) => new Date(a[0]) - new Date(b[0]));

    return {
        dates: filteredEntries.map(([date]) => formatDate(date)),
        rawDates: filteredEntries.map(([date]) => date),
        entries: filteredEntries.map(([, entry]) => entry),
        garmin: filteredEntries.map(([date]) => garminCache[date] || null),
        histamine: filteredEntries.map(([date]) => histamineCache[date]?.score ?? null),
        calendarDays: calendarDays
    };
}

function renderChartLegend(chart) {
    const legendContainer = document.getElementById('chartLegend');
    if (!legendContainer) return;

    const datasets = chart.data.datasets;
    legendContainer.innerHTML = datasets.map((dataset, index) => {
        // Check the dataset's hidden property (initial state) since meta.hidden is null initially
        const isHidden = dataset.hidden === true;
        const color = dataset.borderColor || dataset.backgroundColor;
        const isBar = dataset.type === 'bar';
        return `
            <button class="legend-item ${isHidden ? 'hidden' : ''}" data-index="${index}">
                <span class="legend-color" style="background: ${color}; ${isBar ? 'border-radius: 2px;' : 'border-radius: 50%;'}"></span>
                <span class="legend-label">${dataset.label}</span>
            </button>
        `;
    }).join('');

    // Add click handlers
    legendContainer.querySelectorAll('.legend-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            const dataset = chart.data.datasets[index];
            const meta = chart.getDatasetMeta(index);

            // Toggle visibility - if meta.hidden is null, use the dataset's hidden property
            const currentlyHidden = meta.hidden === null ? dataset.hidden : meta.hidden;
            meta.hidden = !currentlyHidden;

            // Update button state to match - hidden data = greyed out button
            item.classList.toggle('hidden', meta.hidden);
            chart.update();
        });
    });
}

function applyRollingAverage(values, window) {
    if (window <= 1) return values;
    return values.map((_, i) => {
        const start = Math.max(0, i - window + 1);
        const slice = values.slice(start, i + 1).filter(v => v != null);
        if (slice.length === 0) return null;
        return parseFloat((slice.reduce((sum, v) => sum + v, 0) / slice.length).toFixed(2));
    });
}

function renderCombinedChart(data) {
    const ctx = document.getElementById('combinedChart').getContext('2d');
    const avgWindow = parseInt(document.getElementById('rollingAvgSlider').value) || 1;

    // Preserve dataset visibility state before destroying
    let hiddenState = null;
    if (charts.combined) {
        hiddenState = charts.combined.data.datasets.map((ds, i) => {
            const meta = charts.combined.getDatasetMeta(i);
            return meta.hidden === null ? !!ds.hidden : meta.hidden;
        });
        charts.combined.destroy();
    }

    // Calculate max medication value for dynamic Y axis
    const maxMeds = Math.max(
        ...data.entries.map(e => 
            (e.paracetamol || 0) + (e.ibuprofen || 0) + (e.aspirin || 0) + (e.triptan || 0) + ((e.ice || e.codeine) || 0)
        ),
        1
    );
    const medsAxisMax = Math.ceil(maxMeds * 1.2); // Add 20% headroom
    
    charts.combined = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.dates,
            datasets: [
                // Pain levels (lines)
                {
                    label: 'Overall Pain',
                    data: applyRollingAverage(data.entries.map(e => e.painLevel), avgWindow),
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    fill: false,
                    tension: 0.3,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1
                },
                {
                    label: 'Peak Pain',
                    data: applyRollingAverage(data.entries.map(e => e.peakPain), avgWindow),
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    fill: false,
                    tension: 0.3,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1
                },
                // Symptoms (lines)
                {
                    label: 'Tinnitus',
                    data: applyRollingAverage(data.entries.map(e => e.tinnitus), avgWindow),
                    borderColor: '#f39c12',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1
                },
                {
                    label: 'Ocular',
                    data: applyRollingAverage(data.entries.map(e => e.ocular), avgWindow),
                    borderColor: '#9b59b6',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1
                },
                {
                    label: 'Sleep Issues',
                    data: applyRollingAverage(data.entries.map(e => e.sleepIssues), avgWindow),
                    borderColor: '#27ae60',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1
                },
                {
                    label: 'Histamine Score',
                    data: applyRollingAverage(data.histamine, avgWindow),
                    borderColor: '#ff6f00',
                    backgroundColor: 'rgba(255, 111, 0, 0.1)',
                    fill: false,
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1,
                    spanGaps: false
                },
                // Medications (stacked bars)
                {
                    label: 'Paracetamol',
                    data: applyRollingAverage(data.entries.map(e => e.paracetamol || 0), avgWindow),
                    backgroundColor: 'rgba(52, 152, 219, 0.8)',
                    borderColor: '#3498db',
                    borderWidth: 1,
                    hidden: true,
                    yAxisID: 'y2',
                    type: 'bar',
                    stack: 'medications',
                    order: 2
                },
                {
                    label: 'Ibuprofen',
                    data: applyRollingAverage(data.entries.map(e => e.ibuprofen || 0), avgWindow),
                    backgroundColor: 'rgba(230, 126, 34, 0.8)',
                    borderColor: '#e67e22',
                    borderWidth: 1,
                    hidden: true,
                    yAxisID: 'y2',
                    type: 'bar',
                    stack: 'medications',
                    order: 2
                },
                {
                    label: 'Aspirin',
                    data: applyRollingAverage(data.entries.map(e => e.aspirin || 0), avgWindow),
                    backgroundColor: 'rgba(26, 188, 156, 0.8)',
                    borderColor: '#1abc9c',
                    borderWidth: 1,
                    hidden: true,
                    yAxisID: 'y2',
                    type: 'bar',
                    stack: 'medications',
                    order: 2
                },
                {
                    label: 'Sumatriptan',
                    data: applyRollingAverage(data.entries.map(e => e.triptan || 0), avgWindow),
                    backgroundColor: 'rgba(142, 68, 173, 0.8)',
                    borderColor: '#8e44ad',
                    borderWidth: 1,
                    hidden: true,
                    yAxisID: 'y2',
                    type: 'bar',
                    stack: 'medications',
                    order: 2
                },
                {
                    label: 'Ice',
                    data: applyRollingAverage(data.entries.map(e => (e.ice || e.codeine) || 0), avgWindow),
                    backgroundColor: 'rgba(0, 188, 212, 0.8)',
                    borderColor: '#00bcd4',
                    borderWidth: 1,
                    hidden: true,
                    yAxisID: 'y2',
                    type: 'bar',
                    stack: 'medications',
                    order: 2
                },
                // Garmin datasets (hidden by default, use y3 axis)
                {
                    label: 'Sleep (hrs)',
                    data: applyRollingAverage(data.garmin.map(g => g?.sleepHours ?? null), avgWindow),
                    borderColor: '#5c6bc0',
                    backgroundColor: 'rgba(92, 107, 192, 0.1)',
                    fill: false,
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y3',
                    type: 'line',
                    order: 1,
                    spanGaps: false
                },
                {
                    label: 'Resting HR',
                    data: applyRollingAverage(data.garmin.map(g => g?.restingHR ?? null), avgWindow),
                    borderColor: '#ef5350',
                    backgroundColor: 'rgba(239, 83, 80, 0.1)',
                    fill: false,
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y3',
                    type: 'line',
                    order: 1,
                    spanGaps: false
                },
                {
                    label: 'Avg Stress',
                    data: applyRollingAverage(data.garmin.map(g => g?.avgStress ?? null), avgWindow),
                    borderColor: '#ff7043',
                    backgroundColor: 'rgba(255, 112, 67, 0.1)',
                    fill: false,
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y3',
                    type: 'line',
                    order: 1,
                    spanGaps: false
                },
                {
                    label: 'Body Battery Hi',
                    data: applyRollingAverage(data.garmin.map(g => g?.bodyBatteryHigh ?? null), avgWindow),
                    borderColor: '#66bb6a',
                    backgroundColor: 'rgba(102, 187, 106, 0.1)',
                    fill: false,
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y3',
                    type: 'line',
                    order: 1,
                    spanGaps: false
                },
                {
                    label: 'Body Battery Lo',
                    data: applyRollingAverage(data.garmin.map(g => g?.bodyBatteryLow ?? null), avgWindow),
                    borderColor: '#26a69a',
                    backgroundColor: 'rgba(38, 166, 154, 0.1)',
                    fill: false,
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y3',
                    type: 'line',
                    order: 1,
                    spanGaps: false
                },
                {
                    label: 'HRV (ms)',
                    data: applyRollingAverage(data.garmin.map(g => g?.hrv ?? null), avgWindow),
                    borderColor: '#ab47bc',
                    backgroundColor: 'rgba(171, 71, 188, 0.1)',
                    fill: false,
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y3',
                    type: 'line',
                    order: 1,
                    spanGaps: false
                },
                {
                    label: 'Steps (100s)',
                    data: applyRollingAverage(data.garmin.map(g => g?.steps != null ? Math.round(g.steps / 100) : null), avgWindow),
                    borderColor: '#8d6e63',
                    backgroundColor: 'rgba(141, 110, 99, 0.1)',
                    fill: false,
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y3',
                    type: 'line',
                    order: 1,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: 4,
                    title: {
                        display: true,
                        text: 'Pain/Symptoms (0-4)'
                    }
                },
                y2: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: medsAxisMax,
                    title: {
                        display: true,
                        text: 'Medication Doses (stacked)'
                    },
                    grid: {
                        drawOnChartArea: false
                    },
                    stacked: true
                },
                y3: {
                    type: 'linear',
                    display: 'auto',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Garmin Metrics'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                },
                x: {
                    stacked: true
                }
            }
        }
    });

    // Restore dataset visibility state
    if (hiddenState) {
        hiddenState.forEach((isHidden, i) => {
            if (i < charts.combined.data.datasets.length) {
                charts.combined.data.datasets[i].hidden = isHidden;
            }
        });
        charts.combined.update('none');
    }

    // Render custom legend
    renderChartLegend(charts.combined);
}

function renderStats(data) {
    const statsPanel = document.getElementById('statsPanel');

    if (data.calendarDays === 0) {
        statsPanel.innerHTML = '<div class="no-entries">No data for this period</div>';
        return;
    }

    // Use calendar days for percentage calculations (days with no records count as 0)
    const totalDays = data.calendarDays;

    // Calculate average pain across all calendar days (missing days = 0)
    const totalPain = data.entries.reduce((sum, e) => sum + e.painLevel, 0);
    const avgPain = (totalPain / totalDays).toFixed(1);

    const maxPain = data.entries.length > 0 ? Math.max(...data.entries.map(e => e.peakPain)) : 0;
    const totalMeds = data.entries.reduce((sum, e) => sum + getTotalMeds(e), 0);
    const daysWithPain = data.entries.filter(e => e.painLevel > 0).length;
    const daysWithTinnitus = data.entries.filter(e => (e.tinnitus || 0) > 0).length;
    const daysWithOcular = data.entries.filter(e => (e.ocular || 0) > 0).length;
    const daysWithSleep = data.entries.filter(e => (e.sleepIssues || 0) > 0).length;

    // Count distinct days with painkillers (Paracetamol, Ibuprofen, Aspirin, Sumatriptan - not Ice or Other)
    const daysWithPainkillers = data.entries.filter(e =>
        (e.paracetamol || 0) > 0 ||
        (e.ibuprofen || 0) > 0 ||
        (e.aspirin || 0) > 0 ||
        (e.triptan || 0) > 0
    ).length;

    // Count distinct days with pain relief (Painkillers + Ice)
    const daysWithPainRelief = data.entries.filter(e =>
        (e.paracetamol || 0) > 0 ||
        (e.ibuprofen || 0) > 0 ||
        (e.aspirin || 0) > 0 ||
        (e.triptan || 0) > 0 ||
        ((e.ice || e.codeine) || 0) > 0
    ).length;

    // Calculate averages for all metrics (over calendar days, treating missing as 0)
    const avgPeakPain = (data.entries.reduce((sum, e) => sum + (e.peakPain || 0), 0) / totalDays).toFixed(1);
    const avgTinnitus = (data.entries.reduce((sum, e) => sum + (e.tinnitus || 0), 0) / totalDays).toFixed(1);
    const avgOcular = (data.entries.reduce((sum, e) => sum + (e.ocular || 0), 0) / totalDays).toFixed(1);
    const avgSleep = (data.entries.reduce((sum, e) => sum + (e.sleepIssues || 0), 0) / totalDays).toFixed(1);

    statsPanel.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">Calendar Days</span>
            <span class="stat-value">${totalDays}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Days Logged</span>
            <span class="stat-value">${data.entries.length} (${((data.entries.length/totalDays)*100).toFixed(0)}%)</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Days with Headache</span>
            <span class="stat-value">${daysWithPain} (${((daysWithPain/totalDays)*100).toFixed(0)}%)</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Days with Tinnitus</span>
            <span class="stat-value">${daysWithTinnitus} (${((daysWithTinnitus/totalDays)*100).toFixed(0)}%)</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Days with Ocular</span>
            <span class="stat-value">${daysWithOcular} (${((daysWithOcular/totalDays)*100).toFixed(0)}%)</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Days with Sleep Issues</span>
            <span class="stat-value">${daysWithSleep} (${((daysWithSleep/totalDays)*100).toFixed(0)}%)</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Total Medication Doses</span>
            <span class="stat-value">${totalMeds}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Days of Painkillers</span>
            <span class="stat-value">${daysWithPainkillers} (${((daysWithPainkillers/totalDays)*100).toFixed(0)}%)</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Days of Pain Relief</span>
            <span class="stat-value">${daysWithPainRelief} (${((daysWithPainRelief/totalDays)*100).toFixed(0)}%)</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Average Pain Level</span>
            <span class="stat-value">${avgPain}/4</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Average Peak Pain</span>
            <span class="stat-value">${avgPeakPain}/4</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Highest Pain Level</span>
            <span class="stat-value">${maxPain}/4</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Average Tinnitus</span>
            <span class="stat-value">${avgTinnitus}/4</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Average Ocular</span>
            <span class="stat-value">${avgOcular}/4</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Average Sleep Issues</span>
            <span class="stat-value">${avgSleep}/4</span>
        </div>
    `;
}

function getStatsForPeriod(startDaysAgo, endDaysAgo) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - startDaysAgo);
    endDate.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - endDaysAgo);
    startDate.setHours(23, 59, 59, 999);

    const periodEntries = Object.entries(entries)
        .filter(([date]) => {
            const d = new Date(date);
            return d >= endDate && d <= startDate;
        })
        .map(([, entry]) => entry);

    const calendarDays = startDaysAgo - endDaysAgo;

    if (calendarDays === 0) return null;

    const daysLogged = periodEntries.length;
    const daysWithPain = periodEntries.filter(e => e.painLevel > 0).length;
    const daysWithTinnitus = periodEntries.filter(e => (e.tinnitus || 0) > 0).length;
    const daysWithOcular = periodEntries.filter(e => (e.ocular || 0) > 0).length;
    const daysWithSleep = periodEntries.filter(e => (e.sleepIssues || 0) > 0).length;
    const totalMeds = periodEntries.reduce((sum, e) => sum + getTotalMeds(e), 0);

    const daysWithPainkillers = periodEntries.filter(e =>
        (e.paracetamol || 0) > 0 ||
        (e.ibuprofen || 0) > 0 ||
        (e.aspirin || 0) > 0 ||
        (e.triptan || 0) > 0
    ).length;

    const daysWithPainRelief = periodEntries.filter(e =>
        (e.paracetamol || 0) > 0 ||
        (e.ibuprofen || 0) > 0 ||
        (e.aspirin || 0) > 0 ||
        (e.triptan || 0) > 0 ||
        ((e.ice || e.codeine) || 0) > 0
    ).length;

    const avgPain = periodEntries.reduce((sum, e) => sum + (e.painLevel || 0), 0) / calendarDays;
    const avgPeakPain = periodEntries.reduce((sum, e) => sum + (e.peakPain || 0), 0) / calendarDays;
    const maxPain = periodEntries.length > 0 ? Math.max(...periodEntries.map(e => e.peakPain || 0)) : 0;
    const avgTinnitus = periodEntries.reduce((sum, e) => sum + (e.tinnitus || 0), 0) / calendarDays;
    const avgOcular = periodEntries.reduce((sum, e) => sum + (e.ocular || 0), 0) / calendarDays;
    const avgSleep = periodEntries.reduce((sum, e) => sum + (e.sleepIssues || 0), 0) / calendarDays;

    return {
        calendarDays,
        daysLogged,
        daysLoggedPct: (daysLogged / calendarDays) * 100,
        daysWithPain,
        daysWithPainPct: (daysWithPain / calendarDays) * 100,
        daysWithTinnitus,
        daysWithTinnitusPct: (daysWithTinnitus / calendarDays) * 100,
        daysWithOcular,
        daysWithOcularPct: (daysWithOcular / calendarDays) * 100,
        daysWithSleep,
        daysWithSleepPct: (daysWithSleep / calendarDays) * 100,
        totalMeds,
        daysWithPainkillers,
        daysWithPainkillersPct: (daysWithPainkillers / calendarDays) * 100,
        daysWithPainRelief,
        daysWithPainReliefPct: (daysWithPainRelief / calendarDays) * 100,
        avgPain,
        avgPeakPain,
        maxPain,
        avgTinnitus,
        avgOcular,
        avgSleep
    };
}

function formatTrendChange(current, previous, isPercentage = false, lowerIsBetter = true) {
    if (previous === 0 && current === 0) {
        return '<span class="trend-change same"><span class="trend-arrow">-</span></span>';
    }

    let pctChange;
    if (previous === 0) {
        pctChange = current > 0 ? 100 : 0;
    } else {
        pctChange = ((current - previous) / previous) * 100;
    }

    const roundedPct = Math.round(pctChange);
    const absRounded = Math.abs(roundedPct);

    if (roundedPct === 0) {
        return '<span class="trend-change same"><span class="trend-arrow">-</span></span>';
    }

    const isUp = roundedPct > 0;
    const isBetter = lowerIsBetter ? !isUp : isUp;
    const cssClass = isBetter ? 'down' : 'up';
    const arrow = isUp ? '▲' : '▼';
    const sign = isUp ? '+' : '';

    return `<span class="trend-change ${cssClass}"><span class="trend-arrow">${arrow}</span>${sign}${roundedPct}%</span>`;
}

function renderTrends() {
    const trendsPanel = document.getElementById('trendsPanel');

    const period1 = getStatsForPeriod(30, 0);   // 0-30 days ago
    const period2 = getStatsForPeriod(60, 30);  // 31-60 days ago
    const period3 = getStatsForPeriod(90, 60);  // 61-90 days ago

    if (!period1 || !period2 || !period3) {
        trendsPanel.innerHTML = '<div class="no-entries">Not enough data for trend analysis (requires 90 days of history)</div>';
        return;
    }

    const rows = [
        {
            label: 'Days Logged',
            p1: `${period1.daysLogged} (${period1.daysLoggedPct.toFixed(0)}%)`,
            p2: `${period2.daysLogged} (${period2.daysLoggedPct.toFixed(0)}%)`,
            p3: `${period3.daysLogged} (${period3.daysLoggedPct.toFixed(0)}%)`,
            v1: period1.daysLoggedPct, v2: period2.daysLoggedPct, v3: period3.daysLoggedPct,
            lowerIsBetter: false
        },
        {
            label: 'Days with Headache',
            p1: `${period1.daysWithPain} (${period1.daysWithPainPct.toFixed(0)}%)`,
            p2: `${period2.daysWithPain} (${period2.daysWithPainPct.toFixed(0)}%)`,
            p3: `${period3.daysWithPain} (${period3.daysWithPainPct.toFixed(0)}%)`,
            v1: period1.daysWithPainPct, v2: period2.daysWithPainPct, v3: period3.daysWithPainPct,
            lowerIsBetter: true
        },
        {
            label: 'Days with Tinnitus',
            p1: `${period1.daysWithTinnitus} (${period1.daysWithTinnitusPct.toFixed(0)}%)`,
            p2: `${period2.daysWithTinnitus} (${period2.daysWithTinnitusPct.toFixed(0)}%)`,
            p3: `${period3.daysWithTinnitus} (${period3.daysWithTinnitusPct.toFixed(0)}%)`,
            v1: period1.daysWithTinnitusPct, v2: period2.daysWithTinnitusPct, v3: period3.daysWithTinnitusPct,
            lowerIsBetter: true
        },
        {
            label: 'Days with Ocular',
            p1: `${period1.daysWithOcular} (${period1.daysWithOcularPct.toFixed(0)}%)`,
            p2: `${period2.daysWithOcular} (${period2.daysWithOcularPct.toFixed(0)}%)`,
            p3: `${period3.daysWithOcular} (${period3.daysWithOcularPct.toFixed(0)}%)`,
            v1: period1.daysWithOcularPct, v2: period2.daysWithOcularPct, v3: period3.daysWithOcularPct,
            lowerIsBetter: true
        },
        {
            label: 'Days with Sleep Issues',
            p1: `${period1.daysWithSleep} (${period1.daysWithSleepPct.toFixed(0)}%)`,
            p2: `${period2.daysWithSleep} (${period2.daysWithSleepPct.toFixed(0)}%)`,
            p3: `${period3.daysWithSleep} (${period3.daysWithSleepPct.toFixed(0)}%)`,
            v1: period1.daysWithSleepPct, v2: period2.daysWithSleepPct, v3: period3.daysWithSleepPct,
            lowerIsBetter: true
        },
        {
            label: 'Total Medication Doses',
            p1: `${period1.totalMeds}`,
            p2: `${period2.totalMeds}`,
            p3: `${period3.totalMeds}`,
            v1: period1.totalMeds, v2: period2.totalMeds, v3: period3.totalMeds,
            lowerIsBetter: true
        },
        {
            label: 'Days of Painkillers',
            p1: `${period1.daysWithPainkillers} (${period1.daysWithPainkillersPct.toFixed(0)}%)`,
            p2: `${period2.daysWithPainkillers} (${period2.daysWithPainkillersPct.toFixed(0)}%)`,
            p3: `${period3.daysWithPainkillers} (${period3.daysWithPainkillersPct.toFixed(0)}%)`,
            v1: period1.daysWithPainkillersPct, v2: period2.daysWithPainkillersPct, v3: period3.daysWithPainkillersPct,
            lowerIsBetter: true
        },
        {
            label: 'Days of Pain Relief',
            p1: `${period1.daysWithPainRelief} (${period1.daysWithPainReliefPct.toFixed(0)}%)`,
            p2: `${period2.daysWithPainRelief} (${period2.daysWithPainReliefPct.toFixed(0)}%)`,
            p3: `${period3.daysWithPainRelief} (${period3.daysWithPainReliefPct.toFixed(0)}%)`,
            v1: period1.daysWithPainReliefPct, v2: period2.daysWithPainReliefPct, v3: period3.daysWithPainReliefPct,
            lowerIsBetter: true
        },
        {
            label: 'Average Pain Level',
            p1: `${period1.avgPain.toFixed(1)}/4`,
            p2: `${period2.avgPain.toFixed(1)}/4`,
            p3: `${period3.avgPain.toFixed(1)}/4`,
            v1: period1.avgPain, v2: period2.avgPain, v3: period3.avgPain,
            lowerIsBetter: true
        },
        {
            label: 'Average Peak Pain',
            p1: `${period1.avgPeakPain.toFixed(1)}/4`,
            p2: `${period2.avgPeakPain.toFixed(1)}/4`,
            p3: `${period3.avgPeakPain.toFixed(1)}/4`,
            v1: period1.avgPeakPain, v2: period2.avgPeakPain, v3: period3.avgPeakPain,
            lowerIsBetter: true
        },
        {
            label: 'Highest Pain Level',
            p1: `${period1.maxPain}/4`,
            p2: `${period2.maxPain}/4`,
            p3: `${period3.maxPain}/4`,
            v1: period1.maxPain, v2: period2.maxPain, v3: period3.maxPain,
            lowerIsBetter: true
        },
        {
            label: 'Average Tinnitus',
            p1: `${period1.avgTinnitus.toFixed(1)}/4`,
            p2: `${period2.avgTinnitus.toFixed(1)}/4`,
            p3: `${period3.avgTinnitus.toFixed(1)}/4`,
            v1: period1.avgTinnitus, v2: period2.avgTinnitus, v3: period3.avgTinnitus,
            lowerIsBetter: true
        },
        {
            label: 'Average Ocular',
            p1: `${period1.avgOcular.toFixed(1)}/4`,
            p2: `${period2.avgOcular.toFixed(1)}/4`,
            p3: `${period3.avgOcular.toFixed(1)}/4`,
            v1: period1.avgOcular, v2: period2.avgOcular, v3: period3.avgOcular,
            lowerIsBetter: true
        },
        {
            label: 'Average Sleep Issues',
            p1: `${period1.avgSleep.toFixed(1)}/4`,
            p2: `${period2.avgSleep.toFixed(1)}/4`,
            p3: `${period3.avgSleep.toFixed(1)}/4`,
            v1: period1.avgSleep, v2: period2.avgSleep, v3: period3.avgSleep,
            lowerIsBetter: true
        }
    ];

    trendsPanel.innerHTML = `
        <table class="trends-table">
            <thead>
                <tr>
                    <th>Metric</th>
                    <th>0-30 days</th>
                    <th>31-60 days</th>
                    <th>61-90 days</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        <td>${row.label}</td>
                        <td>
                            <div class="trend-cell">
                                <span class="trend-value">${row.p1}</span>
                                ${formatTrendChange(row.v1, row.v2, false, row.lowerIsBetter)}
                            </div>
                        </td>
                        <td>
                            <div class="trend-cell">
                                <span class="trend-value">${row.p2}</span>
                                ${formatTrendChange(row.v2, row.v3, false, row.lowerIsBetter)}
                            </div>
                        </td>
                        <td>
                            <div class="trend-cell">
                                <span class="trend-value">${row.p3}</span>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// Export Functions
async function exportCSV() {
    const fromDate = document.getElementById('exportFrom').value;
    const toDate = document.getElementById('exportTo').value;

    let filteredEntries = Object.entries(entries)
        .filter(([date]) => date >= fromDate && date <= toDate)
        .sort((a, b) => new Date(a[0]) - new Date(b[0]));

    if (filteredEntries.length === 0) {
        showToast('No entries in selected date range', 'error');
        return;
    }

    const btn = document.getElementById('exportCSV');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Exporting...';

    try {
        // Pre-load garmin + food data for all dates in range
        const dates = filteredEntries.map(([d]) => d);
        await Promise.all(dates.map(async date => {
            if (garminCache[date] === undefined) garminCache[date] = await loadGarminDayData(date);
            if (histamineCache[date] === undefined) {
                const meals = await loadFoodEntries(date);
                histamineCache[date] = meals.length > 0 ? { score: computeDailyHistamine(meals), meals } : null;
            }
        }));

        const csvQuote = (v) => {
            if (v == null || v === '') return '';
            const s = String(v);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const headers = [
            'Date', 'Pain Level', 'Peak Pain', 'Tinnitus', 'Ocular', 'Sleep Issues',
            'Paracetamol', 'Ibuprofen', 'Aspirin', 'Sumatriptan', 'Ice', 'Other Meds',
            'Triggers', 'Notes',
            'Garmin Steps', 'Garmin Sleep Hrs', 'Garmin Sleep Score', 'Garmin Resting HR',
            'Garmin Max HR', 'Garmin HRV', 'Garmin Avg Stress', 'Garmin Max Stress',
            'Garmin Body Battery Hi', 'Garmin Body Battery Lo',
            'Histamine Score', 'Meals'
        ];

        const rows = filteredEntries.map(([date, e]) => {
            const g = garminCache[date] || {};
            const food = histamineCache[date];
            const mealSummary = food?.meals?.map(m => {
                const h = typeof m.histamine_score === 'number' ? ` H:${m.histamine_score}` : '';
                return `${m.mealType || 'meal'}: ${m.description || ''}${h}`;
            }).join('; ') || '';

            return [
                date, e.painLevel, e.peakPain, e.tinnitus || 0, e.ocular || 0, e.sleepIssues || 0,
                e.paracetamol || 0, e.ibuprofen || 0, e.aspirin || 0, e.triptan || 0,
                (e.ice || e.codeine) || 0, csvQuote(e.otherMeds || ''), csvQuote(e.triggers || ''), csvQuote(e.notes || ''),
                g.steps ?? '', g.sleepHours ?? '', g.sleepScore ?? '', g.restingHR ?? '',
                g.maxHR ?? '', g.hrv ?? '', g.avgStress ?? '', g.maxStress ?? '',
                g.bodyBatteryHigh ?? '', g.bodyBatteryLow ?? '',
                food?.score != null ? food.score.toFixed(1) : '', csvQuote(mealSummary)
            ];
        });

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        downloadFile(csv, `headache-log-${fromDate}-to-${toDate}.csv`, 'text/csv');
        showToast('CSV exported successfully', 'success');
    } catch (e) {
        showToast('CSV export failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = origText;
    }
}

function exportReport() {
    // Create date range popup
    const popup = document.createElement('div');
    popup.className = 'modal-overlay';
    popup.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <h3 style="margin-bottom: 15px;">📅 Select Report Date Range</h3>
            <div style="display: grid; gap: 15px;">
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 500;">From Date:</label>
                    <input type="date" id="reportFromDate" class="export-input" style="width: 100%;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 500;">To Date:</label>
                    <input type="date" id="reportToDate" class="export-input" style="width: 100%;">
                </div>
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <button id="cancelReportBtn" class="btn" style="flex: 1; background: #6c757d;">Cancel</button>
                    <button id="generateReportBtn" class="btn btn-primary" style="flex: 1;">Generate Report</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(popup);
    
    // Set default dates (last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    document.getElementById('reportFromDate').value = thirtyDaysAgo.toISOString().split('T')[0];
    document.getElementById('reportToDate').value = today.toISOString().split('T')[0];
    
    // Handle cancel
    document.getElementById('cancelReportBtn').onclick = () => popup.remove();
    popup.onclick = (e) => { if (e.target === popup) popup.remove(); };
    
    // Handle generate
    document.getElementById('generateReportBtn').onclick = () => {
        const fromDate = document.getElementById('reportFromDate').value;
        const toDate = document.getElementById('reportToDate').value;
        popup.remove();
        generateReportWithDates(fromDate, toDate);
    };
}

function generateReportWithDates(fromDate, toDate) {
    let filteredEntries = Object.entries(entries)
        .filter(([date]) => date >= fromDate && date <= toDate)
        .sort((a, b) => new Date(a[0]) - new Date(b[0]));
    
    if (filteredEntries.length === 0) {
        showToast('No entries in selected date range', 'error');
        return;
    }
    
    const data = { dates: filteredEntries.map(([d]) => d), entries: filteredEntries.map(([,e]) => e) };
    
    const avgPain = (data.entries.reduce((sum, e) => sum + e.painLevel, 0) / data.entries.length).toFixed(1);
    const maxPain = Math.max(...data.entries.map(e => e.peakPain));
    const totalMeds = data.entries.reduce((sum, e) => sum + getTotalMeds(e), 0);
    const daysWithPain = data.entries.filter(e => e.painLevel > 0).length;
    const daysWithPainkillers = data.entries.filter(e => 
        (e.paracetamol || 0) + (e.ibuprofen || 0) + (e.aspirin || 0) + (e.triptan || 0) > 0
    ).length;
    
    // Prepare chart data
    const chartLabels = JSON.stringify(data.dates);
    const painData = JSON.stringify(data.entries.map(e => e.painLevel));
    const peakData = JSON.stringify(data.entries.map(e => e.peakPain));
    const tinnitusData = JSON.stringify(data.entries.map(e => e.tinnitus));
    const ocularData = JSON.stringify(data.entries.map(e => e.ocular));
    const sleepData = JSON.stringify(data.entries.map(e => e.sleepIssues));
    const paracetamolData = JSON.stringify(data.entries.map(e => e.paracetamol || 0));
    const ibuprofenData = JSON.stringify(data.entries.map(e => e.ibuprofen || 0));
    const aspirinData = JSON.stringify(data.entries.map(e => e.aspirin || 0));
    const triptanData = JSON.stringify(data.entries.map(e => e.triptan || 0));
    const iceData = JSON.stringify(data.entries.map(e => (e.ice || e.codeine) || 0));
    
    // Calculate max stacked meds for dynamic axis
    const maxStackedMeds = Math.max(
        ...data.entries.map(e => 
            (e.paracetamol || 0) + (e.ibuprofen || 0) + (e.aspirin || 0) + (e.triptan || 0) + ((e.ice || e.codeine) || 0)
        ),
        1
    );
    const medsAxisMax = Math.ceil(maxStackedMeds * 1.2);
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Headache Report ${fromDate} to ${toDate}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
        h1 { color: #667eea; }
        h2 { color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px; margin-top: 30px; }
        .summary { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .stat { text-align: center; }
        .stat-value { font-size: 2rem; color: #667eea; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 0.9rem; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #667eea; color: white; }
        tr:nth-child(even) { background: #f8f9fa; }
        .notes-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .chart-container { background: white; padding: 20px; border-radius: 10px; margin: 20px 0; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        @media print {
            .chart-container { break-inside: avoid; }
        }
    </style>
</head>
<body>
    <h1>🧠 Headache Report</h1>
    <p><strong>Period:</strong> ${fromDate} to ${toDate}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
    
    <div class="summary">
        <h2 style="margin-top: 0; border: none;">Summary Statistics</h2>
        <div class="summary-grid">
            <div class="stat">
                <div class="stat-value">${data.entries.length}</div>
                <div>Total Days Logged</div>
            </div>
            <div class="stat">
                <div class="stat-value">${daysWithPain}</div>
                <div>Days with Headache</div>
            </div>
            <div class="stat">
                <div class="stat-value">${avgPain}</div>
                <div>Avg Pain Level (0-4)</div>
            </div>
            <div class="stat">
                <div class="stat-value">${maxPain}</div>
                <div>Max Pain Level</div>
            </div>
            <div class="stat">
                <div class="stat-value">${totalMeds}</div>
                <div>Total Medication Doses</div>
            </div>
            <div class="stat">
                <div class="stat-value">${daysWithPainkillers}</div>
                <div>Days with Painkillers</div>
            </div>
        </div>
    </div>
    
    <h2>Pain & Symptoms Trend</h2>
    <div class="chart-container">
        <canvas id="painSymptomsChart"></canvas>
    </div>
    
    <h2>Medications (Stacked)</h2>
    <div class="chart-container">
        <canvas id="medicationsChart"></canvas>
    </div>
    
    <h2>Daily Log</h2>
    <table>
        <tr>
            <th>Date</th>
            <th>Pain</th>
            <th>Peak</th>
            <th>Medications</th>
            <th>Triggers</th>
            <th>Notes</th>
        </tr>
        ${filteredEntries.map(([date, e]) => `
        <tr>
            <td>${date}</td>
            <td>${e.painLevel}/4</td>
            <td>${e.peakPain}/4</td>
            <td>${getMedsSummary(e)}</td>
            <td>${e.triggers || '-'}</td>
            <td class="notes-cell" title="${(e.notes || '').replace(/"/g, '&quot;')}">${e.notes || '-'}</td>
        </tr>
        `).join('')}
    </table>
    
    <script>
        // Pain & Symptoms Chart
        new Chart(document.getElementById('painSymptomsChart'), {
            type: 'line',
            data: {
                labels: ${chartLabels},
                datasets: [
                    {
                        label: 'Overall Pain',
                        data: ${painData},
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        fill: false,
                        tension: 0.3
                    },
                    {
                        label: 'Peak Pain',
                        data: ${peakData},
                        borderColor: '#e74c3c',
                        fill: false,
                        tension: 0.3
                    },
                    {
                        label: 'Tinnitus',
                        data: ${tinnitusData},
                        borderColor: '#f39c12',
                        tension: 0.3
                    },
                    {
                        label: 'Ocular',
                        data: ${ocularData},
                        borderColor: '#9b59b6',
                        tension: 0.3
                    },
                    {
                        label: 'Sleep Issues',
                        data: ${sleepData},
                        borderColor: '#27ae60',
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'top' } },
                scales: {
                    y: { min: 0, max: 4, title: { display: true, text: 'Severity (0-4)' } }
                }
            }
        });
        
        // Medications Chart (Stacked Bar)
        new Chart(document.getElementById('medicationsChart'), {
            type: 'bar',
            data: {
                labels: ${chartLabels},
                datasets: [
                    {
                        label: 'Paracetamol',
                        data: ${paracetamolData},
                        backgroundColor: 'rgba(52, 152, 219, 0.8)',
                        borderColor: '#3498db',
                        borderWidth: 1
                    },
                    {
                        label: 'Ibuprofen',
                        data: ${ibuprofenData},
                        backgroundColor: 'rgba(230, 126, 34, 0.8)',
                        borderColor: '#e67e22',
                        borderWidth: 1
                    },
                    {
                        label: 'Aspirin',
                        data: ${aspirinData},
                        backgroundColor: 'rgba(26, 188, 156, 0.8)',
                        borderColor: '#1abc9c',
                        borderWidth: 1
                    },
                    {
                        label: 'Sumatriptan',
                        data: ${triptanData},
                        backgroundColor: 'rgba(142, 68, 173, 0.8)',
                        borderColor: '#8e44ad',
                        borderWidth: 1
                    },
                    {
                        label: 'Ice',
                        data: ${iceData},
                        backgroundColor: 'rgba(0, 188, 212, 0.8)',
                        borderColor: '#00bcd4',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'top' } },
                scales: {
                    x: { stacked: true },
                    y: { 
                        stacked: true, 
                        min: 0, 
                        max: ${medsAxisMax},
                        title: { display: true, text: 'Doses (stacked)' } 
                    }
                }
            }
        });
    </script>
</body>
</html>`;
    
    downloadFile(html, `headache-report-${fromDate}-to-${toDate}.html`, 'text/html');
    showToast('Report generated successfully', 'success');
}

function getMedsSummary(entry) {
    const meds = [];
    if (entry.paracetamol) meds.push(`Paracetamol: ${entry.paracetamol}`);
    if (entry.ibuprofen) meds.push(`Ibuprofen: ${entry.ibuprofen}`);
    if (entry.aspirin) meds.push(`Aspirin: ${entry.aspirin}`);
    if (entry.triptan) meds.push(`Sumatriptan: ${entry.triptan}`);
    if ((entry.ice || entry.codeine)) meds.push(`Ice: ${(entry.ice || entry.codeine)}`);
    if (entry.otherMeds) meds.push(entry.otherMeds);
    return meds.length > 0 ? meds.join(', ') : '-';
}

async function exportJSON() {
    const btn = document.getElementById('exportJSON');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Exporting...';

    try {
        // Load all garmin data
        let garminData = {};
        if (currentUser) {
            try {
                const snap = await getDocs(collection(db, 'users', currentUser.uid, 'garmin'));
                snap.forEach(d => { garminData[d.id] = d.data(); });
            } catch (e) { console.warn('Garmin export failed:', e); }
        } else {
            garminData = JSON.parse(localStorage.getItem('headacheTracker_garmin') || '{}');
        }

        // Load all food log data
        let foodLogData = {};
        if (currentUser) {
            try {
                const snap = await getDocs(collection(db, 'users', currentUser.uid, 'foodLog'));
                snap.forEach(d => { foodLogData[d.id] = d.data(); });
            } catch (e) { console.warn('Food log export failed:', e); }
        } else {
            foodLogData = JSON.parse(localStorage.getItem('headacheTracker_food') || '{}');
        }

        const data = {
            exportDate: new Date().toISOString(),
            version: 2,
            entries,
            garmin: garminData,
            foodLog: foodLogData
        };

        const filename = `headache-backup-${new Date().toISOString().split('T')[0]}.json`;
        downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
        showToast('Backup exported successfully', 'success');
    } catch (e) {
        showToast('Export failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = origText;
    }
}

async function importJSON() {
    const fileInput = document.getElementById('importFile');
    const file = fileInput.files[0];

    if (!file) {
        showToast('Please select a file to import', 'error');
        return;
    }

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.entries) {
            showToast('Invalid backup file format', 'error');
            return;
        }

        const entryCount = Object.keys(data.entries).length;
        const garminCount = Object.keys(data.garmin || {}).length;
        const foodCount = Object.keys(data.foodLog || {}).length;

        const summary = [`${entryCount} headache entries`];
        if (garminCount) summary.push(`${garminCount} Garmin days`);
        if (foodCount) summary.push(`${foodCount} food log days`);

        if (!confirm(`Import ${summary.join(', ')}? This will merge with existing data.`)) return;

        // Import headache entries
        for (const [date, entry] of Object.entries(data.entries)) {
            await saveEntry(date, entry);
        }

        // Import garmin data
        if (data.garmin) {
            for (const [date, dayData] of Object.entries(data.garmin)) {
                if (currentUser) {
                    try {
                        await setDoc(doc(db, 'users', currentUser.uid, 'garmin', date), dayData);
                    } catch (e) { console.warn('Garmin import error:', date, e); }
                } else {
                    const all = JSON.parse(localStorage.getItem('headacheTracker_garmin') || '{}');
                    all[date] = dayData;
                    localStorage.setItem('headacheTracker_garmin', JSON.stringify(all));
                }
                garminCache[date] = dayData;
            }
        }

        // Import food log data
        if (data.foodLog) {
            for (const [date, dayData] of Object.entries(data.foodLog)) {
                if (currentUser) {
                    try {
                        await setDoc(doc(db, 'users', currentUser.uid, 'foodLog', date), dayData);
                    } catch (e) { console.warn('Food log import error:', date, e); }
                } else {
                    const all = JSON.parse(localStorage.getItem('headacheTracker_food') || '{}');
                    all[date] = dayData;
                    localStorage.setItem('headacheTracker_food', JSON.stringify(all));
                }
                delete histamineCache[date]; // will be recomputed on next access
            }
        }

        showToast(`Imported ${summary.join(', ')} successfully`, 'success');
        loadHistory();
    } catch (error) {
        showToast('Failed to import file: ' + error.message, 'error');
    }
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Toast Notifications
function showToast(message, type = '') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

// Theme Management
let currentTheme = 'default';

function setTheme(theme) {
    currentTheme = theme;
    document.body.dataset.theme = theme;
    
    // Update active button
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
    
    // Save to user profile
    saveThemePreference(theme);
}

async function saveThemePreference(theme) {
    if (currentUser) {
        try {
            const userRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
            await setDoc(userRef, { theme, updatedAt: new Date().toISOString() }, { merge: true });
        } catch (error) {
            console.error('Error saving theme:', error);
        }
    } else {
        localStorage.setItem('headacheTracker_theme', theme);
    }
}

async function loadThemePreference() {
    let theme = 'default';

    if (currentUser) {
        try {
            const userRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
            const docSnap = await getDoc(userRef);
            if (docSnap.exists() && docSnap.data().theme) {
                theme = docSnap.data().theme;
            }
        } catch (error) {
            console.error('Error loading theme:', error);
        }
    } else {
        theme = localStorage.getItem('headacheTracker_theme') || 'default';
    }

    setTheme(theme);
}

// AI Analysis - API Key Management
async function saveApiKey(key) {
    if (currentUser) {
        try {
            const userRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
            await setDoc(userRef, { anthropicApiKey: key, updatedAt: new Date().toISOString() }, { merge: true });
        } catch (error) {
            console.error('Error saving API key:', error);
        }
    } else {
        localStorage.setItem('headacheTracker_anthropicApiKey', key);
    }
}

async function loadApiKey() {
    if (currentUser) {
        try {
            const userRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
            const docSnap = await getDoc(userRef);
            if (docSnap.exists() && docSnap.data().anthropicApiKey) {
                return docSnap.data().anthropicApiKey;
            }
        } catch (error) {
            console.error('Error loading API key:', error);
        }
        return '';
    } else {
        return localStorage.getItem('headacheTracker_anthropicApiKey') || '';
    }
}

async function populateApiKeyField() {
    const key = await loadApiKey();
    const input = document.getElementById('anthropicApiKey');
    if (input && key) {
        input.value = key;
    }
}

// AI Analysis Generation
let cachedAnalysis = null;

async function generateAIAnalysis() {
    const panel = document.getElementById('aiAnalysisPanel');
    const btn = document.getElementById('generateAnalysisBtn');

    // Show loading immediately before any async work
    panel.className = 'ai-analysis-panel';
    panel.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    btn.disabled = true;
    btn.textContent = 'Generating...';

    const apiKey = await loadApiKey();
    if (!apiKey) {
        panel.className = 'ai-analysis-panel placeholder';
        panel.textContent = 'No API key found. Please add your Anthropic API key in Settings first.';
        btn.disabled = false;
        btn.textContent = 'Generate AI Analysis';
        return;
    }

    try {
        const range = document.getElementById('analysisRange').value;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        let totalDays;
        let filteredEntries = Object.entries(entries).sort((a, b) => new Date(a[0]) - new Date(b[0]));

        if (range === 'all') {
            const allDates = filteredEntries.map(([d]) => d);
            const earliest = allDates[0];
            totalDays = earliest
                ? Math.ceil((today - new Date(earliest)) / (1000 * 60 * 60 * 24)) + 1
                : 0;
        } else {
            totalDays = parseInt(range);
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - totalDays);
            filteredEntries = filteredEntries.filter(([date]) => new Date(date) >= cutoff);
        }

        if (filteredEntries.length < 5) {
            panel.className = 'ai-analysis-panel placeholder';
            panel.textContent = `Not enough data for analysis. Please log at least 5 entries in the selected period.`;
            btn.disabled = false;
            btn.textContent = 'Generate AI Analysis';
            return;
        }

        const startDateStr = filteredEntries[0][0];

        // Load Garmin data for all dates in range
        const garminDataMap = {};
        if (garminLinked) {
            const datesToLoad = filteredEntries.map(([d]) => d);
            for (const date of datesToLoad) {
                const gd = await loadGarminDayData(date);
                if (gd) garminDataMap[date] = gd;
            }
        }

        // Load food log data for all dates in range
        const foodDataMap = {};
        for (const [date] of filteredEntries) {
            const meals = await loadFoodEntries(date);
            if (meals.length > 0) foodDataMap[date] = meals;
        }

        const prompt = buildAnalysisPrompt(filteredEntries, totalDays, garminDataMap, foodDataMap);

        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, prompt })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `API error ${response.status}`);
        }

        const data = await response.json();
        const text = data.content[0].text;

        cachedAnalysis = text;
        panel.className = 'ai-analysis-panel';
        panel.innerHTML = simpleMarkdownToHtml(text);
        await saveAIReport(text, { startDate: startDateStr, endDate: todayStr, totalDays, entryCount: filteredEntries.length });
        renderAIReportHistory();

    } catch (error) {
        panel.className = 'ai-analysis-panel placeholder';
        panel.textContent = `Error: ${error.message}`;
        showToast('Analysis failed: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate AI Analysis';
    }
}

function computeDailyHistamine(meals) {
    // Timing weights: evening meals metabolised slower, late night worst
    const timingWeight = (type) => {
        if (!type) return 1.0;
        const t = type.toLowerCase();
        if (t === 'dinner' || t === 'evening') return 1.5;
        if (t === 'snack' && new Date().getHours() >= 20) return 1.3;
        if (t === 'late-night' || t === 'latenight') return 2.0;
        return 1.0;
    };
    // Quantity weight: use estimated_calories as proxy, normalise to 500 cal, cap at 2x
    const quantityWeight = (cal) => {
        if (!cal || cal <= 0) return 1.0;
        return Math.min(2.0, cal / 500);
    };
    let weightedSum = 0;
    let totalWeight = 0;
    let peakEffectiveScore = 0;
    for (const meal of meals) {
        const score = typeof meal.histamine_score === 'number' ? meal.histamine_score : null;
        if (score == null) continue;
        const tw = timingWeight(meal.mealType);
        const qw = quantityWeight(meal.estimated_calories);
        const w = tw * qw;
        weightedSum += score * w;
        totalWeight += w;
        // Track peak: score scaled by significance (timing × quantity), capped at 4
        peakEffectiveScore = Math.max(peakEffectiveScore, Math.min(4, score * tw * qw));
    }
    if (totalWeight === 0) return null;
    const weightedAvg = weightedSum / totalWeight;
    // Peak bias: a significant high-histamine meal pulls the day up even if others are low.
    // 0.75 factor means a big 4/4 meal (effectiveScore=4) floors the day at 3.0.
    // Blended so the rest of the day still matters — it's not purely the max.
    const peakFloor = peakEffectiveScore * 0.75;
    return Math.min(4, Math.max(weightedAvg, peakFloor));
}

function buildAnalysisPrompt(entries90, totalDays, garminDataMap = {}, foodDataMap = {}) {
    const today = new Date().toISOString().split('T')[0];
    const startDate = entries90.length > 0 ? entries90[0][0] : today;
    const daysLogged = entries90.length;
    const daysWithPain = entries90.filter(([, e]) => (e.painLevel || 0) > 0).length;
    const avgPain = (entries90.reduce((s, [, e]) => s + (e.painLevel || 0), 0) / totalDays).toFixed(2);
    const avgPeak = (entries90.reduce((s, [, e]) => s + (e.peakPain || 0), 0) / totalDays).toFixed(2);
    const avgTinnitus = (entries90.reduce((s, [, e]) => s + (e.tinnitus || 0), 0) / totalDays).toFixed(2);
    const avgOcular = (entries90.reduce((s, [, e]) => s + (e.ocular || 0), 0) / totalDays).toFixed(2);
    const avgSleep = (entries90.reduce((s, [, e]) => s + (e.sleepIssues || 0), 0) / totalDays).toFixed(2);
    const totalMeds = entries90.reduce((s, [, e]) => s + getTotalMeds(e), 0);
    const daysWithMeds = entries90.filter(([, e]) => getTotalMeds(e) > 0).length;
    const daysWithTriptan = entries90.filter(([, e]) => (e.triptan || 0) > 0).length;

    const p1 = getStatsForPeriod(30, 0);
    const p2 = getStatsForPeriod(60, 30);
    const p3 = getStatsForPeriod(90, 60);

    const pct = (v, d) => d > 0 ? Math.round((v / d) * 100) : 0;

    const dailyLines = entries90.map(([date, e]) => {
        let line = `${date}: P${e.painLevel || 0}/Pk${e.peakPain || 0}`;
        if ((e.tinnitus || 0) > 0) line += `/T${e.tinnitus}`;
        if ((e.ocular || 0) > 0) line += `/O${e.ocular}`;
        if ((e.sleepIssues || 0) > 0) line += `/S${e.sleepIssues}`;
        const meds = [];
        if ((e.paracetamol || 0) > 0) meds.push(`para:${e.paracetamol}`);
        if ((e.ibuprofen || 0) > 0) meds.push(`ibu:${e.ibuprofen}`);
        if ((e.aspirin || 0) > 0) meds.push(`asp:${e.aspirin}`);
        if ((e.triptan || 0) > 0) meds.push(`trip:${e.triptan}`);
        if (((e.ice || e.codeine) || 0) > 0) meds.push(`ice:${(e.ice || e.codeine)}`);
        if (e.otherMeds) meds.push(`other:${e.otherMeds}`);
        if (meds.length) line += ` | ${meds.join(' ')}`;
        if (e.triggers) line += ` | triggers: ${e.triggers}`;
        if (e.notes) line += ` | notes: ${e.notes}`;
        // Append Garmin data if available
        const g = garminDataMap[date];
        if (g) {
            const gParts = [];
            if (g.steps != null) gParts.push(`steps:${g.steps}`);
            if (g.sleepHours != null) gParts.push(`sleep:${g.sleepHours}h`);
            if (g.sleepScore != null) gParts.push(`sleepScore:${g.sleepScore}`);
            if (g.restingHR != null) gParts.push(`restHR:${g.restingHR}`);
            if (g.avgStress != null) gParts.push(`stress:${g.avgStress}`);
            if (g.bodyBatteryHigh != null) gParts.push(`bbHi:${g.bodyBatteryHigh}`);
            if (g.bodyBatteryLow != null) gParts.push(`bbLo:${g.bodyBatteryLow}`);
            if (g.hrv != null) gParts.push(`hrv:${g.hrv}ms`);
            if (gParts.length) line += ` | garmin: ${gParts.join(' ')}`;
        }
        // Append food/histamine data if available
        const meals = foodDataMap[date];
        if (meals && meals.length > 0) {
            const mealParts = meals.map(m => {
                const type = (m.mealType || 'meal').toLowerCase();
                const desc = m.description ? m.description.slice(0, 40) : '';
                const h = typeof m.histamine_score === 'number' ? `H:${m.histamine_score}` : '';
                return `${type}(${[h, desc].filter(Boolean).join(' ')})`;
            });
            const dailyH = computeDailyHistamine(meals);
            line += ` | food: ${mealParts.join(' ')}`;
            if (dailyH != null) line += ` | hist:${dailyH.toFixed(1)}`;
        }
        return line;
    }).join('\n');

    const hasGarmin = Object.keys(garminDataMap).length > 0;
    const hasFood = Object.keys(foodDataMap).length > 0;

    // Compute per-day histamine scores for summary stats
    const dailyHistamineScores = [];
    for (const [date, meals] of Object.entries(foodDataMap)) {
        const score = computeDailyHistamine(meals);
        if (score != null) dailyHistamineScores.push({ date, score });
    }
    const avgHistamine = dailyHistamineScores.length > 0
        ? (dailyHistamineScores.reduce((s, d) => s + d.score, 0) / dailyHistamineScores.length).toFixed(2)
        : null;
    const highHistamineDays = dailyHistamineScores.filter(d => d.score >= 3).length;
    const daysWithFood = Object.keys(foodDataMap).length;

    return `You are analyzing ${totalDays} days of headache tracking data for a personal health journal.${hasGarmin ? ' Garmin wearable data (steps, sleep, heart rate, stress, HRV, Body Battery) is included where available.' : ''}${hasFood ? ' Food log with histamine scores (0-4 scale) is included where available.' : ''}

SCALE: 0=none, 1=mild, 2=moderate, 3=severe, 4=very severe

SUMMARY (${startDate} to ${today}, ${totalDays} calendar days):
- Days logged: ${daysLogged}/${totalDays} (${pct(daysLogged, totalDays)}%)
- Days with headache (pain > 0): ${daysWithPain} (${pct(daysWithPain, totalDays)}%)
- Average daily pain: ${avgPain}/4, Average peak pain: ${avgPeak}/4
- Average tinnitus: ${avgTinnitus}/4, Ocular issues: ${avgOcular}/4, Sleep issues: ${avgSleep}/4
- Total medication doses: ${totalMeds}
- Days using any medication: ${daysWithMeds} (${pct(daysWithMeds, totalDays)}%)
- Days using sumatriptan (triptan): ${daysWithTriptan}${hasFood ? `
- Days with food logged: ${daysWithFood}
- Average weighted daily histamine score: ${avgHistamine != null ? avgHistamine + '/4' : 'n/a'}
- Days with high histamine (score ≥3): ${highHistamineDays}` : ''}

PERIOD BREAKDOWN (30-day segments, most recent 90 days for context):
Most recent (0-30 days): headache days ${p1?.daysWithPain || 0}/${p1?.calendarDays || 30}, avg pain ${(p1?.avgPain || 0).toFixed(1)}/4, avg peak ${(p1?.avgPeakPain || 0).toFixed(1)}/4, med days ${p1?.daysWithPainkillers || 0}
31-60 days ago: headache days ${p2?.daysWithPain || 0}/${p2?.calendarDays || 30}, avg pain ${(p2?.avgPain || 0).toFixed(1)}/4, avg peak ${(p2?.avgPeakPain || 0).toFixed(1)}/4, med days ${p2?.daysWithPainkillers || 0}
61-90 days ago: headache days ${p3?.daysWithPain || 0}/${p3?.calendarDays || 30}, avg pain ${(p3?.avgPain || 0).toFixed(1)}/4, avg peak ${(p3?.avgPeakPain || 0).toFixed(1)}/4, med days ${p3?.daysWithPainkillers || 0}

DAILY LOG (date: Pain/Peak[/Tinnitus/Ocular/Sleep] | medications | triggers | notes${hasGarmin ? ' | garmin: steps sleep restHR stress bodyBattery hrv' : ''}${hasFood ? ' | food: mealType(H:score desc) | hist:weightedScore' : ''}):
${dailyLines}

Please provide a structured analysis with these sections:

**Overview**
A narrative paragraph summarizing the ${totalDays}-day trend and trajectory.

**Correlations & Patterns**
Bullet points identifying key correlations (e.g., trigger patterns, medication use relative to pain, symptom co-occurrence, any clustering, etc.)${hasGarmin ? `

**Garmin Health Correlations**
Analyze relationships between the wearable data and headache patterns. Look for correlations between headache severity and: sleep duration/quality, resting heart rate, stress levels, HRV, Body Battery, and activity levels (steps). Note any thresholds (e.g., "headaches tend to be worse when sleep is below X hours" or "higher stress days correlate with higher pain").` : ''}

**Notes for Medical Consultation**
Any flags worth raising with a neurologist (medication overuse trends, worsening periods, unusual clusters, etc.)${hasFood ? `

**Food & Histamine Correlations**
Analyse the relationship between daily weighted histamine scores (hist: field) and headache severity. Specifically:
- Same-day correlations: do higher histamine days coincide with higher pain/peak scores?
- Lag effect: does a high-histamine day predict elevated pain the *following* day?
- Which meal types or times appear most frequently before headache days?
- Note the average histamine score (${avgHistamine}/4) and whether high-histamine days (>=3, n=${highHistamineDays}) show a pattern relative to headache days.
Histamine scale: 0=very low, 1=low, 2=moderate, 3=high, 4=very high. The hist: score is weighted by meal timing (evening meals 1.5x, late-night 2x) and portion size.` : ''}

Be specific with numbers from the data. Avoid generic health advice.`;
}

function simpleMarkdownToHtml(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const boldify = (s) => esc(s).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    const lines = text.split('\n');
    const html = [];
    let inList = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
            if (inList) { html.push('</ul>'); inList = false; }
            continue;
        }
        // Bold-only lines used as section headers (e.g. **Overview**)
        if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
            if (inList) { html.push('</ul>'); inList = false; }
            html.push(`<p><strong>${esc(trimmed.slice(2, -2))}</strong></p>`);
            continue;
        }
        // Markdown headers (#, ##, ###)
        if (/^#{1,3} /.test(trimmed)) {
            if (inList) { html.push('</ul>'); inList = false; }
            html.push(`<p><strong>${boldify(trimmed.replace(/^#{1,3} /, ''))}</strong></p>`);
            continue;
        }
        // List items
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            if (!inList) { html.push('<ul>'); inList = true; }
            html.push(`<li>${boldify(trimmed.slice(2))}</li>`);
            continue;
        }
        // Regular paragraph
        if (inList) { html.push('</ul>'); inList = false; }
        html.push(`<p>${boldify(trimmed)}</p>`);
    }
    if (inList) html.push('</ul>');
    return html.join('');
}

// AI Report History - Storage
async function saveAIReport(text, meta = {}) {
    const id = Date.now().toString();
    const generatedAt = new Date().toISOString();
    const record = { generatedAt, text, ...meta };
    if (currentUser) {
        try {
            const reportRef = doc(db, 'users', currentUser.uid, 'aiReports', id);
            await setDoc(reportRef, record);
        } catch (error) {
            console.error('Error saving AI report:', error);
        }
    } else {
        const reports = JSON.parse(localStorage.getItem('headacheTracker_aiReports') || '[]');
        reports.unshift({ id, ...record });
        localStorage.setItem('headacheTracker_aiReports', JSON.stringify(reports));
    }
}

async function loadAIReports() {
    if (currentUser) {
        try {
            const reportsRef = collection(db, 'users', currentUser.uid, 'aiReports');
            const snapshot = await getDocs(reportsRef);
            const reports = [];
            snapshot.forEach(d => reports.push({ id: d.id, ...d.data() }));
            return reports.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
        } catch (error) {
            console.error('Error loading AI reports:', error);
            return [];
        }
    } else {
        return JSON.parse(localStorage.getItem('headacheTracker_aiReports') || '[]');
    }
}

async function deleteAIReport(id) {
    if (currentUser) {
        await deleteDoc(doc(db, 'users', currentUser.uid, 'aiReports', id));
    } else {
        const reports = JSON.parse(localStorage.getItem('headacheTracker_aiReports') || '[]');
        localStorage.setItem('headacheTracker_aiReports', JSON.stringify(reports.filter(r => r.id !== id)));
    }
}

// AI Report History - Rendering
async function renderAIReportHistory() {
    const container = document.getElementById('aiReportsHistory');
    if (!container) return;

    const reports = await loadAIReports();

    // Pre-fill main panel with most recent report if nothing generated this session
    if (reports.length > 0 && !cachedAnalysis) {
        const panel = document.getElementById('aiAnalysisPanel');
        if (panel && panel.classList.contains('placeholder')) {
            panel.className = 'ai-analysis-panel';
            panel.innerHTML = simpleMarkdownToHtml(reports[0].text);
        }
    }

    if (reports.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="chart-container full-width ai-reports-container">
            <h3>Previous Reports</h3>
            <div class="ai-reports-list">
                ${reports.map(report => `
                    <div class="ai-report-item" id="report-item-${report.id}">
                        <div class="ai-report-summary" onclick="toggleReport('${report.id}')">
                            <div class="ai-report-info">
                                <span class="ai-report-generated">Generated ${formatReportDate(report.generatedAt)}</span>
                                ${report.startDate && report.endDate
                                    ? `<span class="ai-report-span">${formatDateSpan(report.startDate, report.endDate, report.totalDays, report.entryCount)}</span>`
                                    : ''}
                            </div>
                            <div class="ai-report-actions">
                                <button class="ai-report-delete-btn" onclick="confirmDeleteReport(event, '${report.id}')">Delete</button>
                                <span class="ai-report-chevron" id="chevron-${report.id}">▼</span>
                            </div>
                        </div>
                        <div class="ai-report-body" id="report-body-${report.id}">
                            ${simpleMarkdownToHtml(report.text)}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function formatReportDate(isoString) {
    return new Date(isoString).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatDateSpan(startDate, endDate, totalDays, entryCount) {
    const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const dayLabel = totalDays ? `${totalDays} days` : '';
    const entryLabel = entryCount ? `${entryCount} entries` : '';
    const meta = [dayLabel, entryLabel].filter(Boolean).join(' · ');
    return `${fmt(startDate)} – ${fmt(endDate)}${meta ? ` · ${meta}` : ''}`;
}

window.toggleReport = function(id) {
    const body = document.getElementById(`report-body-${id}`);
    const chevron = document.getElementById(`chevron-${id}`);
    if (!body) return;
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    if (chevron) chevron.textContent = isOpen ? '▼' : '▲';
};

window.confirmDeleteReport = async function(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this report? This cannot be undone.')) return;
    try {
        await deleteAIReport(id);
        showToast('Report deleted', 'success');
        renderAIReportHistory();
    } catch (error) {
        showToast('Failed to delete report', 'error');
    }
};

// Garmin Connect Integration
async function saveGarminCredentials(username, password) {
    const data = { garminUsername: username, garminPassword: password };
    if (currentUser) {
        try {
            const userRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
            await setDoc(userRef, { ...data, updatedAt: new Date().toISOString() }, { merge: true });
            console.log('Garmin credentials saved to Firestore:', username ? 'has username' : 'empty', password ? 'has password' : 'empty');
        } catch (error) {
            console.error('Error saving Garmin credentials:', error);
        }
    } else {
        localStorage.setItem('headacheTracker_garminUsername', username);
        localStorage.setItem('headacheTracker_garminPassword', password);
    }
}

async function loadGarminCredentials() {
    if (currentUser) {
        try {
            const userRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const d = docSnap.data();
                return { username: d.garminUsername || '', password: d.garminPassword || '' };
            }
        } catch (error) {
            console.error('Error loading Garmin credentials:', error);
        }
        return { username: '', password: '' };
    }
    return {
        username: localStorage.getItem('headacheTracker_garminUsername') || '',
        password: localStorage.getItem('headacheTracker_garminPassword') || ''
    };
}

let garminLinked = false;
let garminCredsCache = null;
let garminCache = {}; // date -> garmin data, populated before chart render
let histamineCache = {}; // date -> weighted histamine score, populated before chart render

async function populateGarminFields() {
    try {
        const creds = await loadGarminCredentials();
        garminCredsCache = creds;
        const u = document.getElementById('garminUsername');
        const p = document.getElementById('garminPassword');
        if (u) u.value = creds.username || '';
        if (p) p.value = creds.password || '';
        garminLinked = !!(creds.username && creds.password);
        console.log('Garmin credentials loaded:', garminLinked ? 'linked' : 'not linked', 'user:', creds.username ? 'present' : 'empty', 'pass:', creds.password ? 'present' : 'empty');
        updateGarminPanel();
        // Update connect UI and check token status
        updateGarminConnectUI();
        if (garminLinked) checkGarminTokenStatus();
        // Refresh garmin data for current date now that we know credentials exist
        if (garminLinked && logDate.value) {
            displayGarminData(logDate.value);
            // Auto-sync missing days in the background
            autoSyncGarminMissingDays();
        }
    } catch (e) {
        console.error('Error in populateGarminFields:', e);
    }
}

function updateGarminConnectUI() {
    const instructions = document.getElementById('garminConnectInstructions');
    const cmdEl = document.getElementById('garminCommand');
    if (!instructions || !cmdEl) return;

    const creds = garminCredsCache || { username: '', password: '' };
    if (creds.username && creds.password) {
        instructions.style.display = 'block';
        cmdEl.textContent = `node garmin-login.js ${creds.username} ${creds.password}`;
    } else {
        instructions.style.display = 'none';
    }
}

async function checkGarminTokenStatus() {
    const statusEl = document.getElementById('garminTokenStatus');
    if (!statusEl) return;

    const creds = garminCredsCache || await loadGarminCredentials();
    if (!creds.username) {
        statusEl.className = 'garmin-token-status';
        statusEl.textContent = '';
        return;
    }

    try {
        const res = await fetch('/api/garmin-token-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: creds.username })
        });

        if (!res.ok) return;
        const data = await res.json();

        statusEl.textContent = data.message;
        if (data.status === 'valid') {
            statusEl.className = 'garmin-token-status status-valid';
            statusEl.textContent = `Connected — tokens valid for ${data.daysLeft} days`;
        } else if (data.status === 'expiring_soon') {
            statusEl.className = 'garmin-token-status status-expiring';
        } else if (data.status === 'expired') {
            statusEl.className = 'garmin-token-status status-expired';
        } else if (data.status === 'missing') {
            statusEl.className = 'garmin-token-status status-missing';
        }
    } catch (e) {
        console.warn('Could not check Garmin token status:', e.message);
    }
}

function updateGarminPanel() {
    const panel = document.getElementById('garminPanel');
    if (panel) {
        panel.style.display = garminLinked ? 'block' : 'none';
    }
}

async function syncGarminData() {
    const btn = document.getElementById('syncGarminBtn');
    const grid = document.getElementById('garminData');
    const date = logDate.value;

    const today = new Date().toISOString().split('T')[0];
    if (date >= today) {
        showToast("Can't sync today's data — it isn't complete yet", 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Syncing...';
    grid.innerHTML = '<div class="garmin-stat" style="grid-column: 1/-1;"><div class="stat-value">Connecting to Garmin...</div></div>';

    try {
        const creds = garminCredsCache || await loadGarminCredentials();
        if (!creds.username || !creds.password) {
            showToast('Set your Garmin credentials in Settings first', 'error');
            return;
        }

        const res = await fetch('/api/garmin-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: creds.username, date })
        });

        if (!res.ok) {
            const err = await res.json();
            if (res.status === 401 || (err.error && err.error.includes('NO_TOKENS'))) {
                throw new Error('Garmin not connected. Please run the Connect Garmin script first.');
            }
            throw new Error(err.error || 'Sync failed');
        }

        const data = await res.json();

        // Cache in Firestore or localStorage
        await saveGarminDayData(date, data);
        displayGarminData(date);
        showToast('Garmin data synced', 'success');
    } catch (err) {
        grid.innerHTML = `<div class="garmin-stat" style="grid-column: 1/-1;"><div class="stat-value no-data">${err.message}</div></div>`;
        showToast('Garmin sync failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sync Day';
    }
}

// Get all dates that already have Garmin data cached
async function getGarminSyncedDates() {
    if (currentUser) {
        try {
            const collRef = collection(db, 'users', currentUser.uid, 'garmin');
            const snapshot = await getDocs(collRef);
            // Consider synced if syncedAt exists (new code ran) or has complete data
            return new Set(snapshot.docs
                .filter(d => {
                    const data = d.data();
                    return data.syncedAt || (data.sleepHours != null && data.bodyBatteryHigh != null);
                })
                .map(d => d.id));
        } catch (error) {
            console.error('Error loading synced dates:', error);
            return new Set();
        }
    }
    const all = JSON.parse(localStorage.getItem('headacheTracker_garmin') || '{}');
    return new Set(Object.keys(all).filter(k => {
        const d = all[k];
        return d.syncedAt || (d.sleepHours != null && d.bodyBatteryHigh != null);
    }));
}

// Generate array of YYYY-MM-DD strings between two dates inclusive
function getDateRange(startDate, endDate) {
    const dates = [];
    const current = new Date(startDate + 'T12:00:00');
    const end = new Date(endDate + 'T12:00:00');
    while (current <= end) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

// Get the earliest date from headache entries
function getFirstEntryDate() {
    const dates = Object.keys(entries).sort();
    return dates.length > 0 ? dates[0] : null;
}

// Bulk sync missing Garmin days
async function syncGarminMissingDays() {
    const btn = document.getElementById('syncGarminAllBtn');
    const progressContainer = document.getElementById('garminBulkProgress');
    const progressBar = document.getElementById('garminProgressBar');
    const progressText = document.getElementById('garminProgressText');

    const creds = garminCredsCache || await loadGarminCredentials();
    if (!creds.username || !creds.password) {
        showToast('Set your Garmin credentials in Settings first', 'error');
        return;
    }

    const firstDate = getFirstEntryDate();
    if (!firstDate) {
        showToast('No headache entries found to determine date range', 'error');
        return;
    }

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const allDates = getDateRange(firstDate, yesterday);
    const syncedDates = await getGarminSyncedDates();
    const missingDates = allDates.filter(d => !syncedDates.has(d));

    if (missingDates.length === 0) {
        showToast('All days are already synced!', 'success');
        return;
    }

    btn.disabled = true;
    document.getElementById('syncGarminBtn').disabled = true;
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${missingDates.length} days`;

    let synced = 0;
    let errors = 0;

    // Process in batches of 30 (server limit)
    for (let i = 0; i < missingDates.length; i += 30) {
        const batch = missingDates.slice(i, i + 30);

        try {
            const res = await fetch('/api/garmin-bulk-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: creds.username, dates: batch })
            });

            if (!res.ok) {
                const err = await res.json();
                if (res.status === 401 || (err.error && err.error.includes('NO_TOKENS'))) {
                    throw new Error('Garmin not connected. Please run the Connect Garmin script first.');
                }
                throw new Error(err.error || 'Bulk sync failed');
            }

            const data = await res.json();

            // Save each successful result
            for (const result of data.results) {
                if (result.error) {
                    errors++;
                } else {
                    await saveGarminDayData(result.date, result);
                    synced++;
                }
            }
        } catch (err) {
            errors += batch.length;
            showToast('Batch failed: ' + err.message, 'error');
        }

        const total = synced + errors;
        const pct = Math.round((total / missingDates.length) * 100);
        progressBar.style.width = pct + '%';
        progressText.textContent = `${total} / ${missingDates.length} days (${synced} synced${errors ? ', ' + errors + ' errors' : ''})`;
    }

    progressText.textContent = `Done! ${synced} days synced${errors ? ', ' + errors + ' errors' : ''}`;
    btn.disabled = false;
    document.getElementById('syncGarminBtn').disabled = false;
    showToast(`Garmin sync complete: ${synced} days synced`, 'success');

    // Refresh display for current date
    displayGarminData(logDate.value);
    renderFoodLog(logDate.value);
}

// Auto-sync missing days on app load (non-blocking)
async function autoSyncGarminMissingDays() {
    if (!garminLinked) return;

    const firstDate = getFirstEntryDate();
    if (!firstDate) return;

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const allDates = getDateRange(firstDate, yesterday);
    const syncedDates = await getGarminSyncedDates();
    const missingDates = allDates.filter(d => !syncedDates.has(d));

    if (missingDates.length === 0) return;

    // Show subtle progress
    const progressContainer = document.getElementById('garminBulkProgress');
    const progressBar = document.getElementById('garminProgressBar');
    const progressText = document.getElementById('garminProgressText');
    if (!progressContainer) return;

    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = `Auto-syncing ${missingDates.length} missing day${missingDates.length > 1 ? 's' : ''}...`;

    const creds = garminCredsCache || await loadGarminCredentials();
    if (!creds.username || !creds.password) return;

    let synced = 0;
    let errors = 0;

    for (let i = 0; i < missingDates.length; i += 30) {
        const batch = missingDates.slice(i, i + 30);

        try {
            const res = await fetch('/api/garmin-bulk-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: creds.username, dates: batch })
            });

            if (!res.ok) throw new Error('Batch failed');

            const data = await res.json();
            for (const result of data.results) {
                if (result.error) {
                    errors++;
                } else {
                    await saveGarminDayData(result.date, result);
                    synced++;
                }
            }
        } catch (err) {
            errors += batch.length;
        }

        const total = synced + errors;
        const pct = Math.round((total / missingDates.length) * 100);
        progressBar.style.width = pct + '%';
        progressText.textContent = `Auto-syncing: ${total} / ${missingDates.length} days`;
    }

    if (synced > 0) {
        progressText.textContent = `Auto-synced ${synced} day${synced > 1 ? 's' : ''}`;
        displayGarminData(logDate.value);
    }
    // Hide progress after a few seconds
    setTimeout(() => { progressContainer.style.display = 'none'; }, 3000);
}

async function saveGarminDayData(date, data) {
    if (currentUser) {
        try {
            const ref = doc(db, 'users', currentUser.uid, 'garmin', date);
            await setDoc(ref, { ...data, syncedAt: new Date().toISOString() });
        } catch (error) {
            console.error('Error saving Garmin data:', error);
        }
    } else {
        const all = JSON.parse(localStorage.getItem('headacheTracker_garmin') || '{}');
        all[date] = { ...data, syncedAt: new Date().toISOString() };
        localStorage.setItem('headacheTracker_garmin', JSON.stringify(all));
    }
}

// ─── Food Log ────────────────────────────────────────────────────────────────

async function saveFoodEntry(date, entry) {
    if (currentUser) {
        const ref = doc(db, 'users', currentUser.uid, 'foodLog', date);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? (snap.data().meals || []) : [];
        existing.push(entry);
        await setDoc(ref, { meals: existing });
    } else {
        const all = JSON.parse(localStorage.getItem('headacheTracker_food') || '{}');
        if (!all[date]) all[date] = [];
        all[date].push(entry);
        localStorage.setItem('headacheTracker_food', JSON.stringify(all));
    }
}

async function loadFoodEntries(date) {
    if (currentUser) {
        try {
            const ref = doc(db, 'users', currentUser.uid, 'foodLog', date);
            const snap = await getDoc(ref);
            return snap.exists() ? (snap.data().meals || []) : [];
        } catch { return []; }
    }
    const all = JSON.parse(localStorage.getItem('headacheTracker_food') || '{}');
    return all[date] || [];
}

async function loadAllFoodHistory() {
    if (currentUser) {
        try {
            const ref = collection(db, 'users', currentUser.uid, 'foodLog');
            const snap = await getDocs(ref);
            const all = [];
            snap.forEach(d => {
                const date = d.id;
                (d.data().meals || []).forEach(m => all.push({ ...m, _date: date }));
            });
            return all;
        } catch { return []; }
    }
    const all = JSON.parse(localStorage.getItem('headacheTracker_food') || '{}');
    const result = [];
    for (const [date, meals] of Object.entries(all)) {
        (Array.isArray(meals) ? meals : (meals.meals || [])).forEach(m => result.push({ ...m, _date: date }));
    }
    return result;
}

function getFrequentMeals(allMeals, mealType) {
    const typed = allMeals
        .filter(m => m.mealType === mealType && m.description && (m.ingredients || []).length > 0);

    // Top 4 by frequency
    const counts = {};
    typed.forEach(m => {
        const key = m.description.toLowerCase().trim();
        if (!counts[key]) counts[key] = { meal: m, count: 0 };
        counts[key].count++;
    });
    const byFreq = Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 4)
        .map(({ meal, count }) => ({ ...meal, count }));

    // 2 most recent (by date then time), excluding any already in byFreq
    const freqKeys = new Set(byFreq.map(m => m.description.toLowerCase().trim()));
    const recent = typed
        .sort((a, b) => (b._date || '').localeCompare(a._date || '') || (b.time || '').localeCompare(a.time || ''))
        .filter(m => !freqKeys.has(m.description.toLowerCase().trim()));
    const seen = new Set();
    const byRecent = [];
    for (const m of recent) {
        const key = m.description.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        byRecent.push({ ...m, count: 0 });
        if (byRecent.length >= 2) break;
    }

    return [...byFreq, ...byRecent];
}

async function deleteFoodEntry(date, entryId) {
    if (currentUser) {
        const ref = doc(db, 'users', currentUser.uid, 'foodLog', date);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const meals = (snap.data().meals || []).filter(m => m.id !== entryId);
        await setDoc(ref, { meals });
    } else {
        const all = JSON.parse(localStorage.getItem('headacheTracker_food') || '{}');
        if (all[date]) {
            all[date] = all[date].filter(m => m.id !== entryId);
            localStorage.setItem('headacheTracker_food', JSON.stringify(all));
        }
    }
}

async function renderFoodLog(date) {
    const container = document.getElementById('foodLogEntries');
    if (!container) return;

    const meals = await loadFoodEntries(date);
    if (meals.length === 0) {
        container.innerHTML = '<div style="color:#aaa;font-size:0.85rem;padding:4px 0">No meals logged for this day. Take a photo to add one.</div>';
        return;
    }

    container.innerHTML = meals.map(meal => renderFoodEntryHTML(meal)).join('');

    container.querySelectorAll('.food-entry-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.closest('.food-entry-delete')) return;
            const body = header.nextElementSibling;
            body.classList.toggle('open');
        });
    });
    container.querySelectorAll('.food-entry-edit').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const entryId = btn.dataset.id;
            const meals = await loadFoodEntries(date);
            const meal = meals.find(m => m.id === entryId);
            if (!meal) return;
            // Replace the entry card with the review/edit card
            const entryEl = btn.closest('.food-entry');
            showFoodReviewCard(date, meal, meal.thumb || null, container, entryId, entryEl);
        });
    });

    container.querySelectorAll('.food-entry-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete this meal entry?')) return;
            await deleteFoodEntry(date, btn.dataset.id);
            delete histamineCache[date]; // invalidate chart cache
            renderFoodLog(date);
        });
    });
}

function renderFoodEntryHTML(meal) {
    const ingredientRows = (meal.ingredients || []).map(ing => `
        <tr>
            <td><strong>${escapeHtml(ing.name)}</strong></td>
            <td>${escapeHtml(ing.estimated_quantity || '—')}</td>
            <td style="color:#888">${escapeHtml(ing.notes || '')}</td>
        </tr>`).join('');

    const triggers = meal.potential_headache_triggers?.filter(t => t)?.join(', ');
    const thumbHtml = meal.thumb
        ? `<img class="food-entry-thumb" src="${meal.thumb}" alt="meal">`
        : `<div class="food-entry-thumb-placeholder">🍽️</div>`;

    const histamineSection = meal.histamine_score != null
        ? `<span>Histamine: ${histamineBadge(meal.histamine_score)}</span>`
        : '';

    return `
    <div class="food-entry">
        <div class="food-entry-header">
            ${thumbHtml}
            <div class="food-entry-meta">
                <div class="food-entry-title">${escapeHtml(meal.mealType || 'meal')}</div>
                <div class="food-entry-desc">${escapeHtml(meal.description || '')}</div>
            </div>
            <div class="food-entry-time">${meal.time || ''}</div>
            <div class="food-entry-actions">
                <button class="food-entry-edit" data-id="${meal.id}" title="Edit">✏️</button>
                <button class="food-entry-delete" data-id="${meal.id}" title="Delete">✕</button>
            </div>
        </div>
        <div class="food-entry-body">
            <table class="food-ingredients-table">
                <thead><tr><th>Ingredient</th><th>Quantity</th><th>Notes</th></tr></thead>
                <tbody>${ingredientRows}</tbody>
            </table>
            <div class="food-meta-row">
                <span>~${meal.estimated_calories || '?'} kcal</span>
                ${histamineSection}
                <span>Confidence: ${meal.confidence || '?'}</span>
            </div>
            ${meal.histamine_notes ? `<div class="food-histamine-notes">${escapeHtml(meal.histamine_notes)}</div>` : ''}
            ${triggers ? `<div class="food-triggers"><strong>⚠️ Potential headache triggers:</strong> ${escapeHtml(triggers)}</div>` : ''}
        </div>
    </div>`;
}

function histamineBadge(score) {
    const labels = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
    const colors = ['#2e7d32', '#558b2f', '#f57f17', '#e65100', '#b71c1c'];
    const s = Math.min(4, Math.max(0, parseInt(score) || 0));
    return `<span style="color:${colors[s]};font-weight:600">${s}/4 ${labels[s]}</span>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Show editable review card after photo analysis — user confirms/edits before saving

function showFoodAddPanel(date, defaultType, allHistory, container) {
    // Remove any existing panel
    container.querySelector('.food-add-panel')?.remove();

    const panel = document.createElement('div');
    panel.className = 'food-entry food-add-panel';

    const mealTypes = ['breakfast','lunch','dinner','snack','drink'];

    function renderSuggestions(mealType) {
        const suggestions = getFrequentMeals(allHistory, mealType);
        const listEl = document.createElement('div');
        if (suggestions.length === 0) {
            listEl.innerHTML = '<div class="food-suggestions-empty">No previous meals logged for this type yet.</div>';
        } else {
            suggestions.forEach(m => {
                const btn = document.createElement('button');
                btn.className = 'food-suggestion-chip';
                btn.innerHTML = `<span class="food-suggestion-name">${escapeHtml(m.description)}</span><span class="food-suggestion-count">${m.count > 0 ? m.count + '×' : 'recent'}</span>`;
                btn.addEventListener('click', () => {
                    const mealType = panel.querySelector('.food-type-select-panel').value;
                    panel.remove();
                    showFoodReviewCard(date, {
                        mealType,
                        description: m.description,
                        ingredients: m.ingredients || [],
                        estimated_calories: m.estimated_calories || null,
                        confidence: 'high',
                        potential_headache_triggers: m.potential_headache_triggers || []
                    }, null, container);
                });
                listEl.appendChild(btn);
            });
        }
        return listEl;
    }

    panel.innerHTML = `
        <div class="food-add-panel-header">
            <span style="font-weight:600;font-size:0.95rem">Add Meal</span>
            <select class="food-type-select-panel">
                ${mealTypes.map(t => `<option value="${t}" ${t===defaultType?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
            </select>
            <button class="food-add-panel-close" style="background:none;border:none;color:#bbb;cursor:pointer;font-size:1.1rem">✕</button>
        </div>
        <div class="food-suggestions-section">
            <div class="food-suggestions-label">Recent meals:</div>
            <div class="food-suggestions-list"></div>
        </div>
        <button class="food-add-new-btn">+ Start with blank meal</button>`;

    container.prepend(panel);

    panel.querySelector('.food-suggestions-list').appendChild(renderSuggestions(defaultType));

    // Close
    panel.querySelector('.food-add-panel-close').addEventListener('click', () => panel.remove());

    // Re-render suggestions when meal type changes
    panel.querySelector('.food-type-select-panel').addEventListener('change', (e) => {
        const listEl = panel.querySelector('.food-suggestions-list');
        listEl.innerHTML = '';
        listEl.appendChild(renderSuggestions(e.target.value));
    });

    // Blank entry
    panel.querySelector('.food-add-new-btn').addEventListener('click', () => {
        const mealType = panel.querySelector('.food-type-select-panel').value;
        panel.remove();
        showFoodReviewCard(date, { mealType, description: '', ingredients: [], estimated_calories: null, confidence: 'high', potential_headache_triggers: [] }, null, container);
    });
}

function showFoodReviewCard(date, foodData, thumb, container, existingId = null, replaceEl = null) {
    const reviewId = 'food-review-' + Date.now();
    const mealTypes = ['breakfast','lunch','dinner','snack','drink'];

    const ingredientInputs = (foodData.ingredients || []).map((ing, i) => `
        <tr data-ing="${i}">
            <td><input class="food-ing-name" value="${escapeHtml(ing.name)}" style="width:100%;border:1px solid #ddd;border-radius:4px;padding:3px 6px;font-size:0.82rem"></td>
            <td><input class="food-ing-qty" value="${escapeHtml(ing.estimated_quantity||'')}" style="width:100%;border:1px solid #ddd;border-radius:4px;padding:3px 6px;font-size:0.82rem"></td>
            <td><input class="food-ing-notes" value="${escapeHtml(ing.notes||'')}" style="width:100%;border:1px solid #ddd;border-radius:4px;padding:3px 6px;font-size:0.82rem"></td>
            <td><button class="food-ing-remove" style="background:none;border:none;color:#bbb;cursor:pointer;font-size:1rem" title="Remove">✕</button></td>
        </tr>`).join('');

    const div = document.createElement('div');
    div.id = reviewId;
    div.className = 'food-entry food-review-card';
    div.innerHTML = `
        <div class="food-review-header">
            ${thumb ? `<img class="food-entry-thumb" src="${thumb}" alt="meal">` : '<div class="food-entry-thumb-placeholder">🍽️</div>'}
            <div style="flex:1">
                <div style="font-size:0.8rem;color:#888;margin-bottom:4px">${existingId ? 'Edit meal entry:' : 'Review &amp; edit before saving:'}</div>
                <select class="food-type-select" style="border:1px solid #ddd;border-radius:6px;padding:5px 8px;font-size:0.9rem;font-weight:600">
                    ${mealTypes.map(t => `<option value="${t}" ${foodData.mealType===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
                </select>
            </div>
            <button class="food-review-cancel" style="background:none;border:none;color:#bbb;cursor:pointer;font-size:1.1rem;padding:4px" title="Cancel">✕</button>
        </div>
        <div style="padding:0 12px 4px">
            <input class="food-desc-input" value="${escapeHtml(foodData.description||'')}" placeholder="Meal description" style="width:100%;border:1px solid #ddd;border-radius:4px;padding:4px 8px;font-size:0.85rem;margin-bottom:4px;box-sizing:border-box">
            <table class="food-ingredients-table" id="${reviewId}-table">
                <thead><tr><th>Ingredient</th><th>Quantity</th><th>Notes</th><th></th></tr></thead>
                <tbody>${ingredientInputs}</tbody>
            </table>
            <button class="food-add-ing-btn" style="margin-top:4px;background:none;border:1px dashed #ccc;border-radius:6px;padding:4px 12px;font-size:0.8rem;color:#888;cursor:pointer;width:100%">+ Add ingredient</button>
        </div>
        <div class="food-histamine-preview" id="${reviewId}-hist">
            <span class="food-hist-label">Histamine:</span>
            <span class="food-hist-value">Calculating...</span>
        </div>
        <div class="food-review-actions">
            <span style="font-size:0.8rem;color:#888">~${foodData.estimated_calories||'?'} kcal &nbsp;|&nbsp; Confidence: ${foodData.confidence||'?'}</span>
            <div style="display:flex;gap:8px">
                <button class="food-review-refresh" style="background:none;border:1px solid #667eea;color:#667eea;border-radius:8px;padding:8px 14px;font-size:0.9rem;font-weight:600;cursor:pointer">↻ Refresh</button>
                <button class="food-review-save" style="background:#667eea;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:0.9rem;font-weight:600;cursor:pointer">Save</button>
            </div>
        </div>`;

    if (replaceEl) {
        replaceEl.style.display = 'none';
        replaceEl.parentNode.insertBefore(div, replaceEl);
    } else {
        container.prepend(div);
    }

    // Cancel
    div.querySelector('.food-review-cancel').addEventListener('click', () => {
        div.remove();
        if (replaceEl) replaceEl.style.display = '';
    });

    // Live histamine result — updated by calculateAndPreview
    let liveHistamine = { score: null, notes: null, triggers: [] };
    let histDebounceTimer = null;
    let liveHistamineStale = true; // tracks whether ingredients changed since last calc

    const histPreviewEl = div.querySelector(`#${reviewId}-hist .food-hist-value`);

    const calculateAndPreview = async () => {
        const ingredients = [...div.querySelectorAll('tbody tr')].map(row => ({
            name: row.querySelector('.food-ing-name')?.value.trim() || '',
            estimated_quantity: row.querySelector('.food-ing-qty')?.value.trim() || '',
            notes: row.querySelector('.food-ing-notes')?.value.trim() || ''
        })).filter(ing => ing.name);

        if (ingredients.length === 0) {
            histPreviewEl.innerHTML = '<span style="color:#aaa">Add ingredients to assess</span>';
            liveHistamine = { score: null, notes: null, triggers: [] };
            liveHistamineStale = false;
            return;
        }

        histPreviewEl.innerHTML = '<span style="color:#aaa">Calculating...</span>';

        try {
            const apiKey = await loadApiKey();
            const result = await calculateHistamine(apiKey, ingredients);
            liveHistamine = result;
            liveHistamineStale = false;
            const scoreColors = ['#2e7d32','#558b2f','#f57f17','#e65100','#b71c1c'];
            const scoreLabels = ['Very Low','Low','Moderate','High','Very High'];
            const s = Math.min(4, Math.max(0, parseInt(result.score) || 0));
            histPreviewEl.innerHTML = `<strong style="color:${scoreColors[s]}">${s}/4 ${scoreLabels[s]}</strong> <span style="color:#666;font-size:0.8rem">${escapeHtml(result.notes || '')}</span>`;
            // Auto-update description if LLM returned one
            const descInput = div.querySelector('.food-desc-input');
            if (result.description && descInput) {
                descInput.value = result.description;
            }
        } catch (e) {
            histPreviewEl.innerHTML = '<span style="color:#e74c3c">Assessment failed</span>';
            liveHistamine = { score: null, notes: null, triggers: [] };
            liveHistamineStale = false;
        }
    };

    const scheduleRecalc = () => {
        liveHistamineStale = true;
        clearTimeout(histDebounceTimer);
        histDebounceTimer = setTimeout(calculateAndPreview, 800);
    };

    // Remove ingredient row → recalculate
    div.querySelector('tbody').addEventListener('click', (e) => {
        if (e.target.classList.contains('food-ing-remove')) {
            e.target.closest('tr').remove();
            scheduleRecalc();
        }
    });

    // Any input change → debounced recalculate
    div.querySelector('tbody').addEventListener('input', scheduleRecalc);

    const addIngredientRow = (focusFirst = false) => {
        const tbody = div.querySelector('tbody');
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input class="food-ing-name" placeholder="Ingredient" style="width:100%;border:1px solid #ddd;border-radius:4px;padding:3px 6px;font-size:0.82rem"></td>
            <td><input class="food-ing-qty" placeholder="Quantity" style="width:100%;border:1px solid #ddd;border-radius:4px;padding:3px 6px;font-size:0.82rem"></td>
            <td><input class="food-ing-notes" placeholder="Notes" style="width:100%;border:1px solid #ddd;border-radius:4px;padding:3px 6px;font-size:0.82rem"></td>
            <td><button class="food-ing-remove" style="background:none;border:none;color:#bbb;cursor:pointer;font-size:1rem">✕</button></td>`;
        tbody.appendChild(row);
        if (focusFirst) row.querySelector('.food-ing-name').focus();
        return row;
    };

    // Add ingredient row button
    div.querySelector('.food-add-ing-btn').addEventListener('click', () => addIngredientRow(true));

    // Enter key in ingredient inputs: move to next cell or add new row
    div.querySelector('tbody').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const inputs = [...div.querySelectorAll('tbody input')];
        const idx = inputs.indexOf(e.target);
        if (idx === -1) return;
        const next = inputs[idx + 1];
        if (next) {
            next.focus();
        } else {
            addIngredientRow(true);
        }
    });

    // Refresh button: manual recalculation only
    div.querySelector('.food-review-refresh').addEventListener('click', () => {
        clearTimeout(histDebounceTimer);
        calculateAndPreview();
    });

    // Save: use live histamine if current, recalculate only if stale
    div.querySelector('.food-review-save').addEventListener('click', async () => {
        const saveBtn = div.querySelector('.food-review-save');
        const refreshBtn = div.querySelector('.food-review-refresh');
        saveBtn.disabled = true;
        refreshBtn.disabled = true;
        clearTimeout(histDebounceTimer);

        const mealType = div.querySelector('.food-type-select').value;
        const ingredients = [...div.querySelectorAll('tbody tr')].map(row => ({
            name: row.querySelector('.food-ing-name')?.value.trim() || '',
            estimated_quantity: row.querySelector('.food-ing-qty')?.value.trim() || '',
            notes: row.querySelector('.food-ing-notes')?.value.trim() || ''
        })).filter(ing => ing.name);

        // Only recalculate if ingredients changed since last assessment
        if (liveHistamineStale && ingredients.length > 0) {
            saveBtn.textContent = 'Calculating...';
            try {
                const apiKey = await loadApiKey();
                const result = await calculateHistamine(apiKey, ingredients);
                liveHistamine = result;
                liveHistamineStale = false;
                if (result.description) {
                    div.querySelector('.food-desc-input').value = result.description;
                }
            } catch (e) {
                console.warn('Histamine calculation failed:', e.message);
            }
        }

        saveBtn.textContent = 'Saving...';

        const entry = {
            id: existingId || Date.now().toString(),
            time: foodData.time || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            thumb: thumb || foodData.thumb || null,
            mealType,
            description: div.querySelector('.food-desc-input').value.trim() || foodData.description || '',
            ingredients,
            estimated_calories: foodData.estimated_calories,
            potential_headache_triggers: liveHistamine.triggers || [],
            confidence: foodData.confidence || 'medium',
            histamine_score: liveHistamine.score,
            histamine_notes: liveHistamine.notes
        };

        if (existingId) await deleteFoodEntry(date, existingId);
        await saveFoodEntry(date, entry);
        delete histamineCache[date];
        div.remove();
        await renderFoodLog(date);
        showToast(existingId ? 'Meal updated!' : 'Meal saved!', 'success');
    });

    // Kick off initial preview calculation
    calculateAndPreview();
}

async function calculateHistamine(apiKey, ingredients) {
    const list = ingredients.map(i => `- ${i.name} (${i.estimated_quantity || 'unknown qty'}${i.notes ? ', ' + i.notes : ''})`).join('\n');
    const prompt = `Given these meal ingredients and their quantities, calculate a histamine score from 0-4 for the whole meal, explain why, and list any potential headache triggers.

Ingredients (with quantities):
${list}

Scoring rules:
- Weight each ingredient's histamine contribution by its quantity/volume. A large serving of a moderate-histamine food can score higher than a tiny amount of a high-histamine food. For example: 5 sausages (cured meat) is a substantial histamine load; 1 tsp soy sauce is a trace amount despite soy sauce being high-histamine.
- Consider the cumulative effect: multiple moderate-histamine ingredients together push the score up.
- If quantity is unknown, assume a typical portion size for that ingredient in the meal context.

Histamine scale:
0 = Very low (fresh meat, most veg, rice, most fruits)
1 = Low (some fresh fish, eggs, some dairy)
2 = Moderate (some processed foods, tomatoes, spinach, avocado)
3 = High (aged cheese, cured meats, fermented foods, alcohol, vinegar, soy sauce)
4 = Very high (multiple high-histamine foods in significant quantities combined)

Return JSON only: {"score": 2, "notes": "brief explanation referencing key ingredients and quantities", "triggers": ["specific ingredients or factors that may trigger headaches"], "description": "short meal name e.g. Eggs on Toast, Chicken Stir Fry"}`;

    const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, prompt })
    });
    if (!response.ok) throw new Error('API error');
    const result = await response.json();
    const text = result.content[0].text;
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error('No JSON');
    return JSON.parse(match[0]);
}

async function checkFoodHistamine(food) {
    const scoreEl = document.getElementById('foodCheckerScore');
    const altEl = document.getElementById('foodCheckerAlt');
    try {
        const apiKey = await loadApiKey();
        if (!apiKey) { scoreEl.innerHTML = '<span style="color:#e74c3c">No API key</span>'; return; }
        const prompt = `Rate this food/ingredient's histamine level 0-4 and if score is 2 or above, suggest a lower-histamine alternative. If the input is not a recognisable food or ingredient, set score to null. Be very concise (under 20 words).

Food: ${food}

Scale: 0=very low, 1=low, 2=moderate, 3=high, 4=very high

Return JSON only: {"score": 2, "alt": "suggested alternative or null if score<2"} (score is null if not a real food)`;
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, prompt })
        });
        if (!response.ok) throw new Error('API error');
        const result = await response.json();
        const match = result.content[0].text.match(/\{[\s\S]*?\}/);
        if (!match) throw new Error('No JSON');
        const data = JSON.parse(match[0]);
        if (data.score == null) {
            scoreEl.innerHTML = '<span style="color:#999">Unknown food</span>';
            altEl.innerHTML = '';
            altEl.classList.remove('visible');
            return;
        }
        const s = Math.min(4, Math.max(0, parseInt(data.score) || 0));
        const colors = ['#2e7d32','#558b2f','#f57f17','#e65100','#b71c1c'];
        const labels = ['Very Low','Low','Moderate','High','Very High'];
        scoreEl.innerHTML = `<strong style="color:${colors[s]}">${s}/4 ${labels[s]}</strong>`;
        if (s >= 2 && data.alt) {
            altEl.innerHTML = `Try instead: <strong style="color:#2e7d32">${escapeHtml(data.alt)}</strong>`;
            altEl.classList.add('visible');
        } else {
            altEl.innerHTML = '';
            altEl.classList.remove('visible');
        }
    } catch (e) {
        scoreEl.innerHTML = '<span style="color:#e74c3c">Check failed</span>';
        altEl.innerHTML = '';
        altEl.classList.remove('visible');
    }
}

function mealTypeFromTime() {
    const h = new Date().getHours();
    if (h < 10) return 'breakfast';
    if (h >= 12 && h < 14) return 'lunch';
    if (h >= 17 && h < 20) return 'dinner';
    return 'snack';
}

async function handleFoodPhoto(file, date) {
    const container = document.getElementById('foodLogEntries');

    const placeholder = document.createElement('div');
    placeholder.className = 'food-entry';
    placeholder.innerHTML = `<div class="food-entry-analysing"><div class="spinner"></div> Analysing meal photo...</div>`;
    container.prepend(placeholder);

    try {
        const apiKey = await loadApiKey();
        if (!apiKey) {
            placeholder.remove();
            showToast('No Anthropic API key set. Add it in Settings.', 'error');
            return;
        }

        const { base64, mediaType, thumb } = await resizeAndEncodeImage(file, 1024);

        const response = await fetch('/api/analyse-food', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, imageBase64: base64, mediaType })
        });

        if (!response.ok) throw new Error(`API error ${response.status}`);
        const result = await response.json();
        if (result.error) throw new Error(result.error.message || 'API error');

        const text = result.content[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Could not parse food analysis response');
        const foodData = JSON.parse(jsonMatch[0]);

        placeholder.remove();
        // Override mealType with time-of-day default
        foodData.mealType = mealTypeFromTime();
        // Show editable review card instead of saving directly
        showFoodReviewCard(date, foodData, thumb, container);

    } catch (e) {
        placeholder.remove();
        showToast('Failed to analyse photo: ' + e.message, 'error');
    }
}

function resizeAndEncodeImage(file, maxPx) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const mediaType = 'image/jpeg';
            const full = canvas.toDataURL(mediaType, 0.85).split(',')[1];
            // Smaller thumbnail for storage
            const tc = document.createElement('canvas');
            const ts = Math.min(1, 80 / Math.max(w, h));
            tc.width = Math.round(w * ts); tc.height = Math.round(h * ts);
            tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
            const thumb = tc.toDataURL(mediaType, 0.7);
            URL.revokeObjectURL(url);
            resolve({ base64: full, mediaType, thumb });
        };
        img.onerror = reject;
        img.src = url;
    });
}

// ─── End Food Log ─────────────────────────────────────────────────────────────

async function loadGarminDayData(date) {
    if (currentUser) {
        try {
            const ref = doc(db, 'users', currentUser.uid, 'garmin', date);
            const snap = await getDoc(ref);
            return snap.exists() ? snap.data() : null;
        } catch (error) {
            console.error('Error loading Garmin data:', error);
            return null;
        }
    }
    const all = JSON.parse(localStorage.getItem('headacheTracker_garmin') || '{}');
    return all[date] || null;
}

async function displayGarminData(date) {
    const panel = document.getElementById('garminPanel');
    const grid = document.getElementById('garminData');
    if (!panel || !grid) return;

    // If garminLinked hasn't been set yet, check credentials directly
    if (!garminLinked) {
        if (!garminCredsCache) {
            const creds = await loadGarminCredentials();
            garminCredsCache = creds;
            garminLinked = !!(creds.username && creds.password);
        }
        if (!garminLinked) {
            panel.style.display = 'none';
            return;
        }
    }
    panel.style.display = 'block';

    const data = await loadGarminDayData(date);
    if (!data) {
        grid.innerHTML = '<div class="garmin-stat" style="grid-column: 1/-1;"><div class="stat-value no-data">No data synced for this date. Click Sync to fetch.</div></div>';
        return;
    }

    const stat = (label, value, unit = '') => {
        if (value === null || value === undefined) {
            return `<div class="garmin-stat"><div class="stat-label">${label}</div><div class="stat-value no-data">--</div></div>`;
        }
        return `<div class="garmin-stat"><div class="stat-label">${label}</div><div class="stat-value">${value}${unit ? ' <small>' + unit + '</small>' : ''}</div></div>`;
    };

    grid.innerHTML = [
        stat('Steps', data.steps ? data.steps.toLocaleString() : null),
        stat('Sleep', data.sleepHours, 'hrs'),
        stat('Sleep Score', data.sleepScore),
        stat('Resting HR', data.restingHR, 'bpm'),
        stat('Max HR', data.maxHR, 'bpm'),
        stat('Avg Stress', data.avgStress),
        stat('Max Stress', data.maxStress),
        stat('Body Battery Hi', data.bodyBatteryHigh),
        stat('Body Battery Lo', data.bodyBatteryLow),
        stat('HRV', data.hrv, 'ms'),
    ].join('');
}

// Build time indicator
async function showBuildTime() {
    try {
        const res = await fetch('app.js', { method: 'HEAD', cache: 'no-store' });
        const lastModified = res.headers.get('Last-Modified');
        const el = document.getElementById('buildTime');
        if (el && lastModified) {
            const date = new Date(lastModified);
            el.textContent = `Deployed: ${date.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`;
        }
    } catch (e) { /* silently ignore */ }
}
