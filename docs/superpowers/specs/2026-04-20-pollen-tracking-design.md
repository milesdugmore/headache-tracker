# Pollen / Hayfever Tracking — Design

**Date:** 2026-04-20
**Status:** Approved (brainstorm); implementation pending
**Scope:** Add daily pollen data to the headache tracker, covering display on the Daily Log, overlay/stats/AI on the Analysis tab, and a nightly automatic ingest with one-shot historical backfill.

## Goal

Give the user per-day, per-species pollen concentration data for their location so they can spot correlations between hayfever exposure (birch, grass, etc.) and headache symptoms. Data should appear as context on the Daily Log and feed into the Analysis tab's charts, stats, trends, and AI narrative.

## Data source

**Open-Meteo Air Quality API** — `https://air-quality-api.open-meteo.com/v1/air-quality`.

Chosen because it is:

- Keyless for non-commercial / personal use, no signup.
- Provides six species as hourly concentrations in grains/m³: `alder_pollen`, `birch_pollen`, `grass_pollen`, `mugwort_pollen`, `olive_pollen`, `ragweed_pollen`.
- Backed by the CAMS European model with historical data from 2013 onwards — supports full backfill.
- Covers London at 11 km resolution; covers Europe broadly if the user travels.

**Not in scope:** mold/fungi data (no public API covers it at the same price point).

## Architecture

Three components:

1. **Client (`public/app.js`)** — browser geolocation, writes location to the user's Firestore profile, reads pollen docs from Firestore for display, charts, correlations, and AI prompt construction. No direct Open-Meteo calls.

2. **Scheduled Cloud Function `fetchPollenDaily`** (`functions/index.js`) — Pub/Sub cron, runs nightly at ~02:00 Europe/London. Iterates users with a stored `pollenLocation`; for each, fetches yesterday's pollen from Open-Meteo, aggregates hourly → daily mean+max per species, writes one Firestore doc.

3. **Callable Cloud Function `backfillPollen`** — invoked by the client after location is first set, or manually from a Settings button. Fetches the full historical range (earliest log entry date → today) in 90-day chunks, writes one doc per day. Idempotent (overwrites).

No API keys to store anywhere.

## Firestore schema

### New collection: `users/{uid}/pollen/{YYYY-MM-DD}`

One document per day per user. Date doubles as the doc ID.

```
{
  date: "2026-04-19",
  location: { lat: 51.5074, lng: -0.1278 },
  fetchedAt: Timestamp,
  source: "open-meteo",
  species: {
    alder:   { mean: 0.3,  max: 1.1 },
    birch:   { mean: 12.4, max: 48.0 },
    grass:   { mean: 2.1,  max: 6.7 },
    mugwort: { mean: 0.0,  max: 0.0 },
    olive:   { mean: 0.0,  max: 0.0 },
    ragweed: { mean: 0.0,  max: 0.0 }
  },
  overall: {
    maxOfMax: 48.0,
    riskBand: "high",          // low | moderate | high | very-high
    dominantSpecies: "birch"
  },
  fetchError: null              // string if fetch failed; daily cron retries
}
```

Notes:

- All concentrations in grains/m³ (Open-Meteo native unit).
- Nulls from the API (e.g. species out of season) are stored as `0`, not null, so charts never break on arithmetic.
- Location is snapshotted into each doc so moving later doesn't rewrite history.
- `overall.riskBand` is derived from `max` per species using per-species UK thresholds (see below) and set to the worst band across species.

### Additions to `users/{uid}` profile

```
pollenLocation: {
  lat: Number,
  lng: Number,
  label: "London, UK",          // reverse-geocoded
  setAt: Timestamp
}

pollenBackfillState: {
  status: "idle" | "running" | "complete",
  earliestDate: "2023-06-01",
  lastRunAt: Timestamp,
  progress: { done: Number, total: Number }   // when running
}
```

## Fetch logic

### Single-day fetch (used by scheduled function)

Request:

```
GET https://air-quality-api.open-meteo.com/v1/air-quality
    ?latitude={lat}
    &longitude={lng}
    &hourly=alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen
    &start_date={YYYY-MM-DD}
    &end_date={YYYY-MM-DD}
    &timezone=Europe/London
```

Response gives 24 hourly values per species.

Aggregation per species:

- `mean` = average of non-null values; if all 24 are null, store `0`.
- `max` = max of non-null values; if all null, store `0`.

### Backfill chunking

Open-Meteo caps historical queries at ~92 days per call. Backfill:

1. Determine `earliestDate` = earliest log entry date (read from existing entries collection) and `latestDate` = today.
2. Split range into 90-day windows.
3. Fetch each window sequentially with a ~200ms delay between calls.
4. For each window, iterate the day-by-day response and write one Firestore doc per day.
5. Update `pollenBackfillState.progress` after each chunk.
6. For a 3-year backfill (~1,100 days) this is ~12 requests, completes in well under a minute.

### Risk-band thresholds (grains/m³, daily max)

Stored as a constants object in `functions/index.js`, easy to tweak:

| Species | low | moderate | high | very-high |
|---------|-----|----------|------|-----------|
| birch   | 1–10 | 11–50 | 51–200 | 200+ |
| alder   | 1–10 | 11–50 | 51–200 | 200+ |
| grass   | 1–30 | 31–50 | 51–150 | 150+ |
| ragweed | 1–20 | 21–50 | 51–100 | 100+ |
| mugwort | 1–10 | 11–50 | 51+    | —    |
| olive   | 1–20 | 21–50 | 51+    | —    |

Based on Met Office / European Aeroallergen Network conventions; revisit once we see real data.

### Error handling

- Network error during single-day fetch → retry once after 1s → on persistent failure, write doc with `fetchError: "..."` and zeroed species.
- Daily cron at the start of each run also looks for docs with `fetchError` set in the last 7 days for each user and retries them opportunistically.
- Dates before 2013-01-01 (pre-CAMS coverage) → skipped with a log warning during backfill.
- User has no `pollenLocation` → scheduled function skips silently; backfill function rejects with `failed-precondition` and a user-readable message.
- Backfill re-run on already-populated range → overwrites (idempotent).
- Callable function timeout (9 min) → persist `pollenBackfillState.progress`; resume on next invocation from the last incomplete date.

## Location handling

### First-run

1. On first visit after this feature ships, a small dismissable banner on the Daily Log tab: *"Enable pollen tracking? We'll use your location once to set up local pollen data."* with Enable / Dismiss / Ask later.
2. On Enable, call `navigator.geolocation.getCurrentPosition()`.
3. On success: reverse-geocode via Nominatim (`https://nominatim.openstreetmap.org/reverse`) to get a human label. Write `pollenLocation` to profile. Fire-and-forget call to `backfillPollen`. Show toast: "Backfilling pollen history…".
4. On geolocation denial or failure: show the Settings-tab location input as a fallback.

### Settings tab — new "Pollen / Hayfever" section

- Location: text field (city/postcode, forward-geocoded via Nominatim on save) + "Use my current location" button + lat/lng shown small beneath.
- Backfill status line: "Complete · 1,247 days · ran 2 days ago" / "Running — 340 / 1,247…".
- "Re-run backfill" button.
- "Disable pollen tracking" toggle (stops scheduled fetch, keeps existing data).

### Privacy

Geolocation is one-shot, stored only in the user's own Firestore profile, never shared. Matches how the app handles Garmin credentials.

### Moving

If the user updates their location later, we do **not** rewrite history — the snapshotted `location` in each pollen doc was correct for that date. They can manually re-run backfill if they genuinely want to overwrite.

## UI

### Daily Log tab — new Pollen panel

Placed between the Garmin panel and the Food Checker. Reads the single Firestore doc matching the currently-selected date.

Layout:

```
┌─ Pollen ─────────────────────────────── ⓘ ─┐
│  Overall: HIGH  ·  birch dominant            │
│  [birch 48] [grass 7] [alder 1] [others 0]   │   ← daily max chips, colour-coded per-species band
│  ▸ Show mean values                          │
└──────────────────────────────────────────────┘
```

- No "Sync" buttons (scheduled function already populates).
- Chips colour-coded by the species' own risk band (not overall).
- Expanding "Show mean values" reveals a small table with species / mean / max columns.
- Empty state for a missing date:
  - Date in backfill range → "No pollen data for this date · Run backfill" (link to Settings).
  - Today before nightly cron has run → "Updates nightly".
  - Date before 2013 → "Pollen history unavailable before 2013".

### Analysis tab

- **Combined chart** — one new togglable series "Total pollen" = sum of the six daily-max values, log-compressed into the chart's 0-4 axis so birch spikes don't dwarf other traces. Off by default. Single checkbox in the legend.
- **Stats panel (Summary Statistics)** — six new rows, one per species, showing average daily max and count of days-with-any-pollen (max > 0) across the selected range.
- **Trends panel** — pollen species feed into the existing trend/correlation computations. Entries like "Overall pain correlates with birch pollen (r=0.42, n=118)" can surface alongside existing trends when the correlation clears whatever significance bar the panel already applies.
- **AI Analysis** — the prompt sent to Anthropic's API gets a new "Pollen" section listing daily mean+max for each species across the selected range, so the generated narrative can reference pollen patterns.

### Settings tab

New "Pollen / Hayfever" section, described under Location handling above.

## Testing

### Unit (`functions/`)

- Aggregation: hourly → mean/max, including null handling.
- Risk-band calculator per species, including boundary values and the "no `very-high`" species (mugwort/olive).
- Date-range chunker: verifies a range splits into the expected 90-day windows.

### Integration (`functions/`)

- Mock Open-Meteo with a fixture response; assert the written Firestore doc has the expected shape.
- Fetch-failure path: assert `fetchError` is written and species zeroed.
- Backfill resumption: simulate a timeout partway through, reinvoke, assert it resumes at the right date.

### Client (`public/`, Playwright)

- Stub a pollen doc in Firestore; verify the Pollen panel renders, chips are present, "Show mean values" expands, and "Total pollen" legend checkbox draws the trace.
- Stub empty state cases (missing date in range, today pre-cron, pre-2013).
- Settings → "Use my current location" flow: mock geolocation, assert profile write and backfill call.

### Manual smoke

- Deploy to Firebase preview channel.
- Run backfill on the real account, eyeball a week of data, confirm a known high-birch day (e.g. mid-April) shows high band.
- Leave scheduled function running one night; next day confirm yesterday's doc exists.

## Out of scope

- Mold / fungi data.
- Per-entry location (pollen for wherever the user was that specific day) — a single stable location is adequate for v1.
- Push notifications or threshold alerts.
- Sharing pollen data across users, or any multi-tenant features.
- Mobile-specific UI beyond what the existing responsive styles provide.

## Open questions

None — all resolved during brainstorm:

- Source: Open-Meteo (keyless, historical, species-level).
- Allergens: all six Open-Meteo species.
- Aggregation: store both daily mean and daily max.
- Location: browser geolocation with manual override in Settings.
- Sync: fully automatic (scheduled cron + one-shot backfill callable).
- Daily Log display: compact summary with per-species max chips and collapsed mean values.
- Analysis: combined chart "Total pollen" trace + stats rows + correlations + AI prompt inclusion.
- Backfill scope: every date from earliest log entry to today.
