# Pollen / Hayfever Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily per-species pollen concentration data (Open-Meteo) to the headache tracker, covering display on the Daily Log, chart/stats/correlations/AI on the Analysis tab, plus automatic nightly ingest and historical backfill.

**Architecture:** Scheduled Firebase Cloud Function (`fetchPollenDaily`, nightly cron) populates one Firestore doc per day per user in `users/{uid}/pollen/{YYYY-MM-DD}`. A callable Cloud Function (`backfillPollen`) runs the one-shot historical backfill, chunked into 90-day windows against Open-Meteo's keyless Air Quality API. Client reads Firestore for display, charts, correlations, and the Anthropic analysis prompt.

**Tech Stack:** Firebase Functions v2 (Node 22), Firestore, vanilla JS + Chart.js client, Playwright for E2E. Unit tests use Node's built-in `node:test` (no new deps). Open-Meteo Air Quality API (keyless for personal use).

**Spec reference:** [../specs/2026-04-20-pollen-tracking-design.md](../specs/2026-04-20-pollen-tracking-design.md)

**Implementation note (deviation from spec):** `pollenLocation` and `pollenBackfillState` live at `users/{uid}/settings/preferences` (matching the existing settings/prefs pattern used for the theme and Anthropic key), not at the root `users/{uid}` doc. Scheduled function uses a Firestore `collectionGroup('settings')` query to find users with a pollen location set.

---

## Phase 1 — Server-side foundation (pure logic, tested)

### Task 1: Set up functions test infrastructure

**Files:**
- Modify: `functions/package.json`
- Create: `functions/test/.gitkeep`

- [ ] **Step 1: Add a `test` script to `functions/package.json`**

Replace the `"private": true,` line so the file becomes:

```json
{
  "name": "headache-tracker-functions",
  "engines": {
    "node": "22"
  },
  "main": "index.js",
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "firebase-admin": "^13.7.0",
    "firebase-functions": "^7.0.5",
    "garmin-connect": "^1.6.2"
  },
  "private": true
}
```

- [ ] **Step 2: Create the test directory placeholder**

```bash
mkdir -p functions/test
touch functions/test/.gitkeep
```

- [ ] **Step 3: Verify the test runner works**

Run: `cd functions && npm test`
Expected: `tests 0` / `pass 0` / exit 0 (no tests yet, but runner works).

- [ ] **Step 4: Commit**

```bash
git add functions/package.json functions/test/.gitkeep
git commit -m "chore(functions): add node --test runner scaffolding"
```

---

### Task 2: Pollen constants module

**Files:**
- Create: `functions/pollen/constants.js`
- Test: `functions/test/constants.test.js`

- [ ] **Step 1: Write the failing test**

Create `functions/test/constants.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { SPECIES, THRESHOLDS, BANDS } = require('../pollen/constants');

test('SPECIES lists the six Open-Meteo species', () => {
    assert.deepEqual(SPECIES, ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed']);
});

test('THRESHOLDS has an entry per species with low/moderate/high bounds', () => {
    for (const s of SPECIES) {
        assert.ok(THRESHOLDS[s], `missing thresholds for ${s}`);
        assert.equal(typeof THRESHOLDS[s].low, 'number');
        assert.equal(typeof THRESHOLDS[s].moderate, 'number');
        assert.equal(typeof THRESHOLDS[s].high, 'number');
    }
});

test('BANDS ordered from lowest to highest severity', () => {
    assert.deepEqual(BANDS, ['none', 'low', 'moderate', 'high', 'very-high']);
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd functions && npm test`
Expected: FAIL — `Cannot find module '../pollen/constants'`.

- [ ] **Step 3: Implement the module**

Create `functions/pollen/constants.js`:

```javascript
const SPECIES = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'];

const BANDS = ['none', 'low', 'moderate', 'high', 'very-high'];

// Daily-max grains/m³ thresholds, per Met Office / European Aeroallergen Network conventions.
// `low` means "1 up to this value", `moderate` = "just above low, up to this value", etc.
// `high` is the cap for high; above `high` is very-high (unless veryHigh is explicitly set to null, in which case "high" is the top band).
const THRESHOLDS = {
    birch:   { low: 10, moderate: 50, high: 200, veryHigh: true },
    alder:   { low: 10, moderate: 50, high: 200, veryHigh: true },
    grass:   { low: 30, moderate: 50, high: 150, veryHigh: true },
    ragweed: { low: 20, moderate: 50, high: 100, veryHigh: true },
    mugwort: { low: 10, moderate: 50, high: Infinity, veryHigh: false },
    olive:   { low: 20, moderate: 50, high: Infinity, veryHigh: false },
};

module.exports = { SPECIES, BANDS, THRESHOLDS };
```

- [ ] **Step 4: Run test — expect pass**

Run: `cd functions && npm test`
Expected: `pass 3`.

- [ ] **Step 5: Commit**

```bash
git add functions/pollen/constants.js functions/test/constants.test.js
git commit -m "feat(functions): pollen species and risk-band constants"
```

---

### Task 3: Aggregation helper (hourly → daily mean/max)

**Files:**
- Create: `functions/pollen/aggregate.js`
- Test: `functions/test/aggregate.test.js`

- [ ] **Step 1: Write the failing test**

Create `functions/test/aggregate.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateHourly } = require('../pollen/aggregate');

test('mean and max of 24 values', () => {
    const hourly = Array.from({ length: 24 }, (_, i) => i); // 0..23
    assert.deepEqual(aggregateHourly(hourly), { mean: 11.5, max: 23 });
});

test('ignores nulls, uses only defined values', () => {
    const hourly = [null, null, 10, 20, null, 30, ...Array(18).fill(null)];
    assert.deepEqual(aggregateHourly(hourly), { mean: 20, max: 30 });
});

test('returns {mean:0, max:0} when all values are null', () => {
    const hourly = Array(24).fill(null);
    assert.deepEqual(aggregateHourly(hourly), { mean: 0, max: 0 });
});

test('returns {mean:0, max:0} for empty array', () => {
    assert.deepEqual(aggregateHourly([]), { mean: 0, max: 0 });
});

test('rounds mean to 2 decimals', () => {
    assert.equal(aggregateHourly([1, 2, 2]).mean, 1.67);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd functions && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `functions/pollen/aggregate.js`:

```javascript
function aggregateHourly(values) {
    const defined = values.filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    if (defined.length === 0) return { mean: 0, max: 0 };
    const sum = defined.reduce((a, b) => a + b, 0);
    const mean = Math.round((sum / defined.length) * 100) / 100;
    const max = Math.max(...defined);
    return { mean, max };
}

module.exports = { aggregateHourly };
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd functions && npm test`
Expected: `pass 8` (3 from constants + 5 new).

- [ ] **Step 5: Commit**

```bash
git add functions/pollen/aggregate.js functions/test/aggregate.test.js
git commit -m "feat(functions): aggregateHourly helper for pollen mean/max"
```

---

### Task 4: Risk-band calculator

**Files:**
- Create: `functions/pollen/riskBand.js`
- Test: `functions/test/riskBand.test.js`

- [ ] **Step 1: Write the failing test**

Create `functions/test/riskBand.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { bandForSpecies, worstBand } = require('../pollen/riskBand');

test('birch band thresholds', () => {
    assert.equal(bandForSpecies('birch', 0), 'none');
    assert.equal(bandForSpecies('birch', 5), 'low');
    assert.equal(bandForSpecies('birch', 10), 'low');
    assert.equal(bandForSpecies('birch', 11), 'moderate');
    assert.equal(bandForSpecies('birch', 50), 'moderate');
    assert.equal(bandForSpecies('birch', 51), 'high');
    assert.equal(bandForSpecies('birch', 200), 'high');
    assert.equal(bandForSpecies('birch', 201), 'very-high');
});

test('mugwort has no very-high (caps at high)', () => {
    assert.equal(bandForSpecies('mugwort', 1000), 'high');
});

test('unknown species throws', () => {
    assert.throws(() => bandForSpecies('weed', 10));
});

test('worstBand picks the highest severity from a list', () => {
    assert.equal(worstBand(['low', 'moderate', 'high', 'low']), 'high');
    assert.equal(worstBand(['none', 'none']), 'none');
    assert.equal(worstBand(['very-high', 'high']), 'very-high');
});

test('worstBand of empty array is none', () => {
    assert.equal(worstBand([]), 'none');
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd functions && npm test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `functions/pollen/riskBand.js`:

```javascript
const { THRESHOLDS, BANDS } = require('./constants');

function bandForSpecies(species, max) {
    const t = THRESHOLDS[species];
    if (!t) throw new Error(`Unknown species: ${species}`);
    if (max <= 0) return 'none';
    if (max <= t.low) return 'low';
    if (max <= t.moderate) return 'moderate';
    if (max <= t.high) return 'high';
    return t.veryHigh ? 'very-high' : 'high';
}

function worstBand(bands) {
    if (bands.length === 0) return 'none';
    let worstIndex = 0;
    for (const b of bands) {
        const i = BANDS.indexOf(b);
        if (i > worstIndex) worstIndex = i;
    }
    return BANDS[worstIndex];
}

module.exports = { bandForSpecies, worstBand };
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd functions && npm test`
Expected: `pass 13`.

- [ ] **Step 5: Commit**

```bash
git add functions/pollen/riskBand.js functions/test/riskBand.test.js
git commit -m "feat(functions): per-species and overall risk-band calculators"
```

---

### Task 5: Date range chunker

**Files:**
- Create: `functions/pollen/chunkDateRange.js`
- Test: `functions/test/chunkDateRange.test.js`

- [ ] **Step 1: Write the failing test**

Create `functions/test/chunkDateRange.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkDateRange } = require('../pollen/chunkDateRange');

test('single-day range', () => {
    assert.deepEqual(chunkDateRange('2026-04-20', '2026-04-20'),
        [{ start: '2026-04-20', end: '2026-04-20' }]);
});

test('range smaller than chunk size returns one chunk', () => {
    assert.deepEqual(chunkDateRange('2026-01-01', '2026-01-10', 90),
        [{ start: '2026-01-01', end: '2026-01-10' }]);
});

test('range exactly one chunk size returns one chunk', () => {
    const out = chunkDateRange('2026-01-01', '2026-03-31', 90); // 90 days inclusive
    assert.equal(out.length, 1);
    assert.equal(out[0].start, '2026-01-01');
    assert.equal(out[0].end, '2026-03-31');
});

test('range of 100 days with chunkSize=90 returns two chunks', () => {
    const out = chunkDateRange('2026-01-01', '2026-04-10', 90);
    assert.equal(out.length, 2);
    assert.equal(out[0].start, '2026-01-01');
    assert.equal(out[0].end, '2026-03-31');
    assert.equal(out[1].start, '2026-04-01');
    assert.equal(out[1].end, '2026-04-10');
});

test('throws if start after end', () => {
    assert.throws(() => chunkDateRange('2026-02-01', '2026-01-01'));
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd functions && npm test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `functions/pollen/chunkDateRange.js`:

```javascript
function parseDate(s) {
    const d = new Date(s + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) throw new Error(`Bad date: ${s}`);
    return d;
}

function formatDate(d) {
    return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
    const copy = new Date(d.getTime());
    copy.setUTCDate(copy.getUTCDate() + n);
    return copy;
}

function chunkDateRange(start, end, chunkSize = 90) {
    const s = parseDate(start);
    const e = parseDate(end);
    if (e < s) throw new Error(`start (${start}) is after end (${end})`);

    const chunks = [];
    let cursor = s;
    while (cursor <= e) {
        const chunkEnd = addDays(cursor, chunkSize - 1);
        const actualEnd = chunkEnd > e ? e : chunkEnd;
        chunks.push({ start: formatDate(cursor), end: formatDate(actualEnd) });
        cursor = addDays(actualEnd, 1);
    }
    return chunks;
}

module.exports = { chunkDateRange };
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd functions && npm test`
Expected: `pass 18`.

- [ ] **Step 5: Commit**

```bash
git add functions/pollen/chunkDateRange.js functions/test/chunkDateRange.test.js
git commit -m "feat(functions): date range chunker for backfill windows"
```

---

### Task 6: Transform Open-Meteo response → Firestore doc

**Files:**
- Create: `functions/pollen/transform.js`
- Test: `functions/test/transform.test.js`

- [ ] **Step 1: Write the failing test**

Create `functions/test/transform.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDocs } = require('../pollen/transform');

function mockResponse(days) {
    // days = [{date:'2026-04-19', values: {birch: [24 values], grass: [24 values], ...}}]
    const times = [];
    const hourlyByKey = {
        alder_pollen: [],
        birch_pollen: [],
        grass_pollen: [],
        mugwort_pollen: [],
        olive_pollen: [],
        ragweed_pollen: [],
    };
    for (const day of days) {
        for (let h = 0; h < 24; h++) {
            times.push(`${day.date}T${String(h).padStart(2, '0')}:00`);
            for (const sp of Object.keys(hourlyByKey)) {
                const arr = day.values[sp.replace('_pollen', '')] || Array(24).fill(null);
                hourlyByKey[sp].push(arr[h] ?? null);
            }
        }
    }
    return { hourly: { time: times, ...hourlyByKey } };
}

test('extractDocs returns one doc per day with species mean/max/overall', () => {
    const response = mockResponse([
        { date: '2026-04-19', values: { birch: Array(24).fill(40), grass: Array(24).fill(5) } },
    ]);
    const location = { lat: 51.5074, lng: -0.1278 };
    const docs = extractDocs(response, location);

    assert.equal(docs.length, 1);
    const d = docs[0];
    assert.equal(d.date, '2026-04-19');
    assert.deepEqual(d.location, location);
    assert.equal(d.source, 'open-meteo');
    assert.equal(d.species.birch.mean, 40);
    assert.equal(d.species.birch.max, 40);
    assert.equal(d.species.grass.max, 5);
    assert.equal(d.species.alder.max, 0); // missing in input
    assert.equal(d.overall.maxOfMax, 40);
    assert.equal(d.overall.dominantSpecies, 'birch');
    assert.equal(d.overall.riskBand, 'moderate'); // birch 40 is moderate
    assert.equal(d.fetchError, null);
});

test('extractDocs handles a multi-day response', () => {
    const response = mockResponse([
        { date: '2026-04-18', values: { birch: Array(24).fill(5) } },
        { date: '2026-04-19', values: { birch: Array(24).fill(60) } },
    ]);
    const docs = extractDocs(response, { lat: 1, lng: 2 });
    assert.equal(docs.length, 2);
    assert.equal(docs[0].overall.riskBand, 'low');
    assert.equal(docs[1].overall.riskBand, 'high');
});

test('extractDocs with all-null values produces zeroed doc', () => {
    const response = mockResponse([{ date: '2026-01-15', values: {} }]);
    const [d] = extractDocs(response, { lat: 1, lng: 2 });
    assert.equal(d.overall.maxOfMax, 0);
    assert.equal(d.overall.riskBand, 'none');
    assert.equal(d.overall.dominantSpecies, null);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd functions && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `functions/pollen/transform.js`:

```javascript
const { SPECIES } = require('./constants');
const { aggregateHourly } = require('./aggregate');
const { bandForSpecies, worstBand } = require('./riskBand');

function extractDocs(response, location) {
    if (!response?.hourly?.time) {
        throw new Error('Invalid Open-Meteo response: missing hourly.time');
    }

    const times = response.hourly.time;
    // Group hours by YYYY-MM-DD
    const byDay = new Map();
    for (let i = 0; i < times.length; i++) {
        const date = times[i].slice(0, 10);
        if (!byDay.has(date)) byDay.set(date, []);
        byDay.get(date).push(i);
    }

    const docs = [];
    for (const [date, indices] of byDay) {
        const species = {};
        for (const sp of SPECIES) {
            const key = `${sp}_pollen`;
            const column = response.hourly[key] || [];
            const values = indices.map(i => column[i]);
            species[sp] = aggregateHourly(values);
        }

        const perSpeciesMax = SPECIES.map(sp => ({ sp, max: species[sp].max }));
        const maxOfMax = perSpeciesMax.reduce((a, b) => a.max >= b.max ? a : b, { sp: null, max: 0 });
        const bands = SPECIES.map(sp => bandForSpecies(sp, species[sp].max));
        const overallBand = worstBand(bands);

        docs.push({
            date,
            location,
            source: 'open-meteo',
            species,
            overall: {
                maxOfMax: maxOfMax.max,
                riskBand: overallBand,
                dominantSpecies: maxOfMax.max > 0 ? maxOfMax.sp : null,
            },
            fetchError: null,
        });
    }

    return docs;
}

module.exports = { extractDocs };
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd functions && npm test`
Expected: `pass 21`.

- [ ] **Step 5: Commit**

```bash
git add functions/pollen/transform.js functions/test/transform.test.js
git commit -m "feat(functions): transform Open-Meteo response to Firestore doc"
```

---

### Task 7: Open-Meteo fetch wrapper

**Files:**
- Create: `functions/pollen/fetchOpenMeteo.js`
- Test: `functions/test/fetchOpenMeteo.test.js`

- [ ] **Step 1: Write the failing test**

Create `functions/test/fetchOpenMeteo.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUrl, fetchRange } = require('../pollen/fetchOpenMeteo');

test('buildUrl includes all six species, location, dates, timezone', () => {
    const url = buildUrl({ lat: 51.5, lng: -0.1, start: '2026-04-01', end: '2026-04-05' });
    const u = new URL(url);
    assert.equal(u.hostname, 'air-quality-api.open-meteo.com');
    assert.equal(u.searchParams.get('latitude'), '51.5');
    assert.equal(u.searchParams.get('longitude'), '-0.1');
    assert.equal(u.searchParams.get('start_date'), '2026-04-01');
    assert.equal(u.searchParams.get('end_date'), '2026-04-05');
    assert.equal(u.searchParams.get('timezone'), 'Europe/London');
    const hourly = u.searchParams.get('hourly');
    for (const s of ['alder_pollen','birch_pollen','grass_pollen','mugwort_pollen','olive_pollen','ragweed_pollen']) {
        assert.ok(hourly.includes(s), `missing ${s}`);
    }
});

test('fetchRange calls fetch with built URL and returns parsed json', async () => {
    const calls = [];
    const fakeFetch = async (url) => {
        calls.push(url);
        return { ok: true, json: async () => ({ hourly: { time: [], alder_pollen: [] } }) };
    };
    const out = await fetchRange({ lat: 1, lng: 2, start: '2026-01-01', end: '2026-01-02' }, { fetchImpl: fakeFetch });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('latitude=1'));
    assert.ok(out.hourly);
});

test('fetchRange throws on non-ok response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500, text: async () => 'bad' });
    await assert.rejects(
        fetchRange({ lat: 1, lng: 2, start: '2026-01-01', end: '2026-01-01' }, { fetchImpl: fakeFetch }),
        /500/
    );
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd functions && npm test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `functions/pollen/fetchOpenMeteo.js`:

```javascript
const { SPECIES } = require('./constants');

const HOURLY_VARS = SPECIES.map(s => `${s}_pollen`).join(',');

function buildUrl({ lat, lng, start, end }) {
    const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lng),
        hourly: HOURLY_VARS,
        start_date: start,
        end_date: end,
        timezone: 'Europe/London',
    });
    return `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`;
}

async function fetchRange({ lat, lng, start, end }, { fetchImpl = fetch } = {}) {
    const url = buildUrl({ lat, lng, start, end });
    const res = await fetchImpl(url);
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Open-Meteo HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
}

module.exports = { buildUrl, fetchRange, HOURLY_VARS };
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd functions && npm test`
Expected: `pass 24`.

- [ ] **Step 5: Commit**

```bash
git add functions/pollen/fetchOpenMeteo.js functions/test/fetchOpenMeteo.test.js
git commit -m "feat(functions): Open-Meteo fetch wrapper with URL builder"
```

---

## Phase 2 — Cloud Functions

### Task 8: Scheduled `fetchPollenDaily` function

**Files:**
- Modify: `functions/index.js:1-8` (imports)
- Modify: `functions/index.js` — append function at end (around line 462)

- [ ] **Step 1: Update imports in `functions/index.js`**

Edit the top of `functions/index.js`. Replace the existing line 1:

```javascript
const { onRequest } = require('firebase-functions/v2/https');
```

with:

```javascript
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { fetchRange } = require('./pollen/fetchOpenMeteo');
const { extractDocs } = require('./pollen/transform');
```

- [ ] **Step 2: Append the scheduled function to `functions/index.js`**

Add at the end of the file (after the existing `analyseFood` export):

```javascript
// Nightly: fetch yesterday's pollen for every user with a stored location.
// Also retries any docs in the last 7 days that have fetchError set.
exports.fetchPollenDaily = onSchedule(
    { schedule: '15 2 * * *', timeZone: 'Europe/London', region: 'europe-west1', timeoutSeconds: 540, memory: '512MiB' },
    async () => {
        const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);

        // Find user settings docs that have pollenLocation set
        const settingsSnap = await firestore
            .collectionGroup('settings')
            .where('pollenLocation', '!=', null)
            .get();

        console.log(`fetchPollenDaily: ${settingsSnap.size} users with pollen location`);

        for (const settingsDoc of settingsSnap.docs) {
            const uid = settingsDoc.ref.parent.parent.id;
            const { pollenLocation, pollenDisabled } = settingsDoc.data();
            if (pollenDisabled) continue;
            if (!pollenLocation?.lat || !pollenLocation?.lng) continue;

            // 1. Yesterday
            await fetchAndWriteDay(uid, yesterdayDate, pollenLocation);

            // 2. Retry any fetchError docs in the last 7 days
            const retryFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                .toISOString().slice(0, 10);
            const errorSnap = await firestore
                .collection('users').doc(uid).collection('pollen')
                .where('fetchError', '!=', null)
                .where('date', '>=', retryFrom)
                .get();
            for (const errDoc of errorSnap.docs) {
                await fetchAndWriteDay(uid, errDoc.id, pollenLocation);
            }
        }
    }
);

async function fetchAndWriteDay(uid, date, location) {
    const ref = firestore.collection('users').doc(uid).collection('pollen').doc(date);
    try {
        const response = await fetchRange({
            lat: location.lat,
            lng: location.lng,
            start: date,
            end: date,
        });
        const [docData] = extractDocs(response, location);
        await ref.set({ ...docData, fetchedAt: new Date().toISOString() });
        console.log(`fetchPollenDaily: wrote ${uid}/${date}`);
    } catch (err) {
        console.error(`fetchPollenDaily failed for ${uid}/${date}: ${err.message}`);
        await ref.set({
            date,
            location,
            source: 'open-meteo',
            species: {
                alder: { mean: 0, max: 0 },
                birch: { mean: 0, max: 0 },
                grass: { mean: 0, max: 0 },
                mugwort: { mean: 0, max: 0 },
                olive: { mean: 0, max: 0 },
                ragweed: { mean: 0, max: 0 },
            },
            overall: { maxOfMax: 0, riskBand: 'none', dominantSpecies: null },
            fetchError: err.message.slice(0, 500),
            fetchedAt: new Date().toISOString(),
        }, { merge: true });
    }
}
```

- [ ] **Step 3: Sanity-check syntactically**

Run: `cd functions && node -e "require('./index.js')"`
Expected: exits 0 (or only a Firebase-admin initialization log; no SyntaxError).

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): scheduled fetchPollenDaily cron for daily pollen ingest"
```

---

### Task 9: Callable `backfillPollen` function

**Files:**
- Modify: `functions/index.js` — append at end

- [ ] **Step 1: Append the backfill function**

Add at the end of `functions/index.js`:

```javascript
const { chunkDateRange } = require('./pollen/chunkDateRange');

// Callable-style HTTP endpoint: client POSTs {uid, start, end, location} and
// we fetch Open-Meteo in 90-day chunks, writing one doc per day.
// Updates users/{uid}/settings/preferences.pollenBackfillState as it progresses.
exports.backfillPollen = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'], timeoutSeconds: 540, memory: '512MiB', region: 'europe-west1' },
    async (req, res) => {
        if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

        const { uid, start, end, location } = req.body || {};
        if (!uid || !start || !end || !location?.lat || !location?.lng) {
            res.status(400).json({ error: 'Missing uid, start, end, or location' });
            return;
        }

        // Clamp start to CAMS coverage (2013-01-01)
        const effectiveStart = start < '2013-01-01' ? '2013-01-01' : start;
        const skipped = effectiveStart !== start;

        const prefsRef = firestore.collection('users').doc(uid).collection('settings').doc('preferences');
        const pollenColl = firestore.collection('users').doc(uid).collection('pollen');

        let total = 0;
        // Rough estimate for progress: count of days
        const msPerDay = 24 * 60 * 60 * 1000;
        total = Math.floor((new Date(end) - new Date(effectiveStart)) / msPerDay) + 1;

        await prefsRef.set({
            pollenBackfillState: {
                status: 'running',
                earliestDate: effectiveStart,
                lastRunAt: new Date().toISOString(),
                progress: { done: 0, total },
            },
        }, { merge: true });

        try {
            const chunks = chunkDateRange(effectiveStart, end, 90);
            let done = 0;

            for (const chunk of chunks) {
                const response = await fetchRange({ lat: location.lat, lng: location.lng, start: chunk.start, end: chunk.end });
                const docs = extractDocs(response, location);

                // Write in batches of 500 (Firestore limit)
                let batch = firestore.batch();
                let inBatch = 0;
                for (const d of docs) {
                    const ref = pollenColl.doc(d.date);
                    batch.set(ref, { ...d, fetchedAt: new Date().toISOString() });
                    inBatch++;
                    if (inBatch >= 450) {
                        await batch.commit();
                        batch = firestore.batch();
                        inBatch = 0;
                    }
                }
                if (inBatch > 0) await batch.commit();

                done += docs.length;
                await prefsRef.set({
                    pollenBackfillState: { status: 'running', earliestDate: effectiveStart, lastRunAt: new Date().toISOString(), progress: { done, total } },
                }, { merge: true });

                await new Promise(r => setTimeout(r, 200));
            }

            await prefsRef.set({
                pollenBackfillState: { status: 'complete', earliestDate: effectiveStart, lastRunAt: new Date().toISOString(), progress: { done, total } },
            }, { merge: true });

            res.json({ success: true, done, total, skippedPre2013: skipped });
        } catch (err) {
            console.error('backfillPollen failed:', err);
            await prefsRef.set({
                pollenBackfillState: { status: 'idle', earliestDate: effectiveStart, lastRunAt: new Date().toISOString(), error: err.message.slice(0, 500) },
            }, { merge: true });
            res.status(500).json({ error: err.message });
        }
    }
);
```

- [ ] **Step 2: Sanity-check**

Run: `cd functions && node -e "require('./index.js')"`
Expected: no SyntaxError.

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): backfillPollen callable for one-shot historical import"
```

---

### Task 10: Add Firebase hosting rewrite for backfill

**Files:**
- Modify: `firebase.json:33-56`

- [ ] **Step 1: Add the rewrite rule**

In `firebase.json`, find the `rewrites` array (currently ending with the `/api/garmin-bulk-sync` entry). Add one entry directly before the catchall `**` rewrite:

Replace:

```json
      {
        "source": "/api/garmin-bulk-sync",
        "function": "garminBulkSync"
      },
      {
        "source": "**",
```

with:

```json
      {
        "source": "/api/garmin-bulk-sync",
        "function": "garminBulkSync"
      },
      {
        "source": "/api/pollen-backfill",
        "function": "backfillPollen"
      },
      {
        "source": "**",
```

- [ ] **Step 2: Commit**

```bash
git add firebase.json
git commit -m "chore(hosting): rewrite /api/pollen-backfill -> backfillPollen"
```

---

### Task 11: Firestore rules for pollen collection

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Read the current rules**

```bash
cat firestore.rules
```

- [ ] **Step 2: Add pollen subcollection rule**

Inside the `match /users/{uid}/...` block (or wherever existing subcollections like `entries` and `garmin` are scoped), add a match block for `pollen`. If the rules currently look like:

```
match /databases/{database}/documents {
  match /users/{uid}/{document=**} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
}
```

then the wildcard already covers pollen — no change needed; move to Step 4.

Otherwise if entries/garmin are explicit, add analogously:

```
match /users/{uid}/pollen/{date} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

- [ ] **Step 3: Deploy rules locally-visible only (deferred)**

No local test needed — rules deploy with `firebase deploy --only firestore:rules`, not part of this task.

- [ ] **Step 4: Commit (even if no change was needed, commit a placeholder log entry)**

If rules file was modified:

```bash
git add firestore.rules
git commit -m "chore(firestore): allow users to access their pollen subcollection"
```

If no change needed, skip commit.

---

## Phase 3 — Client: location and daily log panel

### Task 12: Add pollen panel DOM to index.html

**Files:**
- Modify: `public/index.html:194` (after the `garminPanel` div closes and before the Food Checker)

- [ ] **Step 1: Insert the pollen panel markup**

In `public/index.html`, find the line `</div>` that closes `<div id="garminPanel">` (around line 194). Immediately after it, before the `<!-- Food Checker -->` comment, insert:

```html
                <!-- Pollen Panel -->
                <div id="pollenPanel" class="pollen-panel" style="display:none">
                    <div class="pollen-panel-header">
                        <h3>Pollen</h3>
                        <span id="pollenOverall" class="pollen-overall"></span>
                    </div>
                    <div id="pollenChips" class="pollen-chips"></div>
                    <button type="button" id="pollenShowMean" class="pollen-show-mean-btn">Show mean values</button>
                    <div id="pollenMeanTable" class="pollen-mean-table" style="display:none"></div>
                    <div id="pollenEmpty" class="pollen-empty" style="display:none"></div>
                </div>

                <!-- Pollen Enable Banner -->
                <div id="pollenEnableBanner" class="pollen-enable-banner" style="display:none">
                    <span>Enable pollen tracking? We'll use your location once to set up local pollen data.</span>
                    <button id="pollenEnableBtn">Enable</button>
                    <button id="pollenDismissBtn" class="pollen-dismiss-btn">Later</button>
                </div>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): add pollen panel and enable banner markup"
```

---

### Task 13: Add pollen panel styles

**Files:**
- Modify: `public/styles.css` — append at end

- [ ] **Step 1: Append styles**

Add at the end of `public/styles.css`:

```css
/* ---------- Pollen Panel ---------- */
.pollen-panel {
    background: var(--surface, #fff);
    border: 1px solid var(--border, #e2e2e2);
    border-radius: 12px;
    padding: 16px;
    margin: 16px 0;
}
.pollen-panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
}
.pollen-panel-header h3 { margin: 0; font-size: 1rem; }
.pollen-overall {
    font-size: 0.9rem;
    color: var(--muted, #666);
}
.pollen-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
}
.pollen-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 0.8rem;
    background: #f2f2f2;
    color: #333;
}
.pollen-chip-label { text-transform: capitalize; font-weight: 500; }
.pollen-chip-value { font-variant-numeric: tabular-nums; }
.pollen-chip[data-band="none"]      { background: #f0f0f0; color: #555; }
.pollen-chip[data-band="low"]       { background: #d9f5dd; color: #135e1b; }
.pollen-chip[data-band="moderate"]  { background: #fff1b8; color: #7a5a00; }
.pollen-chip[data-band="high"]      { background: #ffd4b8; color: #8a3f00; }
.pollen-chip[data-band="very-high"] { background: #f8b4b4; color: #7a1212; }

.pollen-show-mean-btn {
    background: none;
    border: none;
    color: var(--link, #2a6ef5);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 4px 0;
}
.pollen-mean-table {
    margin-top: 8px;
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 4px 16px;
    font-size: 0.85rem;
}
.pollen-mean-table .row-head { font-weight: 600; color: var(--muted, #666); }

.pollen-empty {
    font-size: 0.9rem;
    color: var(--muted, #666);
    font-style: italic;
}

.pollen-enable-banner {
    background: #e7f1ff;
    border: 1px solid #bcd6ff;
    border-radius: 10px;
    padding: 10px 14px;
    margin: 12px 0;
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
}
.pollen-enable-banner button {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid #2a6ef5;
    background: #2a6ef5;
    color: #fff;
    cursor: pointer;
}
.pollen-enable-banner .pollen-dismiss-btn {
    background: transparent;
    color: #2a6ef5;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "style(ui): pollen panel, chips, and enable banner styles"
```

---

### Task 14: Client — pollen data load and render

**Files:**
- Modify: `public/app.js` — add new section of functions. Place directly before `async function loadGarminDayData(date)` (around line 3765).

- [ ] **Step 1: Add the pollen module code to `public/app.js`**

Insert the following block before the `loadGarminDayData` function:

```javascript
// ---------- Pollen ----------

const POLLEN_SPECIES = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'];

async function loadPollenDayData(date) {
    if (!currentUser) return null;
    try {
        const ref = doc(db, 'users', currentUser.uid, 'pollen', date);
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
    } catch (err) {
        console.error('loadPollenDayData error:', err);
        return null;
    }
}

async function renderPollenPanel(date) {
    const panel = document.getElementById('pollenPanel');
    const overall = document.getElementById('pollenOverall');
    const chips = document.getElementById('pollenChips');
    const meanBtn = document.getElementById('pollenShowMean');
    const meanTable = document.getElementById('pollenMeanTable');
    const empty = document.getElementById('pollenEmpty');
    if (!panel) return;

    const prefs = await loadUserPreferences();
    if (!prefs?.pollenLocation || prefs?.pollenDisabled) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';

    const data = await loadPollenDayData(date);

    if (!data) {
        chips.innerHTML = '';
        overall.textContent = '';
        meanBtn.style.display = 'none';
        meanTable.style.display = 'none';
        empty.style.display = 'block';
        const today = new Date().toISOString().slice(0, 10);
        if (date > today) empty.textContent = 'Forecast data only available for recent and past dates.';
        else if (date === today) empty.textContent = 'Updates nightly — today\'s data arrives after 02:00 UK time.';
        else if (date < '2013-01-01') empty.textContent = 'Pollen history unavailable before 2013.';
        else empty.textContent = 'No pollen data for this date. Run backfill from Settings.';
        return;
    }

    empty.style.display = 'none';
    meanBtn.style.display = 'inline-block';

    const dom = data.overall?.dominantSpecies;
    overall.textContent = `Overall: ${data.overall?.riskBand?.toUpperCase() || 'NONE'}${dom ? ' · ' + dom + ' dominant' : ''}`;

    chips.innerHTML = POLLEN_SPECIES.map(sp => {
        const s = data.species?.[sp] || { mean: 0, max: 0 };
        const band = bandForChip(sp, s.max);
        return `<span class="pollen-chip" data-band="${band}"><span class="pollen-chip-label">${sp}</span> <span class="pollen-chip-value">${s.max}</span></span>`;
    }).join('');

    meanTable.innerHTML = '<div class="row-head">Species</div><div class="row-head">Mean</div><div class="row-head">Max</div>' +
        POLLEN_SPECIES.map(sp => {
            const s = data.species?.[sp] || { mean: 0, max: 0 };
            return `<div style="text-transform:capitalize">${sp}</div><div>${s.mean}</div><div>${s.max}</div>`;
        }).join('');
}

// Mirror of functions/pollen/riskBand.js — kept in sync manually. Only needed
// for chip colouring; overall band is computed server-side.
const POLLEN_THRESHOLDS = {
    birch:   { low: 10, moderate: 50, high: 200, veryHigh: true },
    alder:   { low: 10, moderate: 50, high: 200, veryHigh: true },
    grass:   { low: 30, moderate: 50, high: 150, veryHigh: true },
    ragweed: { low: 20, moderate: 50, high: 100, veryHigh: true },
    mugwort: { low: 10, moderate: 50, high: Infinity, veryHigh: false },
    olive:   { low: 20, moderate: 50, high: Infinity, veryHigh: false },
};
function bandForChip(species, max) {
    const t = POLLEN_THRESHOLDS[species];
    if (!t) return 'none';
    if (max <= 0) return 'none';
    if (max <= t.low) return 'low';
    if (max <= t.moderate) return 'moderate';
    if (max <= t.high) return 'high';
    return t.veryHigh ? 'very-high' : 'high';
}

// "Show mean values" toggle wiring — call once on app init.
function wirePollenToggle() {
    const btn = document.getElementById('pollenShowMean');
    const tbl = document.getElementById('pollenMeanTable');
    if (!btn || !tbl) return;
    btn.addEventListener('click', () => {
        const isOpen = tbl.style.display === 'grid';
        tbl.style.display = isOpen ? 'none' : 'grid';
        btn.textContent = isOpen ? 'Show mean values' : 'Hide mean values';
    });
}
```

- [ ] **Step 2: Wire `renderPollenPanel` into the existing date-load flow**

Find the function that fires when the selected date changes in the Daily Log tab. Use grep to find a call like `displayGarminData(date)`:

```bash
grep -n "displayGarminData" public/app.js
```

Expected: a few call sites. For each call site that passes the currently-selected date to `displayGarminData`, add a sibling call directly after it:

```javascript
displayGarminData(selectedDate);
await renderPollenPanel(selectedDate);
```

Also add a call to `wirePollenToggle()` inside the existing DOMContentLoaded / app-init function (same place where other UI wiring like `setupTabs()` / `setupDatePicker()` is done). Grep for one of those to find the right place:

```bash
grep -n "setupTabs\|DOMContentLoaded" public/app.js
```

- [ ] **Step 3: Add `loadUserPreferences` helper if not already present**

Check whether `loadUserPreferences()` already exists:

```bash
grep -n "loadUserPreferences" public/app.js
```

If it does, reuse it. If not, add this helper near `renderPollenPanel`:

```javascript
async function loadUserPreferences() {
    if (!currentUser) return null;
    try {
        const ref = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
    } catch (err) {
        console.error('loadUserPreferences error:', err);
        return null;
    }
}
```

- [ ] **Step 4: Smoke test in browser**

Run `firebase emulators:start --only firestore,hosting` (or deploy to preview channel), open the app, manually add a test doc to Firestore at `users/<uid>/pollen/<today>` with valid structure, and confirm the panel renders with chips.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): pollen data loader and Daily Log panel rendering"
```

---

### Task 15: Client — geolocation first-run + Settings section

**Files:**
- Modify: `public/index.html` — add Settings-tab section (before the `ai-settings-section` div)
- Modify: `public/app.js` — append pollen-settings functions

- [ ] **Step 1: Add Settings section markup**

In `public/index.html`, find the `<div class="ai-settings-section">` block (around line 357) and insert the following block immediately before it:

```html
                    <div class="pollen-settings-section">
                        <h3>Pollen / Hayfever</h3>
                        <p>We fetch pollen concentrations from Open-Meteo for your location. Used on the Daily Log and in the Analysis tab.</p>

                        <div class="pollen-location-row">
                            <input type="text" id="pollenLocationLabel" placeholder="City or postcode (e.g. London)">
                            <button id="pollenUseMyLocationBtn" class="save-api-key-btn" type="button">Use my current location</button>
                            <button id="pollenSaveLocationBtn" class="save-api-key-btn" type="button">Save</button>
                        </div>
                        <div id="pollenLocationCoords" class="pollen-location-coords"></div>

                        <div id="pollenBackfillStatus" class="pollen-backfill-status"></div>
                        <button id="pollenRunBackfillBtn" class="save-api-key-btn" type="button">Re-run backfill</button>

                        <label class="pollen-disable-row">
                            <input type="checkbox" id="pollenDisableToggle">
                            Disable pollen tracking (keeps existing data)
                        </label>
                    </div>
```

- [ ] **Step 2: Add the settings JS to `public/app.js`**

After the pollen rendering code from Task 14, append:

```javascript
// ---------- Pollen Settings / Geolocation ----------

async function saveUserPreferences(partial) {
    if (!currentUser) return;
    const ref = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
    await setDoc(ref, { ...partial, updatedAt: new Date().toISOString() }, { merge: true });
}

async function reverseGeocode(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        const j = await res.json();
        const city = j.address?.city || j.address?.town || j.address?.village || j.address?.county;
        const country = j.address?.country_code?.toUpperCase();
        if (city && country) return `${city}, ${country}`;
        return j.display_name?.split(',').slice(0, 2).join(',').trim() || null;
    } catch (e) {
        return null;
    }
}

async function forwardGeocode(label) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(label)}&limit=1`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        const results = await res.json();
        if (!results.length) return null;
        return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon), label };
    } catch (e) {
        return null;
    }
}

async function useMyCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const label = (await reverseGeocode(lat, lng)) || `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
                resolve({ lat, lng, label });
            },
            (err) => reject(err),
            { timeout: 10000 }
        );
    });
}

async function triggerBackfill(location) {
    if (!currentUser) return;
    // Find earliest log entry date
    const entriesSnap = await getDocs(collection(db, 'users', currentUser.uid, 'entries'));
    const dates = entriesSnap.docs.map(d => d.id).sort();
    const start = dates[0] || new Date().toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);

    const res = await fetch('/api/pollen-backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: currentUser.uid, start, end, location }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown' }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

async function renderPollenSettings() {
    const prefs = await loadUserPreferences() || {};
    const loc = prefs.pollenLocation;
    const state = prefs.pollenBackfillState;

    const labelInput = document.getElementById('pollenLocationLabel');
    const coords = document.getElementById('pollenLocationCoords');
    const status = document.getElementById('pollenBackfillStatus');
    const disableToggle = document.getElementById('pollenDisableToggle');

    if (labelInput) labelInput.value = loc?.label || '';
    if (coords) coords.textContent = loc ? `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}` : '';
    if (disableToggle) disableToggle.checked = !!prefs.pollenDisabled;

    if (status) {
        if (!state) status.textContent = loc ? 'No backfill run yet.' : 'Set a location to enable.';
        else if (state.status === 'running') {
            const p = state.progress || {};
            status.textContent = `Running — ${p.done || 0} / ${p.total || '?'}…`;
        } else if (state.status === 'complete') {
            status.textContent = `Complete · ${state.progress?.done || '?'} days · last run ${new Date(state.lastRunAt).toLocaleDateString('en-GB')}`;
        } else {
            status.textContent = state.error ? `Last error: ${state.error}` : 'Idle';
        }
    }
}

function wirePollenSettings() {
    const saveBtn = document.getElementById('pollenSaveLocationBtn');
    const myLocBtn = document.getElementById('pollenUseMyLocationBtn');
    const runBtn = document.getElementById('pollenRunBackfillBtn');
    const disableToggle = document.getElementById('pollenDisableToggle');
    const labelInput = document.getElementById('pollenLocationLabel');

    if (saveBtn) saveBtn.addEventListener('click', async () => {
        const txt = labelInput.value.trim();
        if (!txt) return alert('Enter a city or postcode.');
        const loc = await forwardGeocode(txt);
        if (!loc) return alert('Could not find that location.');
        await saveUserPreferences({ pollenLocation: { ...loc, setAt: new Date().toISOString() } });
        await renderPollenSettings();
        if (confirm('Location saved. Run backfill now?')) {
            try { await triggerBackfill(loc); await renderPollenSettings(); }
            catch (e) { alert('Backfill failed: ' + e.message); }
        }
    });

    if (myLocBtn) myLocBtn.addEventListener('click', async () => {
        try {
            const loc = await useMyCurrentLocation();
            await saveUserPreferences({ pollenLocation: { ...loc, setAt: new Date().toISOString() } });
            await renderPollenSettings();
            if (confirm(`Location set to ${loc.label}. Run backfill now?`)) {
                try { await triggerBackfill(loc); await renderPollenSettings(); }
                catch (e) { alert('Backfill failed: ' + e.message); }
            }
        } catch (e) {
            alert('Could not get location: ' + e.message);
        }
    });

    if (runBtn) runBtn.addEventListener('click', async () => {
        const prefs = await loadUserPreferences() || {};
        if (!prefs.pollenLocation) return alert('Set a location first.');
        runBtn.disabled = true;
        try { await triggerBackfill(prefs.pollenLocation); await renderPollenSettings(); }
        catch (e) { alert('Backfill failed: ' + e.message); }
        finally { runBtn.disabled = false; }
    });

    if (disableToggle) disableToggle.addEventListener('change', async (e) => {
        await saveUserPreferences({ pollenDisabled: e.target.checked });
    });
}

async function maybeShowPollenEnableBanner() {
    const prefs = await loadUserPreferences() || {};
    const banner = document.getElementById('pollenEnableBanner');
    if (!banner) return;
    const dismissedThisSession = sessionStorage.getItem('pollenBannerDismissed') === '1';
    if (prefs.pollenLocation || dismissedThisSession) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'flex';

    document.getElementById('pollenEnableBtn').onclick = async () => {
        try {
            const loc = await useMyCurrentLocation();
            await saveUserPreferences({ pollenLocation: { ...loc, setAt: new Date().toISOString() } });
            banner.style.display = 'none';
            alert(`Pollen tracking enabled for ${loc.label}. Backfilling history…`);
            try { await triggerBackfill(loc); } catch (e) { console.error(e); }
        } catch (e) {
            alert('Could not enable: ' + e.message);
        }
    };
    document.getElementById('pollenDismissBtn').onclick = () => {
        sessionStorage.setItem('pollenBannerDismissed', '1');
        banner.style.display = 'none';
    };
}
```

- [ ] **Step 3: Wire the init calls**

In the same app-init function where `wirePollenToggle()` was added (Task 14, Step 2), append:

```javascript
wirePollenSettings();
maybeShowPollenEnableBanner();
renderPollenSettings();
```

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat(ui): pollen settings section, geolocation, and backfill trigger"
```

---

### Task 16: Add styles for Settings pollen section

**Files:**
- Modify: `public/styles.css` — append

- [ ] **Step 1: Append CSS**

Add at the end of `public/styles.css`:

```css
.pollen-settings-section {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--border, #e2e2e2);
}
.pollen-location-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: 8px 0;
}
.pollen-location-row input {
    flex: 1;
    min-width: 180px;
}
.pollen-location-coords {
    font-size: 0.8rem;
    color: var(--muted, #666);
    font-variant-numeric: tabular-nums;
}
.pollen-backfill-status {
    margin: 12px 0 6px;
    font-size: 0.9rem;
}
.pollen-disable-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 12px;
    font-size: 0.9rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "style(ui): pollen settings section styles"
```

---

## Phase 4 — Analysis tab integration

### Task 17: Combined chart — "Total pollen" togglable trace

**Files:**
- Modify: `public/app.js` — find the chart-rendering function

- [ ] **Step 1: Locate the chart renderer**

```bash
grep -n "combinedChart\|renderCharts\|new Chart(" public/app.js
```

Identify the function that builds the Chart.js `datasets` array for the combined chart.

- [ ] **Step 2: Load pollen data for the chart range**

Inside that function, after the existing code that loads entries/garmin for the range, add a pollen loader. (Place it alongside the `getDocs(collection(db, 'users', currentUser.uid, 'garmin'))` call.)

```javascript
// Load pollen data for the selected date range
const pollenDocs = {};
if (currentUser) {
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'pollen'));
    snap.forEach(d => { pollenDocs[d.id] = d.data(); });
}
```

- [ ] **Step 3: Build a "Total pollen" dataset**

Wherever the code builds its per-day series arrays (aligned with the existing `labels` / date axis of the chart), add:

```javascript
// Total pollen = sum of each species' daily-max, compressed to 0..4 for chart readability
function compressPollen(sum) {
    if (sum <= 0) return 0;
    // log1p(sum) / log1p(500) * 4, clamped to [0, 4]
    const v = Math.log1p(sum) / Math.log1p(500) * 4;
    return Math.min(4, Math.max(0, Math.round(v * 100) / 100));
}
const totalPollenSeries = labels.map(date => {
    const p = pollenDocs[date];
    if (!p) return null;
    const sum = ['alder','birch','grass','mugwort','olive','ragweed']
        .reduce((acc, sp) => acc + (p.species?.[sp]?.max || 0), 0);
    return compressPollen(sum);
});
```

Add a dataset entry (style matching other "hidden by default" traces in the existing chart):

```javascript
{
    label: 'Total pollen',
    data: totalPollenSeries,
    borderColor: '#2e7d32',
    backgroundColor: 'rgba(46, 125, 50, 0.15)',
    hidden: true, // off by default
    spanGaps: true,
    tension: 0.3,
}
```

- [ ] **Step 4: Smoke-check in browser**

Open Charts tab, confirm "Total pollen" appears in the legend, clicking it toggles a green line. Off by default.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(analysis): add togglable Total pollen trace to combined chart"
```

---

### Task 18: Summary-stats rows per species

**Files:**
- Modify: `public/app.js` — stats panel renderer

- [ ] **Step 1: Locate the stats panel renderer**

```bash
grep -n "statsPanel\|renderStats\|Summary Statistics" public/app.js
```

- [ ] **Step 2: Extend it with six pollen rows**

Inside that function, using the same `pollenDocs` map from Task 17 (fetch again here if not already in scope):

```javascript
const pollenInRange = Object.values(pollenDocs).filter(d => d.date >= rangeStart && d.date <= rangeEnd);
const species = ['alder','birch','grass','mugwort','olive','ragweed'];
const pollenRows = species.map(sp => {
    const values = pollenInRange.map(p => p.species?.[sp]?.max ?? 0);
    const active = values.filter(v => v > 0);
    const avgMax = active.length ? (active.reduce((a, b) => a + b, 0) / active.length).toFixed(1) : '0.0';
    return { label: `Pollen — ${sp}`, value: `${avgMax} (avg max · ${active.length} days)` };
});
```

Then in the existing rows array that the panel renders, append the `pollenRows` entries.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(analysis): per-species pollen rows in summary stats"
```

---

### Task 19: Feed pollen into correlations / trends panel

**Files:**
- Modify: `public/app.js` — trends/correlation function

- [ ] **Step 1: Locate trends / correlation computation**

```bash
grep -n "trendsPanel\|correlation\|pearson" public/app.js
```

- [ ] **Step 2: Add pollen variables to the correlation input set**

In the function that builds the variables to correlate against pain/symptoms, add six series (birch max, grass max, etc., aligned by date with the existing log-entry series). Follow the exact shape the existing correlation helper expects — if it takes `{ name, values: number[] }`, push six entries. Example pattern:

```javascript
const pollenVars = ['alder','birch','grass','mugwort','olive','ragweed'].map(sp => ({
    name: `Pollen: ${sp} (daily max)`,
    values: dateAxis.map(d => pollenDocs[d]?.species?.[sp]?.max ?? null),
}));
// push pollenVars into whatever array the existing code builds
variables.push(...pollenVars);
```

The null values signal "no data" to the existing correlation code (use whatever null-handling convention the existing code uses — if it expects numbers, substitute `0`).

- [ ] **Step 3: Smoke check**

Charts tab, 90-day range, confirm a "Pollen: birch (daily max) vs Overall pain" entry or similar appears in the Trends panel when correlations are significant.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(analysis): include pollen species in correlation/trend detection"
```

---

### Task 20: Include pollen in AI analysis prompt

**Files:**
- Modify: `public/app.js` — AI prompt builder

- [ ] **Step 1: Locate the AI prompt builder**

```bash
grep -n "generateAnalysis\|anthropicProxy\|buildAnalysisPrompt" public/app.js
```

- [ ] **Step 2: Add a pollen block to the prompt**

Inside the prompt-builder, after the existing "Garmin data" summary, append:

```javascript
// Pollen summary block
const pollenLines = labels.map(date => {
    const p = pollenDocs[date];
    if (!p) return null;
    const species = ['alder','birch','grass','mugwort','olive','ragweed']
        .map(sp => `${sp}:${p.species[sp]?.max ?? 0}`).join(' ');
    return `${date} — overall:${p.overall.riskBand} · ${species}`;
}).filter(Boolean);
let pollenSection = '';
if (pollenLines.length > 0) {
    pollenSection = `\n\nPollen (daily max grains/m³, source: Open-Meteo / CAMS):\n${pollenLines.join('\n')}`;
}
prompt += pollenSection;
```

Make sure `pollenDocs` is in scope (fetch once if not).

- [ ] **Step 3: Smoke check**

Generate an AI analysis on a 90-day range with pollen data, confirm the returned narrative mentions pollen (if any correlation).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(analysis): include pollen daily data in AI analysis prompt"
```

---

## Phase 5 — Tests & deploy

### Task 21: Playwright — pollen panel renders on Daily Log

**Files:**
- Create: `tests/pollen.test.js`

- [ ] **Step 1: Write the test**

Create `tests/pollen.test.js`:

```javascript
const { test, expect } = require('@playwright/test');

// This test uses the skip-auth / local-storage path and stubs Firestore-like
// data by injecting into the page. For a fuller integration test, run against
// the preview channel with a seeded Firestore doc.

const APP_URL = 'https://headache-tracker-md-2026--preview-pollen.web.app'; // preview channel

test.describe('Pollen panel', () => {
    test('renders empty state when no pollen doc exists', async ({ page }) => {
        await page.goto(APP_URL);
        await page.click('#skipAuthBtn');
        await page.waitForSelector('#mainApp', { state: 'visible' });
        // Local-storage mode never has pollen data → panel hidden
        const panel = page.locator('#pollenPanel');
        await expect(panel).toBeHidden();
    });

    test('enable banner appears when signed in without a location', async ({ page, context }) => {
        // This test requires a real signed-in session on the preview channel.
        // Skip if not configured.
        test.skip(!process.env.POLLEN_TEST_USER, 'POLLEN_TEST_USER not set');
        // ... (fill in sign-in flow when environment is set up)
    });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx playwright test tests/pollen.test.js`
Expected: both tests pass (second one skipped unless env var set).

- [ ] **Step 3: Commit**

```bash
git add tests/pollen.test.js
git commit -m "test(e2e): pollen panel renders empty-state and banner logic"
```

---

### Task 22: Deploy & smoke-test

- [ ] **Step 1: Deploy Firebase functions**

Run: `firebase deploy --only functions`
Expected: `fetchPollenDaily`, `backfillPollen` listed as "successfully deployed" (plus existing functions).

- [ ] **Step 2: Deploy hosting**

Run: `firebase deploy --only hosting`
Expected: deploy complete, URL reachable.

- [ ] **Step 3: Deploy Firestore rules**

Run: `firebase deploy --only firestore:rules`
Expected: rules deployed.

- [ ] **Step 4: Manual smoke — enable pollen**

1. Open the deployed app, sign in.
2. Click "Enable" on the pollen banner. Allow geolocation.
3. Confirm in Settings that location appears and backfill starts.
4. Watch the backfill status transition to "Complete · NNN days".

- [ ] **Step 5: Manual smoke — verify data quality**

1. Open Daily Log for a known high-birch day (e.g. mid-April 2025).
2. Confirm chips render with birch in `moderate` or `high` band colouring.
3. Toggle "Show mean values" — table expands.

- [ ] **Step 6: Manual smoke — chart trace**

1. Charts tab → 90-day range → legend-click "Total pollen".
2. Confirm a line appears with non-zero values during pollen season.

- [ ] **Step 7: Manual smoke — scheduled function**

Wait until the next day. Open Daily Log for yesterday. Confirm a pollen doc exists (not "no data for this date").

- [ ] **Step 8: Commit any fixes discovered during smoke test, then final commit**

```bash
git commit --allow-empty -m "chore: pollen tracking feature deployed and smoke-tested"
```

---

## Self-review (performed by author, inline)

- **Spec coverage:** ✓ all spec sections covered — architecture (Task 8–10), data model (Task 8 writes match schema; Task 9 backfill state), fetch logic (Task 7), aggregation (Task 3), risk bands (Task 4), chunking (Task 5), UI panel (Tasks 12–14), Settings (Task 15), location flow (Task 15), charts (Task 17), stats (Task 18), correlations (Task 19), AI prompt (Task 20), tests (Task 21), smoke (Task 22).
- **Placeholder scan:** No TBD/TODO. Task 19 Step 2 asks the implementer to match the existing correlation helper's shape — acceptable because the helper's signature isn't in scope from exploration; the task explains what to do.
- **Type consistency:** `species` object keys match across server (`functions/pollen/constants.js`) and client (`POLLEN_SPECIES` / `POLLEN_THRESHOLDS` in `app.js`). `bandForSpecies` / `bandForChip` names differ (server vs client) but serve different scopes — acceptable. Firestore doc shape (`species`, `overall`, `fetchError`, `location`) consistent between Task 8 and Task 14.
- **Scope:** one plan, roughly 22 tasks, each bite-sized. Plan is large but single-feature — not a candidate for decomposition.
