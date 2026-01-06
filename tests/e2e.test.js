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

    test('11. Full field persistence - populate all fields, navigate away and back', async ({ page }) => {
        const testDate = '2026-01-10';
        
        // Navigate to test date
        await page.fill('#logDate', testDate);
        await page.waitForTimeout(500);
        
        // Clear any existing data first
        await page.click('#clearBtn');
        await page.waitForTimeout(300);
        
        // Populate ALL fields
        // Pain levels (sliders)
        await page.locator('input[name="painLevel"]').fill('3');
        await page.locator('input[name="peakPain"]').fill('4');
        
        // Symptoms (sliders)
        await page.locator('input[name="tinnitus"]').fill('2');
        await page.locator('input[name="ocular"]').fill('1');
        await page.locator('input[name="sleepIssues"]').fill('3');
        
        // Medications (number inputs via steppers)
        const paracetamolPlus = page.locator('input[name="paracetamol"]').locator('..').locator('.plus');
        await paracetamolPlus.click();
        await paracetamolPlus.click(); // 2
        
        const ibuprofenPlus = page.locator('input[name="ibuprofen"]').locator('..').locator('.plus');
        await ibuprofenPlus.click(); // 1
        
        const aspirinPlus = page.locator('input[name="aspirin"]').locator('..').locator('.plus');
        await aspirinPlus.click();
        await aspirinPlus.click();
        await aspirinPlus.click(); // 3
        
        const triptanPlus = page.locator('input[name="triptan"]').locator('..').locator('.plus');
        await triptanPlus.click(); // 1
        
        const codeineplus = page.locator('input[name="codeine"]').locator('..').locator('.plus');
        await codeineplus.click();
        await codeineplus.click(); // 2
        
        // Text fields
        await page.fill('input[name="otherMeds"]', 'Test Other Med');
        await page.fill('input[name="triggers"]', 'stress, weather, lack of sleep');
        await page.fill('textarea[name="notes"]', 'Comprehensive test notes for persistence testing');
        
        // Wait for auto-save
        await page.waitForTimeout(2000);
        
        // Verify save status
        const saveStatus = await page.locator('#autoSaveStatus').textContent();
        expect(saveStatus).toContain('Saved');
        
        console.log('✓ All fields populated and saved for test date');
        
        // Navigate to NEXT day
        await page.click('#nextDay');
        await page.waitForTimeout(500);
        
        // Verify ALL fields are blank/default (0) for the new day
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="peakPain"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="tinnitus"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="ocular"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="sleepIssues"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="paracetamol"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="ibuprofen"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="aspirin"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="triptan"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="codeine"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="otherMeds"]').inputValue()).toBe('');
        expect(await page.locator('input[name="triggers"]').inputValue()).toBe('');
        expect(await page.locator('textarea[name="notes"]').inputValue()).toBe('');
        
        console.log('✓ Next day shows all blank/default values');
        
        // Navigate BACK to original day
        await page.click('#prevDay');
        await page.waitForTimeout(500);
        
        // Verify ALL original values are restored
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('3');
        expect(await page.locator('input[name="peakPain"]').inputValue()).toBe('4');
        expect(await page.locator('input[name="tinnitus"]').inputValue()).toBe('2');
        expect(await page.locator('input[name="ocular"]').inputValue()).toBe('1');
        expect(await page.locator('input[name="sleepIssues"]').inputValue()).toBe('3');
        expect(await page.locator('input[name="paracetamol"]').inputValue()).toBe('2');
        expect(await page.locator('input[name="ibuprofen"]').inputValue()).toBe('1');
        expect(await page.locator('input[name="aspirin"]').inputValue()).toBe('3');
        expect(await page.locator('input[name="triptan"]').inputValue()).toBe('1');
        expect(await page.locator('input[name="codeine"]').inputValue()).toBe('2');
        expect(await page.locator('input[name="otherMeds"]').inputValue()).toBe('Test Other Med');
        expect(await page.locator('input[name="triggers"]').inputValue()).toBe('stress, weather, lack of sleep');
        expect(await page.locator('textarea[name="notes"]').inputValue()).toBe('Comprehensive test notes for persistence testing');
        
        console.log('✓ Original day values restored correctly');
    });

    test('12. Full field edit persistence - modify all fields and verify', async ({ page }) => {
        const testDate = '2026-01-11';
        
        // Navigate to test date
        await page.fill('#logDate', testDate);
        await page.waitForTimeout(500);
        
        // Clear and set up INITIAL values first
        await page.click('#clearBtn');
        await page.waitForTimeout(300);
        
        // Set initial values
        await page.locator('input[name="painLevel"]').fill('3');
        await page.locator('input[name="peakPain"]').fill('4');
        await page.locator('input[name="tinnitus"]').fill('2');
        await page.locator('input[name="ocular"]').fill('1');
        await page.locator('input[name="sleepIssues"]').fill('3');
        
        // Set initial medication values
        let paracetamolPlus = page.locator('input[name="paracetamol"]').locator('..').locator('.plus');
        await paracetamolPlus.click();
        await paracetamolPlus.click(); // 2
        
        let ibuprofenPlus = page.locator('input[name="ibuprofen"]').locator('..').locator('.plus');
        await ibuprofenPlus.click(); // 1
        
        let aspirinPlus = page.locator('input[name="aspirin"]').locator('..').locator('.plus');
        await aspirinPlus.click();
        await aspirinPlus.click();
        await aspirinPlus.click(); // 3
        
        let triptanPlus = page.locator('input[name="triptan"]').locator('..').locator('.plus');
        await triptanPlus.click(); // 1
        
        let codeinePlus = page.locator('input[name="codeine"]').locator('..').locator('.plus');
        await codeinePlus.click();
        await codeinePlus.click(); // 2
        
        await page.fill('input[name="otherMeds"]', 'Initial Other Med');
        await page.fill('input[name="triggers"]', 'initial triggers');
        await page.fill('textarea[name="notes"]', 'Initial notes');
        
        // Wait for auto-save
        await page.waitForTimeout(2000);
        
        // Verify initial values were saved
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('3');
        
        console.log('✓ Initial values set up');
        
        // Now EDIT ALL fields to new values
        // Pain levels
        await page.locator('input[name="painLevel"]').fill('1');
        await page.locator('input[name="peakPain"]').fill('2');
        
        // Symptoms
        await page.locator('input[name="tinnitus"]').fill('4');
        await page.locator('input[name="ocular"]').fill('3');
        await page.locator('input[name="sleepIssues"]').fill('0');
        
        // Medications - reset and set new values
        // First clear by clicking minus buttons
        const paracetamolMinus = page.locator('input[name="paracetamol"]').locator('..').locator('.minus');
        await paracetamolMinus.click();
        await paracetamolMinus.click(); // Now 0
        paracetamolPlus = page.locator('input[name="paracetamol"]').locator('..').locator('.plus');
        await paracetamolPlus.click();
        await paracetamolPlus.click();
        await paracetamolPlus.click();
        await paracetamolPlus.click(); // Now 4
        
        const ibuprofenMinus = page.locator('input[name="ibuprofen"]').locator('..').locator('.minus');
        await ibuprofenMinus.click(); // Now 0
        
        const aspirinMinus = page.locator('input[name="aspirin"]').locator('..').locator('.minus');
        await aspirinMinus.click();
        await aspirinMinus.click();
        await aspirinMinus.click(); // Now 0
        aspirinPlus = page.locator('input[name="aspirin"]').locator('..').locator('.plus');
        await aspirinPlus.click(); // Now 1
        
        const triptanMinus = page.locator('input[name="triptan"]').locator('..').locator('.minus');
        await triptanMinus.click(); // Now 0
        triptanPlus = page.locator('input[name="triptan"]').locator('..').locator('.plus');
        await triptanPlus.click();
        await triptanPlus.click(); // Now 2
        
        const codeineMinus = page.locator('input[name="codeine"]').locator('..').locator('.minus');
        await codeineMinus.click();
        await codeineMinus.click(); // Now 0
        codeinePlus = page.locator('input[name="codeine"]').locator('..').locator('.plus');
        await codeinePlus.click();
        await codeinePlus.click();
        await codeinePlus.click(); // Now 3
        
        // Text fields - update
        await page.fill('input[name="otherMeds"]', 'Updated Other Med');
        await page.fill('input[name="triggers"]', 'new triggers, different causes');
        await page.fill('textarea[name="notes"]', 'Updated notes after editing all fields');
        
        // Wait for auto-save
        await page.waitForTimeout(2000);
        
        console.log('✓ All fields edited to new values');
        
        // Navigate to NEXT day
        await page.click('#nextDay');
        await page.waitForTimeout(500);
        
        // Verify next day is still blank
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="otherMeds"]').inputValue()).toBe('');
        
        console.log('✓ Next day still shows blank values');
        
        // Navigate BACK to original day
        await page.click('#prevDay');
        await page.waitForTimeout(500);
        
        // Verify ALL EDITED values are restored
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('1');
        expect(await page.locator('input[name="peakPain"]').inputValue()).toBe('2');
        expect(await page.locator('input[name="tinnitus"]').inputValue()).toBe('4');
        expect(await page.locator('input[name="ocular"]').inputValue()).toBe('3');
        expect(await page.locator('input[name="sleepIssues"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="paracetamol"]').inputValue()).toBe('4');
        expect(await page.locator('input[name="ibuprofen"]').inputValue()).toBe('0');
        expect(await page.locator('input[name="aspirin"]').inputValue()).toBe('1');
        expect(await page.locator('input[name="triptan"]').inputValue()).toBe('2');
        expect(await page.locator('input[name="codeine"]').inputValue()).toBe('3');
        expect(await page.locator('input[name="otherMeds"]').inputValue()).toBe('Updated Other Med');
        expect(await page.locator('input[name="triggers"]').inputValue()).toBe('new triggers, different causes');
        expect(await page.locator('textarea[name="notes"]').inputValue()).toBe('Updated notes after editing all fields');
        
        console.log('✓ All edited values restored correctly');
    });

    test('13. Text field persistence on immediate navigation (no wait)', async ({ page }) => {
        const testDate = '2026-01-12';
        
        // Navigate to test date
        await page.fill('#logDate', testDate);
        await page.waitForTimeout(500);
        
        // Clear form
        await page.click('#clearBtn');
        await page.waitForTimeout(300);
        
        // Type in Other Medication field
        await page.fill('input[name="otherMeds"]', 'Quick nav test');
        
        // Immediately navigate away (don't wait for auto-save)
        await page.click('#prevDay');
        await page.waitForTimeout(500);
        
        // Navigate back
        await page.click('#nextDay');
        await page.waitForTimeout(500);
        
        // The value should be saved
        const otherMedsValue = await page.locator('input[name="otherMeds"]').inputValue();
        expect(otherMedsValue).toBe('Quick nav test');
        
        console.log('✓ Text field saved even with immediate navigation');
    });

    test('14. Multiple date jumps with different data per day', async ({ page }) => {
        // Set up data for 3 different days
        const day1 = '2026-01-15';
        const day2 = '2026-01-16';
        const day3 = '2026-01-17';
        
        // Day 1 - pain level 1
        await page.fill('#logDate', day1);
        await page.waitForTimeout(300);
        await page.click('#clearBtn');
        await page.locator('input[name="painLevel"]').fill('1');
        await page.fill('input[name="triggers"]', 'Day 1 triggers');
        await page.waitForTimeout(1500);
        
        // Day 2 - pain level 2
        await page.fill('#logDate', day2);
        await page.waitForTimeout(300);
        await page.click('#clearBtn');
        await page.locator('input[name="painLevel"]').fill('2');
        await page.fill('input[name="triggers"]', 'Day 2 triggers');
        await page.waitForTimeout(1500);
        
        // Day 3 - pain level 3
        await page.fill('#logDate', day3);
        await page.waitForTimeout(300);
        await page.click('#clearBtn');
        await page.locator('input[name="painLevel"]').fill('3');
        await page.fill('input[name="triggers"]', 'Day 3 triggers');
        await page.waitForTimeout(1500);
        
        console.log('✓ Data set for 3 days');
        
        // Now jump around and verify each day has correct data
        // Jump to Day 1
        await page.fill('#logDate', day1);
        await page.waitForTimeout(500);
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('1');
        expect(await page.locator('input[name="triggers"]').inputValue()).toBe('Day 1 triggers');
        
        // Jump to Day 3
        await page.fill('#logDate', day3);
        await page.waitForTimeout(500);
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('3');
        expect(await page.locator('input[name="triggers"]').inputValue()).toBe('Day 3 triggers');
        
        // Jump to Day 2
        await page.fill('#logDate', day2);
        await page.waitForTimeout(500);
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('2');
        expect(await page.locator('input[name="triggers"]').inputValue()).toBe('Day 2 triggers');
        
        // Back to Day 1 one more time
        await page.fill('#logDate', day1);
        await page.waitForTimeout(500);
        expect(await page.locator('input[name="painLevel"]').inputValue()).toBe('1');
        expect(await page.locator('input[name="triggers"]').inputValue()).toBe('Day 1 triggers');
        
        console.log('✓ All 3 days retain their unique data after jumping between them');
    });
});
