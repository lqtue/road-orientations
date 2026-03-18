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
