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
});

// Auth State Listener
function setupAuthStateListener() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            useLocalStorage = false;
            await loadEntriesFromFirestore();
            await loadThemePreference();
            showMainApp();
            updateAuthStatus();
        } else if (useLocalStorage) {
            loadEntriesFromLocalStorage();
            loadThemePreference();
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
}

function getChartData(range) {
    let filteredEntries = Object.entries(entries);
    
    if (range !== 'all') {
        const days = parseInt(range);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        filteredEntries = filteredEntries.filter(([date]) => new Date(date) >= cutoff);
    }
    
    filteredEntries.sort((a, b) => new Date(a[0]) - new Date(b[0]));
    
    return {
        dates: filteredEntries.map(([date]) => formatDate(date)),
        entries: filteredEntries.map(([, entry]) => entry)
    };
}

function renderCombinedChart(data) {
    const ctx = document.getElementById('combinedChart').getContext('2d');
    
    if (charts.combined) charts.combined.destroy();
    
    charts.combined = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.dates,
            datasets: [
                // Pain levels
                {
                    label: 'Overall Pain',
                    data: data.entries.map(e => e.painLevel),
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    fill: false,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'Peak Pain',
                    data: data.entries.map(e => e.peakPain),
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    fill: false,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                // Symptoms
                {
                    label: 'Tinnitus',
                    data: data.entries.map(e => e.tinnitus),
                    borderColor: '#f39c12',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Ocular',
                    data: data.entries.map(e => e.ocular),
                    borderColor: '#9b59b6',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Sleep Issues',
                    data: data.entries.map(e => e.sleepIssues),
                    borderColor: '#27ae60',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y'
                },
                // Medications
                {
                    label: 'Paracetamol',
                    data: data.entries.map(e => e.paracetamol || 0),
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.3)',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y2'
                },
                {
                    label: 'Ibuprofen',
                    data: data.entries.map(e => e.ibuprofen || 0),
                    borderColor: '#e67e22',
                    backgroundColor: 'rgba(230, 126, 34, 0.3)',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y2'
                },
                {
                    label: 'Aspirin',
                    data: data.entries.map(e => e.aspirin || 0),
                    borderColor: '#1abc9c',
                    backgroundColor: 'rgba(26, 188, 156, 0.3)',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y2'
                },
                {
                    label: 'Sumatriptan',
                    data: data.entries.map(e => e.triptan || 0),
                    borderColor: '#8e44ad',
                    backgroundColor: 'rgba(142, 68, 173, 0.3)',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y2'
                },
                {
                    label: 'Ice',
                    data: data.entries.map(e => e.codeine || 0),
                    borderColor: '#00bcd4',
                    backgroundColor: 'rgba(0, 188, 212, 0.3)',
                    tension: 0.3,
                    hidden: true,
                    yAxisID: 'y2'
                }
            ]
        },
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8
                    },
                    onClick: function(e, legendItem, legend) {
                        const index = legendItem.datasetIndex;
                        const ci = legend.chart;
                        const meta = ci.getDatasetMeta(index);
                        meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
                        ci.update();
                    }
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
                    title: {
                        display: true,
                        text: 'Medication Doses'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

function renderStats(data) {
    const statsPanel = document.getElementById('statsPanel');
    
    if (data.entries.length === 0) {
        statsPanel.innerHTML = '<div class="no-entries">No data for this period</div>';
        return;
    }
    
    const avgPain = (data.entries.reduce((sum, e) => sum + e.painLevel, 0) / data.entries.length).toFixed(1);
    const maxPain = Math.max(...data.entries.map(e => e.peakPain));
    const totalMeds = data.entries.reduce((sum, e) => sum + getTotalMeds(e), 0);
    const daysWithPain = data.entries.filter(e => e.painLevel > 0).length;
    
    // Count distinct days with painkillers (Paracetamol, Ibuprofen, Aspirin, Sumatriptan - not Ice or Other)
    const daysWithPainkillers = data.entries.filter(e => 
        (e.paracetamol || 0) > 0 || 
        (e.ibuprofen || 0) > 0 || 
        (e.aspirin || 0) > 0 || 
        (e.triptan || 0) > 0
    ).length;
    
    statsPanel.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">Total Entries</span>
            <span class="stat-value">${data.entries.length}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Days with Headache</span>
            <span class="stat-value">${daysWithPain} (${((daysWithPain/data.entries.length)*100).toFixed(0)}%)</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Average Pain Level</span>
            <span class="stat-value">${avgPain}/4</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Highest Pain Level</span>
            <span class="stat-value">${maxPain}/4</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Total Medication Doses</span>
            <span class="stat-value">${totalMeds}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Distinct Days of Painkillers</span>
            <span class="stat-value">${daysWithPainkillers} (${((daysWithPainkillers/data.entries.length)*100).toFixed(0)}%)</span>
        </div>
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
    const fromDate = document.getElementById('exportFrom').value;
    const toDate = document.getElementById('exportTo').value;
    
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
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Headache Report ${fromDate} to ${toDate}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #667eea; }
        .summary { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .stat { text-align: center; }
        .stat-value { font-size: 2rem; color: #667eea; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #667eea; color: white; }
        tr:nth-child(even) { background: #f8f9fa; }
    </style>
</head>
<body>
    <h1>🧠 Headache Report</h1>
    <p><strong>Period:</strong> ${fromDate} to ${toDate}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
    
    <div class="summary">
        <h2>Summary Statistics</h2>
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
        </div>
    </div>
    
    <h2>Daily Log</h2>
    <table>
        <tr>
            <th>Date</th>
            <th>Pain</th>
            <th>Peak</th>
            <th>Medications</th>
            <th>Triggers</th>
        </tr>
        ${filteredEntries.map(([date, e]) => `
        <tr>
            <td>${date}</td>
            <td>${e.painLevel}/4</td>
            <td>${e.peakPain}/4</td>
            <td>${getMedsSummary(e)}</td>
            <td>${e.triggers || '-'}</td>
        </tr>
        `).join('')}
    </table>
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
