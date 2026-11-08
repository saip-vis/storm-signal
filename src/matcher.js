/**
 * matcher.js — Spatial entity matching engine.
 *
 * Pure functions only — no file I/O, no network calls, no external libraries.
 * Matches OSM POI points to Overture building polygons using two strategies:
 *   1. Point-in-polygon  (confidence: "high")
 *   2. Nearest-within-30m Haversine fallback  (confidence: "low")
 *   3. Unmatched  (confidence: "none")
 */

// ── Ray-casting point-in-ring ─────────────────────────────────────────────────
// (Algorithm equivalent to the one in buildings.js; duplicated here to keep
//  matcher.js a pure-geometry module with no cross-module coupling.)

function pointInRing([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

// Check if a [lon, lat] point falls inside a GeoJSON Polygon or MultiPolygon.
// Only checks exterior rings — building polygons have no meaningful holes.
function pointInGeometry(point, geometry) {
  const insidePolygon=poly=>pointInRing(point,poly[0])&&!poly.slice(1).some(hole=>pointInRing(point,hole));
  if (geometry.type === 'Polygon') {
    return insidePolygon(geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(insidePolygon);
  }
  return false;
}

// ── Haversine distance ────────────────────────────────────────────────────────

// Returns the great-circle distance in metres between two [lon, lat] points.
function haversineMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6_371_000; // Earth mean radius, metres
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Main matching function ────────────────────────────────────────────────────

/**
 * Match an array of normalized POI objects to an array of normalized building
 * objects. Returns one result per POI.
 *
 * @param {object[]} pois      - From loadPoiSnapshot().features
 * @param {object[]} buildings - From loadSnapshot().features
 * @returns {{ poiId, buildingId, matchMethod, confidence, distanceMeters }[]}
 */
export function matchPoisToBuildings(pois, buildings) {
  const results = [];

  for (const poi of pois) {
    const coord = poi.coordinates; // [lon, lat]

    // ── Step 1: Point-in-polygon ──────────────────────────────────────────────
    const pipBuilding = buildings.find(b => pointInGeometry(coord, b.geometry));
    if (pipBuilding) {
      results.push({
        poiId: poi.id,
        buildingId: pipBuilding.id,
        matchMethod: 'point_in_polygon',
        confidence: 'high',
        distanceMeters: 0
      });
      continue;
    }

    // ── Step 2: Nearest-within-30m (Haversine) ────────────────────────────────
    let nearest = null;
    let nearestDist = Infinity;

    for (const b of buildings) {
      const dist = haversineMeters(coord, b.representativePoint);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = b;
      }
    }

    if (nearest !== null && nearestDist <= 30) {
      results.push({
        poiId: poi.id,
        buildingId: nearest.id,
        matchMethod: 'nearest_within_30m',
        confidence: 'low',
        distanceMeters: Math.round(nearestDist * 10) / 10
      });
      continue;
    }

    // ── Step 3: Unmatched ─────────────────────────────────────────────────────
    results.push({
      poiId: poi.id,
      buildingId: null,
      matchMethod: 'unmatched',
      confidence: 'none',
      distanceMeters: null
    });
  }

  return results;
}

// ── Summary ───────────────────────────────────────────────────────────────────

/**
 * Aggregate counts from matchPoisToBuildings() output.
 * @param {object[]} results
 * @returns {{ total, pointInPolygon, nearestFallback, unmatched }}
 */
export function matchSummary(results) {
  return {
    total: results.length,
    pointInPolygon: results.filter(r => r.matchMethod === 'point_in_polygon').length,
    nearestFallback: results.filter(r => r.matchMethod === 'nearest_within_30m').length,
    unmatched: results.filter(r => r.matchMethod === 'unmatched').length
  };
}
