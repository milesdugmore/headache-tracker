/**
 * Headache Tracker E2E Test Suite
 * Run with: npx playwright test tests/e2e.test.js
 */

const { test, expect } = require('@playwright/test');

const APP_URL = 'https://headache-tracker-md-2026.web.app';

// Test data
const testEntry = {
    painLevel: 2,
    peakPain: 3,
    tinnitus: 1,
    ocular: 2,
    sleepIssues: 3,
    paracetamol: 2,
    ibuprofen: 1,
    aspirin: 0,
    triptan: 1,
    codeine: 0,
    otherMeds: 'Test medication',
    triggers: 'stress, lack of sleep',
    notes: 'Test note for automated testing'
};

test.describe('Headache Tracker Tests', () => {
    
    test.beforeEach(async ({ page }) => {
        await page.goto(APP_URL);
        // Skip auth - use local storage mode
        await page.click('#skipAuthBtn');
        await page.waitForSelector('#mainApp', { state: 'visible' });
    });

    test('1. Form loads correctly', async ({ page }) => {
        // Check main elements exist
        await expect(page.locator('#headacheForm')).toBeVisible();
        await expect(page.locator('#logDate')).toBeVisible();
        await expect(page.locator('input[name="painLevel"]')).toBeVisible();
        await expect(page.locator('input[name="sleepIssues"]')).toBeVisible();
        
        console.log('✓ Form loads correctly');
    });

    test('2. Can set and save all form values', async ({ page }) => {
        // Set a specific date for testing
        const testDate = '2026-01-05';
        await page.fill('#logDate', testDate);
        await page.waitForTimeout(500);

        // Set pain levels
        await page.locator('input[name="painLevel"]').fill(String(testEntry.painLevel));
        await page.locator('input[name="peakPain"]').fill(String(testEntry.peakPain));
        
        // Set symptoms
        await page.locator('input[name="tinnitus"]').fill(String(testEntry.tinnitus));
        await page.locator('input[name="ocular"]').fill(String(testEntry.ocular));
        await page.locator('input[name="sleepIssues"]').fill(String(testEntry.sleepIssues));
        
        // Set medications using stepper buttons
        for (let i = 0; i < testEntry.paracetamol; i++) {
            await page.locator('input[name="paracetamol"]').locator('..').locator('.plus').click();
        }
        for (let i = 0; i < testEntry.ibuprofen; i++) {
            await page.locator('input[name="ibuprofen"]').locator('..').locator('.plus').click();
        }
        for (let i = 0; i < testEntry.triptan; i++) {
            await page.locator('input[name="triptan"]').locator('..').locator('.plus').click();
        }
        
        // Set text fields
        await page.fill('input[name="otherMeds"]', testEntry.otherMeds);
        await page.fill('input[name="triggers"]', testEntry.triggers);
        await page.fill('textarea[name="notes"]', testEntry.notes);
        
        // Trigger save by clicking elsewhere
        await page.click('body');
        
        // Wait for auto-save
        await page.waitForTimeout(1500);
        
        // Check save status
        const saveStatus = await page.locator('#autoSaveStatus').textContent();
        expect(saveStatus).toContain('Saved');
        
        console.log('✓ All form values set and saved');
    });

    test('3. Values persist after navigating away and back', async ({ page }) => {
        const testDate = '2026-01-05';
        
        // First, set values
        await page.fill('#logDate', testDate);
        await page.waitForTimeout(500);
        
        await page.locator('input[name="painLevel"]').fill('3');
        await page.locator('input[name="sleepIssues"]').fill('2');
        await page.waitForTimeout(1500); // Wait for save
        
        // Navigate to next day
        await page.click('#nextDay');
        await page.waitForTimeout(500);
        
        // Navigate back to test date
        await page.click('#prevDay');
        await page.waitForTimeout(500);
        
        // Verify values loaded
        const painValue = await page.locator('input[name="painLevel"]').inputValue();
        const sleepValue = await page.locator('input[name="sleepIssues"]').inputValue();
        
        expect(painValue).toBe('3');
        expect(sleepValue).toBe('2');
        
        console.log('✓ Values persist after navigation');
    });

    test('4. Values persist after page refresh', async ({ page }) => {
        const testDate = '2026-01-04';
        
        // Set values
        await page.fill('#logDate', testDate);
        await page.waitForTimeout(500);
        
        await page.locator('input[name="painLevel"]').fill('4');
        await page.locator('input[name="tinnitus"]').fill('3');
        await page.waitForTimeout(1500);
        
        // Refresh page
        await page.reload();
        await page.click('#skipAuthBtn');
        await page.waitForSelector('#mainApp', { state: 'visible' });
        
        // Navigate to test date
        await page.fill('#logDate', testDate);
        await page.waitForTimeout(500);
        
        // Verify values
        const painValue = await page.locator('input[name="painLevel"]').inputValue();
        const tinnitusValue = await page.locator('input[name="tinnitus"]').inputValue();
        
        expect(painValue).toBe('4');
        expect(tinnitusValue).toBe('3');
        
        console.log('✓ Values persist after page refresh');
    });

    test('5. Medication steppers work correctly', async ({ page }) => {
        // Test plus button
        const paracetamolInput = page.locator('input[name="paracetamol"]');
        const plusBtn = paracetamolInput.locator('..').locator('.plus');
        const minusBtn = paracetamolInput.locator('..').locator('.minus');
        
        // Start at 0, click plus 3 times
        await plusBtn.click();
        await plusBtn.click();
        await plusBtn.click();
        expect(await paracetamolInput.inputValue()).toBe('3');
        
        // Click minus once
        await minusBtn.click();
        expect(await paracetamolInput.inputValue()).toBe('2');
        
        console.log('✓ Medication steppers work correctly');
    });

    test('6. Tab navigation works', async ({ page }) => {
        // Click History tab
        await page.click('[data-tab="history"]');
        await expect(page.locator('#history')).toBeVisible();
        
        // Click Analysis tab
        await page.click('[data-tab="charts"]');
        await expect(page.locator('#charts')).toBeVisible();
        
        // Click Settings tab
        await page.click('[data-tab="settings"]');
        await expect(page.locator('#settings')).toBeVisible();
        
        // Back to Daily Log
        await page.click('[data-tab="log"]');
        await expect(page.locator('#log')).toBeVisible();
        
        console.log('✓ Tab navigation works');
    });

    test('7. Analysis tab shows chart and stats', async ({ page }) => {
        // Add some test data first
        await page.fill('#logDate', '2026-01-03');
        await page.waitForTimeout(300);
        await page.locator('input[name="painLevel"]').fill('2');
        await page.waitForTimeout(1500);
        
        // Go to Analysis tab
        await page.click('[data-tab="charts"]');
        await page.waitForTimeout(500);
        
        // Check chart exists
        await expect(page.locator('#combinedChart')).toBeVisible();
        
        // Check stats panel exists
        await expect(page.locator('#statsPanel')).toBeVisible();
        
        console.log('✓ Analysis tab shows chart and stats');
    });

    test('8. Clear button resets form', async ({ page }) => {
        // Set some values
        await page.locator('input[name="painLevel"]').fill('3');
        await page.locator('input[name="tinnitus"]').fill('2');
        
        // Click clear
        await page.click('#clearBtn');
        
        // Verify reset
        const painValue = await page.locator('input[name="painLevel"]').inputValue();
        const tinnitusValue = await page.locator('input[name="tinnitus"]').inputValue();
        
        expect(painValue).toBe('0');
        expect(tinnitusValue).toBe('0');
        
        console.log('✓ Clear button resets form');
    });

    test('9. Date navigation buttons work', async ({ page }) => {
        const today = new Date().toISOString().split('T')[0];
        
        // Click Today button
        await page.click('#todayBtn');
        const currentDate = await page.locator('#logDate').inputValue();
        expect(currentDate).toBe(today);
        
        // Click prev day
        await page.click('#prevDay');
        const prevDate = await page.locator('#logDate').inputValue();
        expect(prevDate).not.toBe(today);
        
        // Click next day (should go back to today)
        await page.click('#nextDay');
        const nextDate = await page.locator('#logDate').inputValue();
        expect(nextDate).toBe(today);
        
        console.log('✓ Date navigation buttons work');
    });

    test('10. Theme switching works', async ({ page }) => {
        // Go to Settings tab first where themes are
        await page.click('[data-tab="settings"]');
        await page.waitForTimeout(300);
        
        // Scroll to bottom to make theme buttons visible
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(300);
        
        // Switch to graphite theme
        await page.click('[data-theme="graphite"]');
        await page.waitForTimeout(300);
        
        const bodyTheme = await page.locator('body').getAttribute('data-theme');
        expect(bodyTheme).toBe('graphite');
        
        // Switch back to default
        await page.click('[data-theme="default"]');
        await page.waitForTimeout(300);
        
        const defaultTheme = await page.locator('body').getAttribute('data-theme');
        expect(defaultTheme).toBe('default');
        
        console.log('✓ Theme switching works');
    });
});
