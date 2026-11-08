import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPoisToBuildings, matchSummary } from '../src/matcher.js';

// ── Shared geometry helpers ───────────────────────────────────────────────────
// All coordinates within the Richardson, TX bbox (lon ~-96.73, lat ~32.95).

// Build a rectangular polygon ring (closed) from SW and NE corners.
function rectRing([swLon, swLat], [neLon, neLat]) {
  return [
    [swLon, swLat],
    [neLon, swLat],
    [neLon, neLat],
    [swLon, neLat],
    [swLon, swLat]  // close ring
  ];
}

// A realistic ~200m × 200m building centred at [-96.730, 32.952]
// lon span: ±0.001° ≈ ±95m; lat span: ±0.001° ≈ ±111m
const BUILDING_1 = {
  id: 'overture:building-1',
  providerId: 'building-1',
  geometry: {
    type: 'Polygon',
    coordinates: [rectRing([-96.731, 32.951], [-96.729, 32.953])]
  },
  representativePoint: [-96.730, 32.952]
};

// A tiny building (≈11m × 11m) north of building 1
// Used for nearest-within-30m tests
const BUILDING_2 = {
  id: 'overture:building-2',
  providerId: 'building-2',
  geometry: {
    type: 'Polygon',
    // 0.0001° lat ≈ 11.1m; 0.0001° lon ≈ 9.5m
    coordinates: [rectRing([-96.7301, 32.9540], [-96.7299, 32.9541])]
  },
  // Representative point at the polygon's south-west corner
  representativePoint: [-96.7300, 32.9540]
};

// A building far away (northwest suburb) — no POI will be within 30m of it
const BUILDING_FAR = {
  id: 'overture:building-far',
  providerId: 'building-far',
  geometry: {
    type: 'Polygon',
    coordinates: [rectRing([-96.800, 32.980], [-96.799, 32.981])]
  },
  representativePoint: [-96.7995, 32.9805]
};

// A MultiPolygon building — two disconnected footprints
const BUILDING_MULTI = {
  id: 'overture:building-multi',
  providerId: 'building-multi',
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      // polygon A — south patch
      [rectRing([-96.726, 32.948], [-96.724, 32.950])],
      // polygon B — north patch
      [rectRing([-96.726, 32.953], [-96.724, 32.955])]
    ]
  },
  representativePoint: [-96.725, 32.9515]
};

// Minimal POI factory
function poi(id, coordinates) {
  return { id, coordinates };
}

// ── TEST 1: Point-in-polygon match ───────────────────────────────────────────

test('point-in-polygon: POI inside building polygon → high confidence match', () => {
  // Centre of BUILDING_1 polygon — clearly inside
  const pois = [poi('osm:node:1', [-96.730, 32.952])];
  const buildings = [BUILDING_1, BUILDING_FAR];

  const [result] = matchPoisToBuildings(pois, buildings);

  assert.equal(result.poiId, 'osm:node:1');
  assert.equal(result.buildingId, 'overture:building-1');
  assert.equal(result.matchMethod, 'point_in_polygon');
  assert.equal(result.confidence, 'high');
});

// ── TEST 2: Nearest-within-30m match ─────────────────────────────────────────

test('nearest-within-30m: POI 20m from representative point, outside polygon → low confidence match', () => {
  // BUILDING_2's representative point is at [-96.730, 32.9540].
  // A POI at [-96.730, 32.9538] is ~22 m south of that point (outside the polygon
  // which starts at lat 32.9540) and closer than 30 m.
  const poiCoord = [-96.7300, 32.9538];
  const pois = [poi('osm:node:2', poiCoord)];

  // Only BUILDING_2 is nearby; BUILDING_1 and FAR are farther
  const buildings = [BUILDING_1, BUILDING_2, BUILDING_FAR];

  const [result] = matchPoisToBuildings(pois, buildings);

  assert.equal(result.poiId, 'osm:node:2');
  assert.equal(result.buildingId, 'overture:building-2');
  assert.equal(result.matchMethod, 'nearest_within_30m');
  assert.equal(result.confidence, 'low');
  assert.ok(result.distanceMeters !== null);
  assert.ok(result.distanceMeters <= 30, `distanceMeters should be ≤30, got ${result.distanceMeters}`);
});

// ── TEST 3: Unmatched ─────────────────────────────────────────────────────────

test('unmatched: POI more than 30m from all buildings → no match', () => {
  // A coordinate way west of all buildings
  const pois = [poi('osm:node:3', [-96.760, 32.960])];
  const buildings = [BUILDING_1, BUILDING_2];

  const [result] = matchPoisToBuildings(pois, buildings);

  assert.equal(result.poiId, 'osm:node:3');
  assert.equal(result.buildingId, null);
  assert.equal(result.matchMethod, 'unmatched');
  assert.equal(result.confidence, 'none');
  assert.equal(result.distanceMeters, null);
});

// ── TEST 4: matchSummary ──────────────────────────────────────────────────────

test('matchSummary: given 3 results (1 pip, 1 nearest, 1 unmatched) returns correct counts', () => {
  const results = [
    { poiId: 'a', buildingId: 'b1', matchMethod: 'point_in_polygon', confidence: 'high', distanceMeters: 0 },
    { poiId: 'b', buildingId: 'b2', matchMethod: 'nearest_within_30m', confidence: 'low', distanceMeters: 18.4 },
    { poiId: 'c', buildingId: null, matchMethod: 'unmatched', confidence: 'none', distanceMeters: null }
  ];

  const summary = matchSummary(results);

  assert.equal(summary.total, 3);
  assert.equal(summary.pointInPolygon, 1);
  assert.equal(summary.nearestFallback, 1);
  assert.equal(summary.unmatched, 1);
});

// ── TEST 5: MultiPolygon building ─────────────────────────────────────────────

test('multipolygon: POI inside one polygon of a MultiPolygon building → matched', () => {
  // BUILDING_MULTI has polygon B covering lat [32.953, 32.955].
  // POI at [-96.725, 32.954] is inside polygon B.
  const pois = [poi('osm:node:5', [-96.725, 32.954])];
  const buildings = [BUILDING_MULTI, BUILDING_FAR];

  const [result] = matchPoisToBuildings(pois, buildings);

  assert.equal(result.poiId, 'osm:node:5');
  assert.equal(result.buildingId, 'overture:building-multi');
  assert.equal(result.matchMethod, 'point_in_polygon');
  assert.equal(result.confidence, 'high');
});
