#!/usr/bin/env node
/**
 * Local Garmin Login Script
 * Logs into Garmin from your PC (avoids cloud IP rate limits),
 * then automatically uploads OAuth tokens to the app.
 *
 * Usage: node garmin-login.js <garmin-email> <garmin-password>
 */

const path = require('path');
const { GarminConnect } = require(path.join(__dirname, 'functions', 'node_modules', 'garmin-connect'));

const APP_URL = 'https://headache-tracker-md-2026.web.app';

async function main() {
    const [,, username, password] = process.argv;

    if (!username || !password) {
        console.error('Usage: node garmin-login.js <garmin-email> <garmin-password>');
        process.exit(1);
    }

    console.log('Logging into Garmin Connect as:', username, '...');
    const GCClient = new GarminConnect({ username, password });

    try {
        await GCClient.login();
        console.log('Login successful!');

        const tokens = GCClient.exportToken();

        // Auto-upload tokens to the app
        console.log('Uploading tokens to app...');
        const res = await fetch(`${APP_URL}/api/garmin-upload-tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, oauth1: tokens.oauth1, oauth2: tokens.oauth2 })
        });

        const result = await res.json();
        if (result.success) {
            console.log('\nDone! Garmin connected successfully.');
            console.log('Tokens are valid for ~30 days. Run this again when prompted by the app.');
        } else {
            console.error('Upload failed:', result.error || 'Unknown error');
            console.log('\nTokens obtained but upload failed. Try again or check your network.');
        }

    } catch (e) {
        console.error('Login failed:', e.message);
        process.exit(1);
    }
}

main();
