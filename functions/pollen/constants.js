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
