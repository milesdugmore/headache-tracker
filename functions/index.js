const { onRequest } = require('firebase-functions/v2/https');
const https = require('https');
const { GarminConnect } = require('garmin-connect');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const adminApp = initializeApp();
const firestore = getFirestore(adminApp);

// Helper: get an authenticated Garmin client using cached tokens only
// Never attempts SSO login from Cloud Functions (Garmin rate-limits cloud IPs)
async function getGarminClient(username) {
    const tokenDocId = Buffer.from(username).toString('base64').replace(/[/+=]/g, '_');
    const tokenRef = firestore.collection('garminTokens').doc(tokenDocId);

    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) {
        throw new Error('NO_TOKENS: No Garmin tokens found. Please run "Connect Garmin" from the app to authenticate.');
    }

    const { oauth1, oauth2, savedAt } = tokenDoc.data();
    if (!oauth1 || !oauth2) {
        throw new Error('NO_TOKENS: Invalid cached tokens. Please re-authenticate via "Connect Garmin".');
    }

    const GCClient = new GarminConnect({ username, password: 'unused' });
    GCClient.loadToken(oauth1, oauth2);
    console.log('Garmin auth: loaded cached tokens (saved: ' + savedAt + ')');
    return { client: GCClient, tokenRef };
}

// Helper: save new tokens after a successful refresh
async function updateCachedTokens(GCClient, tokenRef) {
    try {
        const tokens = GCClient.exportToken();
        if (tokens.oauth1 && tokens.oauth2) {
            await tokenRef.set({
                oauth1: tokens.oauth1,
                oauth2: tokens.oauth2,
                savedAt: new Date().toISOString()
            });
            console.log('Garmin auth: tokens refreshed and cached');
        }
    } catch (e) {
        console.warn('Could not update cached tokens:', e.message);
    }
}

// Helper: fetch and extract all Garmin data for a single date
async function fetchGarminDayData(GCClient, dateString) {
    const dateObj = new Date(dateString + 'T12:00:00');

    const results = await Promise.allSettled([
        GCClient.getSteps(dateObj),
        GCClient.getSleepData(dateObj),
        GCClient.getHeartRate(dateObj),
        GCClient.client.get(
            `https://connectapi.garmin.com/wellness-service/wellness/dailyStress/${dateString}`
        ),
    ]);

    const [stepsResult, sleepResult, heartRateResult, stressResult] = results;

    const steps = stepsResult.status === 'fulfilled' ? stepsResult.value : null;

    let sleepHours = null;
    let sleepScore = null;
    let bodyBatteryHigh = null;
    let bodyBatteryLow = null;
    let hrvValue = null;
    if (sleepResult.status === 'fulfilled' && sleepResult.value) {
        const sd = sleepResult.value.dailySleepDTO;
        if (sd) {
            if (sd.sleepStartTimestampGMT && sd.sleepEndTimestampGMT) {
                sleepHours = Math.round(((sd.sleepEndTimestampGMT - sd.sleepStartTimestampGMT) / 3600000) * 10) / 10;
            }
            sleepScore = sd.sleepScores?.overall?.value || null;
        }
        // Body Battery from sleep data
        const bbData = sleepResult.value.sleepBodyBattery;
        if (Array.isArray(bbData) && bbData.length > 0) {
            const bbValues = bbData.map(b => b.value).filter(v => v != null);
            if (bbValues.length > 0) {
                bodyBatteryHigh = Math.max(...bbValues);
                bodyBatteryLow = Math.min(...bbValues);
            }
        }
        // HRV from sleep data
        hrvValue = sleepResult.value.avgOvernightHrv || null;
    }

    let restingHR = null;
    let maxHR = null;
    if (heartRateResult.status === 'fulfilled' && heartRateResult.value) {
        restingHR = heartRateResult.value.restingHeartRate || null;
        maxHR = heartRateResult.value.maxHeartRate || null;
    }

    let avgStress = null;
    let maxStress = null;
    if (stressResult.status === 'fulfilled' && stressResult.value) {
        avgStress = stressResult.value.overallStressLevel || stressResult.value.avgStressLevel || null;
        maxStress = stressResult.value.maxStressLevel || null;
    }

    return {
        date: dateString,
        steps,
        sleepHours,
        sleepScore,
        restingHR,
        maxHR,
        avgStress,
        maxStress,
        bodyBatteryHigh,
        bodyBatteryLow,
        hrv: hrvValue,
    };
}

// Check Garmin token status
exports.garminTokenStatus = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'], timeoutSeconds: 10 },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        const { username } = req.body;
        if (!username) {
            res.status(400).json({ error: 'Missing username' });
            return;
        }

        try {
            const tokenDocId = Buffer.from(username).toString('base64').replace(/[/+=]/g, '_');
            const tokenDoc = await firestore.collection('garminTokens').doc(tokenDocId).get();

            if (!tokenDoc.exists) {
                res.json({ status: 'missing', message: 'No tokens found. Please connect Garmin.' });
                return;
            }

            const { oauth2, savedAt } = tokenDoc.data();
            const refreshExpiresAt = oauth2?.refresh_token_expires_at;
            const now = Date.now() / 1000;

            if (!refreshExpiresAt || refreshExpiresAt < now) {
                res.json({ status: 'expired', message: 'Tokens expired. Please reconnect Garmin.' });
            } else {
                const daysLeft = Math.round((refreshExpiresAt - now) / 86400);
                res.json({
                    status: daysLeft <= 5 ? 'expiring_soon' : 'valid',
                    daysLeft,
                    savedAt,
                    message: daysLeft <= 5 ? `Tokens expire in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Please reconnect soon.` : 'Tokens valid'
                });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
);

// Upload Garmin OAuth tokens (obtained from local login)
exports.garminUploadTokens = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'], timeoutSeconds: 30 },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        const { username, oauth1, oauth2 } = req.body;
        if (!username || !oauth1 || !oauth2) {
            res.status(400).json({ error: 'Missing username, oauth1, or oauth2' });
            return;
        }

        try {
            const tokenDocId = Buffer.from(username).toString('base64').replace(/[/+=]/g, '_');
            await firestore.collection('garminTokens').doc(tokenDocId).set({
                oauth1,
                oauth2,
                savedAt: new Date().toISOString()
            });

            // Verify tokens work by making a test call
            const GCClient = new GarminConnect({ username, password: 'unused' });
            GCClient.loadToken(oauth1, oauth2);
            try {
                await GCClient.getUserProfile();
                res.json({ success: true, message: 'Tokens saved and verified' });
            } catch (e) {
                res.json({ success: true, message: 'Tokens saved (verification skipped)', warning: e.message });
            }
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to save tokens' });
        }
    }
);

// Debug endpoint to see raw Garmin API responses
exports.garminDebug = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'], timeoutSeconds: 60 },
    async (req, res) => {
        if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
        const { username, date } = req.body;
        if (!username || !date) { res.status(400).json({ error: 'Missing username or date' }); return; }

        try {
            const { client: GCClient, tokenRef } = await getGarminClient(username);
            const dateObj = new Date(date + 'T12:00:00');
            const results = await Promise.allSettled([
                GCClient.getSleepData(dateObj),
                GCClient.client.get(
                    `https://connectapi.garmin.com/usersummary-service/usersummary/daily/${date}`,
                    { params: { calendarDate: date } }
                ),
                GCClient.client.get(
                    `https://connectapi.garmin.com/wellness-service/wellness/bodyBattery?date=${date}`
                ),
                GCClient.client.get(
                    `https://connectapi.garmin.com/hrv-service/hrv/${date}`
                ),
            ]);

            const extract = (i) => results[i]?.status === 'fulfilled' ? results[i].value : { error: results[i]?.reason?.message || 'no result' };
            const raw = {
                sleep: extract(0),
                dailySummary: extract(1),
                bodyBattery: extract(2),
                hrv: extract(3),
            };

            await updateCachedTokens(GCClient, tokenRef);
            res.json(raw);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
);

// Single-date Garmin sync (uses cached tokens only — no SSO login)
exports.garminSync = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'], timeoutSeconds: 60 },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        const { username, date } = req.body;
        if (!username || !date) {
            res.status(400).json({ error: 'Missing username or date' });
            return;
        }

        try {
            const { client: GCClient, tokenRef } = await getGarminClient(username);
            const data = await fetchGarminDayData(GCClient, date);
            // Update cached tokens in case the library refreshed them
            await updateCachedTokens(GCClient, tokenRef);
            res.json(data);
        } catch (err) {
            const status = err.message.startsWith('NO_TOKENS') ? 401 : 500;
            res.status(status).json({ error: err.message || 'Garmin sync failed' });
        }
    }
);

// Bulk Garmin sync - fetches multiple dates in one call (uses cached tokens only)
exports.garminBulkSync = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'], timeoutSeconds: 540, memory: '512MiB' },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        const { username, dates } = req.body;
        if (!username || !dates || !Array.isArray(dates) || dates.length === 0) {
            res.status(400).json({ error: 'Missing username or dates array' });
            return;
        }

        // Cap at 30 dates per request to stay within timeout
        const datesToFetch = dates.slice(0, 30);

        try {
            const { client: GCClient, tokenRef } = await getGarminClient(username);
            const results = [];

            for (const date of datesToFetch) {
                try {
                    const data = await fetchGarminDayData(GCClient, date);
                    results.push(data);
                } catch (err) {
                    results.push({ date, error: err.message });
                }
                // Small delay between dates to be gentle on Garmin's API
                if (datesToFetch.indexOf(date) < datesToFetch.length - 1) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            // Update cached tokens in case the library refreshed them
            await updateCachedTokens(GCClient, tokenRef);
            res.json({ results, total: dates.length, fetched: datesToFetch.length });
        } catch (err) {
            const status = err.message.startsWith('NO_TOKENS') ? 401 : 500;
            res.status(status).json({ error: err.message || 'Garmin bulk sync failed' });
        }
    }
);

// Proxy for Anthropic API calls (browser CORS workaround)
exports.anthropicProxy = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'], timeoutSeconds: 300 },
    (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        const { apiKey, prompt } = req.body;
        if (!apiKey || !prompt) {
            res.status(400).json({ error: { message: 'Missing apiKey or prompt' } });
            return;
        }

        const postData = JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 8192,
            messages: [{ role: 'user', content: prompt }]
        });

        const options = {
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const proxyReq = https.request(options, (proxyRes) => {
            let data = '';
            proxyRes.on('data', chunk => data += chunk);
            proxyRes.on('end', () => {
                try {
                    res.status(proxyRes.statusCode).json(JSON.parse(data));
                } catch (e) {
                    res.status(500).json({ error: { message: 'Invalid response from Anthropic API' } });
                }
            });
        });

        proxyReq.on('error', (e) => {
            res.status(500).json({ error: { message: e.message } });
        });

        proxyReq.write(postData);
        proxyReq.end();
    }
);

// Vision endpoint: analyse meal photo and return structured food log
exports.analyseFood = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'], timeoutSeconds: 60 },
    (req, res) => {
        if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

        const { apiKey, imageBase64, mediaType } = req.body;
        if (!apiKey || !imageBase64) {
            res.status(400).json({ error: { message: 'Missing apiKey or imageBase64' } });
            return;
        }

        const prompt = `You are a nutrition and food identification expert. Analyse this meal photo in detail.

Return a JSON object with this exact structure:
{
  "mealType": "breakfast|lunch|dinner|snack|drink",
  "description": "One sentence description of the meal",
  "ingredients": [
    {
      "name": "ingredient name",
      "category": "protein|carb|vegetable|fruit|dairy|fat|condiment|drink|other",
      "estimated_quantity": "e.g. 150g, 1 cup, 2 slices",
      "notes": "any relevant notes e.g. fried, raw, processed"
    }
  ],
  "estimated_calories": 500,
  "potential_headache_triggers": ["list any known headache triggers present e.g. caffeine, alcohol, MSG, tyramine-rich foods, artificial sweeteners, nitrates, aged cheese, chocolate, citrus"],
  "histamine_score": 2,
  "histamine_notes": "Brief explanation of why e.g. 'Contains aged cheese and wine, both high in histamine'",
  "confidence": "high|medium|low"
}

Histamine score guide (0-4):
0 = Very low/none (fresh meat, most vegetables, rice, most fruits)
1 = Low (some fresh fish, eggs, some dairy)
2 = Moderate (some processed foods, certain vegetables like tomatoes/spinach)
3 = High (aged cheeses, cured meats, fermented foods, alcohol, vinegar)
4 = Very high (combination of multiple high-histamine foods, strong ferments, very aged products)

Be as detailed and specific as possible about ingredients. Identify cooking methods, likely sauces/dressings, bread types, meat cuts etc. Only return valid JSON, no other text.`;

        const postData = JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType || 'image/jpeg',
                            data: imageBase64
                        }
                    },
                    { type: 'text', text: prompt }
                ]
            }]
        });

        const options = {
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const proxyReq = https.request(options, (proxyRes) => {
            let data = '';
            proxyRes.on('data', chunk => data += chunk);
            proxyRes.on('end', () => {
                try {
                    res.status(proxyRes.statusCode).json(JSON.parse(data));
                } catch (e) {
                    res.status(500).json({ error: { message: 'Invalid response from Anthropic API' } });
                }
            });
        });

        proxyReq.on('error', (e) => res.status(500).json({ error: { message: e.message } }));
        proxyReq.write(postData);
        proxyReq.end();
    }
);
