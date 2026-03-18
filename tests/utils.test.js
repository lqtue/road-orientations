// Unit tests for pure utility functions extracted from script.js
import { describe, it, expect } from 'vitest';

// We test the coordinate extraction logic in isolation
function extractCenter(feature) {
  return [
    parseFloat(feature.properties.lon),
    parseFloat(feature.properties.lat)
  ];
}

describe('extractCenter', () => {
  it('uses OSM name node coordinates, not bbox midpoint', () => {
    const feature = {
      bbox: [2.0, 48.0, 3.0, 49.0], // midpoint would be [2.5, 48.5]
      properties: { lat: '48.8566', lon: '2.3522' } // actual Paris name node
    };
    const center = extractCenter(feature);
    expect(center[0]).toBeCloseTo(2.3522, 4);
    expect(center[1]).toBeCloseTo(48.8566, 4);
  });
});

// --- computeDominantDirections ---
function computeDominantDirections(bins, numBins = 64) {
  const half = numBins / 2;
  const pairs = [];
  for (let k = 0; k < half; k++) {
    pairs.push({ bins: [k, k + half], combined: bins[k] + bins[k + half] });
  }
  pairs.sort((a, b) => b.combined - a.combined);
  const dominant = pairs[0].combined > 0 ? pairs[0] : null;
  const secondary = pairs[1] && pairs[1].combined > 0 ? pairs[1] : null;
  return { dominant, secondary };
}

function binToCompassLabel(binIndex, numBins = 64) {
  const deg = (binIndex / numBins) * 360;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

describe('computeDominantDirections', () => {
  it('returns dominant bin pair with combined road length', () => {
    const bins = new Float64Array(64).fill(0);
    bins[16] = 100; bins[48] = 80;
    const result = computeDominantDirections(bins);
    expect(result.dominant.bins).toEqual([16, 48]);
    expect(result.dominant.combined).toBe(180);
  });

  it('identifies second-highest pair as secondary', () => {
    const bins = new Float64Array(64).fill(0);
    bins[0] = 90; bins[32] = 60;
    bins[16] = 100; bins[48] = 80;
    const result = computeDominantDirections(bins);
    expect(result.secondary.bins).toEqual([0, 32]);
  });

  it('returns null dominant when all bins are zero', () => {
    const bins = new Float64Array(64).fill(0);
    const result = computeDominantDirections(bins);
    expect(result.dominant).toBeNull();
  });
});

describe('binToCompassLabel', () => {
  it('maps bin 0 to N', () => expect(binToCompassLabel(0)).toBe('N'));
  it('maps bin 16 to E', () => expect(binToCompassLabel(16)).toBe('E'));
  it('maps bin 32 to S', () => expect(binToCompassLabel(32)).toBe('S'));
  it('maps bin 48 to W', () => expect(binToCompassLabel(48)).toBe('W'));
});

// --- Permalink encode/decode ---
function encodeHash({ lat, lng, zoom, radii, mode, explainerOpen }) {
  const r = radii.join('-');
  const e = explainerOpen ? '' : ',0';
  return `#${lat.toFixed(4)},${lng.toFixed(4)},${zoom},${r},${mode}${e}`;
}

function decodeHash(hash) {
  if (!hash || hash.length < 2) return null;
  const parts = hash.slice(1).split(',');
  if (parts.length < 5) return null;
  try {
    return {
      lat: parseFloat(parts[0]),
      lng: parseFloat(parts[1]),
      zoom: parseInt(parts[2], 10),
      radii: parts[3].split('-').map(Number),
      mode: parts[4],
      explainerOpen: parts[5] !== '0',
    };
  } catch { return null; }
}

describe('permalink encode/decode', () => {
  it('round-trips correctly', () => {
    const state = { lat: 10.8231, lng: 106.6297, zoom: 12, radii: [1, 3, 5], mode: 'cumulative', explainerOpen: true };
    const hash = encodeHash(state);
    const decoded = decodeHash(hash);
    expect(decoded.lat).toBeCloseTo(10.8231, 4);
    expect(decoded.lng).toBeCloseTo(106.6297, 4);
    expect(decoded.zoom).toBe(12);
    expect(decoded.radii).toEqual([1, 3, 5]);
    expect(decoded.mode).toBe('cumulative');
    expect(decoded.explainerOpen).toBe(true);
  });

  it('encodes explainer=0 only when collapsed', () => {
    const collapsed = encodeHash({ lat: 48.8566, lng: 2.3522, zoom: 10, radii: [1], mode: 'cumulative', explainerOpen: false });
    expect(collapsed.endsWith(',0')).toBe(true);
    const open = encodeHash({ lat: 48.8566, lng: 2.3522, zoom: 10, radii: [1], mode: 'cumulative', explainerOpen: true });
    expect(open.endsWith(',0')).toBe(false);
  });

  it('returns null for malformed hash', () => {
    expect(decodeHash('#bad')).toBeNull();
    expect(decodeHash('')).toBeNull();
  });
});
