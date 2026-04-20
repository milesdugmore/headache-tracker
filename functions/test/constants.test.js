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
