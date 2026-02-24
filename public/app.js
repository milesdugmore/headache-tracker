// Firebase configuration - Replace with your Firebase project config
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
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
            showMainApp();
            updateAuthStatus();
        } else if (useLocalStorage) {
            loadEntriesFromLocalStorage();
            loadThemePreference();
            populateApiKeyField();
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
    form.codeine.value = entry.codeine || 0;
    form.otherMeds.value = entry.otherMeds || '';
    
    // Additional
    form.triggers.value = entry.triggers || '';
    form.notes.value = entry.notes || '';
    
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
        codeine: parseInt(form.codeine.value) || 0,
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
            codeine: parseInt(form.codeine.value) || 0,
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
function loadHistory(showAll = false) {
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
    
    historyList.innerHTML = filteredEntries.map(([date, entry]) => `
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
                        ${entry.codeine ? `<span class="metric"><label>Ice:</label> ${entry.codeine}</span>` : ''}
                        ${entry.otherMeds ? `<span class="metric"><label>Other:</label> ${entry.otherMeds}</span>` : ''}
                        ${!entry.paracetamol && !entry.ibuprofen && !entry.aspirin && !entry.triptan && !entry.codeine && !entry.otherMeds ? '<span class="metric none">None</span>' : ''}
                    </div>
                </div>
            </div>
            ${entry.triggers || entry.notes ? `
            <div class="history-notes">
                ${entry.triggers ? `<div class="history-note"><label>Triggers:</label> ${entry.triggers}</div>` : ''}
                ${entry.notes ? `<div class="history-note"><label>Notes:</label> ${entry.notes}</div>` : ''}
            </div>
            ` : ''}
        </div>
    `).join('');
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getTotalMeds(entry) {
    return (entry.paracetamol || 0) + (entry.ibuprofen || 0) + 
           (entry.aspirin || 0) + (entry.triptan || 0) + (entry.codeine || 0);
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
function renderCharts() {
    const range = document.getElementById('chartRange').value;
    const data = getChartData(range);

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
        entries: filteredEntries.map(([, entry]) => entry),
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

function renderCombinedChart(data) {
    const ctx = document.getElementById('combinedChart').getContext('2d');

    if (charts.combined) charts.combined.destroy();
    
    // Calculate max medication value for dynamic Y axis
    const maxMeds = Math.max(
        ...data.entries.map(e => 
            (e.paracetamol || 0) + (e.ibuprofen || 0) + (e.aspirin || 0) + (e.triptan || 0) + (e.codeine || 0)
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
                    data: data.entries.map(e => e.painLevel),
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
                    data: data.entries.map(e => e.peakPain),
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
                    data: data.entries.map(e => e.tinnitus),
                    borderColor: '#f39c12',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1
                },
                {
                    label: 'Ocular',
                    data: data.entries.map(e => e.ocular),
                    borderColor: '#9b59b6',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1
                },
                {
                    label: 'Sleep Issues',
                    data: data.entries.map(e => e.sleepIssues),
                    borderColor: '#27ae60',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y',
                    type: 'line',
                    order: 1
                },
                // Medications (stacked bars)
                {
                    label: 'Paracetamol',
                    data: data.entries.map(e => e.paracetamol || 0),
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
                    data: data.entries.map(e => e.ibuprofen || 0),
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
                    data: data.entries.map(e => e.aspirin || 0),
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
                    data: data.entries.map(e => e.triptan || 0),
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
                    data: data.entries.map(e => e.codeine || 0),
                    backgroundColor: 'rgba(0, 188, 212, 0.8)',
                    borderColor: '#00bcd4',
                    borderWidth: 1,
                    hidden: true,
                    yAxisID: 'y2',
                    type: 'bar',
                    stack: 'medications',
                    order: 2
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
                x: {
                    stacked: true
                }
            }
        }
    });

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
        (e.codeine || 0) > 0
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
        (e.codeine || 0) > 0
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
function exportCSV() {
    const fromDate = document.getElementById('exportFrom').value;
    const toDate = document.getElementById('exportTo').value;
    
    let filteredEntries = Object.entries(entries)
        .filter(([date]) => date >= fromDate && date <= toDate)
        .sort((a, b) => new Date(a[0]) - new Date(b[0]));
    
    if (filteredEntries.length === 0) {
        showToast('No entries in selected date range', 'error');
        return;
    }
    
    const headers = ['Date', 'Pain Level', 'Peak Pain', 'Tinnitus', 'Ocular', 'Sleep Issues', 
                     'Paracetamol', 'Ibuprofen', 'Aspirin', 'Sumatriptan', 
                     'Ice', 'Other Meds', 'Triggers', 'Notes'];
    
    const rows = filteredEntries.map(([date, e]) => [
        date, e.painLevel, e.peakPain, e.tinnitus, e.ocular, e.sleepIssues,
        e.paracetamol, e.ibuprofen, e.aspirin, e.triptan,
        e.codeine, `"${e.otherMeds || ''}"`, `"${e.triggers || ''}"`, `"${e.notes || ''}"`
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, `headache-log-${fromDate}-to-${toDate}.csv`, 'text/csv');
    showToast('CSV exported successfully', 'success');
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
    const iceData = JSON.stringify(data.entries.map(e => e.codeine || 0));
    
    // Calculate max stacked meds for dynamic axis
    const maxStackedMeds = Math.max(
        ...data.entries.map(e => 
            (e.paracetamol || 0) + (e.ibuprofen || 0) + (e.aspirin || 0) + (e.triptan || 0) + (e.codeine || 0)
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
    if (entry.codeine) meds.push(`Ice: ${entry.codeine}`);
    if (entry.otherMeds) meds.push(entry.otherMeds);
    return meds.length > 0 ? meds.join(', ') : '-';
}

function exportJSON() {
    const data = {
        exportDate: new Date().toISOString(),
        entries: entries
    };
    downloadFile(JSON.stringify(data, null, 2), `headache-backup-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    showToast('Backup exported successfully', 'success');
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
        
        const count = Object.keys(data.entries).length;
        if (!confirm(`Import ${count} entries? This will merge with existing data.`)) {
            return;
        }
        
        for (const [date, entry] of Object.entries(data.entries)) {
            await saveEntry(date, entry);
        }
        
        showToast(`Imported ${count} entries successfully`, 'success');
        loadHistory();
    } catch (error) {
        showToast('Failed to import file', 'error');
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
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const entries90 = Object.entries(entries)
            .filter(([date]) => new Date(date) >= cutoff)
            .sort((a, b) => new Date(a[0]) - new Date(b[0]));

        if (entries90.length < 5) {
            panel.className = 'ai-analysis-panel placeholder';
            panel.textContent = 'Not enough data for analysis. Please log at least 5 entries in the past 90 days.';
            btn.disabled = false;
            btn.textContent = 'Generate AI Analysis';
            return;
        }

        const prompt = buildAnalysisPrompt(entries90);

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
        await saveAIReport(text);
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

function buildAnalysisPrompt(entries90) {
    const today = new Date().toISOString().split('T')[0];
    const startDate = entries90.length > 0 ? entries90[0][0] : today;
    const totalDays = 90;
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
        if ((e.codeine || 0) > 0) meds.push(`ice:${e.codeine}`);
        if (e.otherMeds) meds.push(`other:${e.otherMeds}`);
        if (meds.length) line += ` | ${meds.join(' ')}`;
        if (e.triggers) line += ` | triggers: ${e.triggers}`;
        if (e.notes) line += ` | notes: ${e.notes}`;
        return line;
    }).join('\n');

    return `You are analyzing 90 days of headache tracking data for a personal health journal.

SCALE: 0=none, 1=mild, 2=moderate, 3=severe, 4=very severe

90-DAY SUMMARY (${startDate} to ${today}):
- Days logged: ${daysLogged}/90 (${pct(daysLogged, 90)}%)
- Days with headache (pain > 0): ${daysWithPain} (${pct(daysWithPain, totalDays)}%)
- Average daily pain: ${avgPain}/4, Average peak pain: ${avgPeak}/4
- Average tinnitus: ${avgTinnitus}/4, Ocular issues: ${avgOcular}/4, Sleep issues: ${avgSleep}/4
- Total medication doses: ${totalMeds}
- Days using any medication: ${daysWithMeds} (${pct(daysWithMeds, totalDays)}%)
- Days using sumatriptan (triptan): ${daysWithTriptan}

PERIOD BREAKDOWN (30-day segments):
Most recent (0-30 days): headache days ${p1?.daysWithPain || 0}/${p1?.calendarDays || 30}, avg pain ${(p1?.avgPain || 0).toFixed(1)}/4, avg peak ${(p1?.avgPeakPain || 0).toFixed(1)}/4, med days ${p1?.daysWithPainkillers || 0}
31-60 days ago: headache days ${p2?.daysWithPain || 0}/${p2?.calendarDays || 30}, avg pain ${(p2?.avgPain || 0).toFixed(1)}/4, avg peak ${(p2?.avgPeakPain || 0).toFixed(1)}/4, med days ${p2?.daysWithPainkillers || 0}
61-90 days ago: headache days ${p3?.daysWithPain || 0}/${p3?.calendarDays || 30}, avg pain ${(p3?.avgPain || 0).toFixed(1)}/4, avg peak ${(p3?.avgPeakPain || 0).toFixed(1)}/4, med days ${p3?.daysWithPainkillers || 0}

DAILY LOG (date: Pain/Peak[/Tinnitus/Ocular/Sleep] | medications | triggers | notes):
${dailyLines}

Please provide a structured analysis with these sections:

**Overview**
A narrative paragraph summarizing the 90-day trend and trajectory.

**Correlations & Patterns**
Bullet points identifying key correlations (e.g., trigger patterns, medication use relative to pain, symptom co-occurrence, any clustering, etc.)

**Notes for Medical Consultation**
Any flags worth raising with a neurologist (medication overuse trends, worsening periods, unusual clusters, etc.)

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
async function saveAIReport(text) {
    const id = Date.now().toString();
    const generatedAt = new Date().toISOString();
    if (currentUser) {
        try {
            const reportRef = doc(db, 'users', currentUser.uid, 'aiReports', id);
            await setDoc(reportRef, { generatedAt, text });
        } catch (error) {
            console.error('Error saving AI report:', error);
        }
    } else {
        const reports = JSON.parse(localStorage.getItem('headacheTracker_aiReports') || '[]');
        reports.unshift({ id, generatedAt, text });
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
                            <span class="ai-report-date">${formatReportDate(report.generatedAt)}</span>
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
