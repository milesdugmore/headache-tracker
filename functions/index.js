const { onRequest } = require('firebase-functions/v2/https');
const https = require('https');

// Proxy for Anthropic API calls (browser CORS workaround)
exports.anthropicProxy = onRequest(
    { cors: ['https://headache-tracker-md-2026.web.app'] },
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
            max_tokens: 4096,
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
