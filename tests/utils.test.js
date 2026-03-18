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
