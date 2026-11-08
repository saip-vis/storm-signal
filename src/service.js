import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { Graph } from './graph.js'; import { loadCsv } from './ingest.js'; import { matchRecords } from './matching.js'; import { discoverGeography } from './osm.js'; import { richardson, source } from './types.js';
import { loadPoiSnapshot, poiCachePath } from './pois.js';
import { loadSnapshot, buildingPathsFor } from './buildings.js';
import { DEFAULT_REGION_ID } from './regions.js';
import { matchPoisToBuildings, matchSummary } from './matcher.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export class NetworkService {
  constructor({ dataDir = path.join(root, 'data/richardson'), fetchImpl } = {}) { this.dataDir = dataDir; this.fetchImpl = fetchImpl; this.graph = null; this.matches = []; this.geography = null; this.poiMatches = null; }
  locations() { return [richardson]; }
  async build(locationId = 'richardson-tx', { liveGeography = false } = {}) {
    if (locationId !== richardson.id) throw new Error('Unsupported location');
    const [properties, maintenance, businesses, resources] = await Promise.all([
      loadCsv(path.join(this.dataDir, 'properties.csv'), ['property_id','property_name','latitude','longitude']), loadCsv(path.join(this.dataDir, 'maintenance.csv'), ['work_order_id','site_ref','asset_code']), loadCsv(path.join(this.dataDir, 'businesses.csv'), ['business_id','facility_ref','business_name','service_type']), loadCsv(path.join(this.dataDir, 'community_resources.csv'), ['resource_id','location_reference','service_area'])
    ]);
    this.matches = matchRecords(properties, maintenance, businesses);
    this.geography = liveGeography ? await discoverGeography(richardson, path.join(this.dataDir, 'geographic-fixture.json'), this.fetchImpl) : { ...JSON.parse(await (await import('node:fs/promises')).readFile(path.join(this.dataDir, 'geographic-fixture.json'), 'utf8')), fallbackReason: 'Live discovery disabled; bundled offline fixture selected.' };
    const g = this.graph = new Graph(locationId), csv = source('uploaded_csv', 'Richardson synthetic organizational fixtures'), fixture = source(this.geography.source, 'geographic-fixture.json', this.geography.retrievedAt);
    for (const p of properties) g.addNode({ id: `building:${p.property_id}`, type: 'building', name: p.property_name, coordinates: [+p.longitude,+p.latitude], properties: { ...p, synthetic: true }, sources: [csv] });
    for (const feature of this.geography.features) if (!g.getNode(feature.id)) g.addNode({ id: feature.id, type: feature.type, name: feature.name, coordinates: feature.coordinates, properties: { tags: feature.tags, live: this.geography.source === 'openstreetmap' }, sources: [fixture] });
    for (const match of this.matches.filter(x => x.accepted && x.recordType === 'maintenance')) { const r = match.original, id = `equipment:${r.asset_code}`; g.addNode({ id, type: 'equipment', name: `${r.equipment_type} ${r.asset_code}`, properties: { ...r, synthetic: true }, sources: [csv] }); g.addEdge({ id: `edge:${match.propertyId}:${id}`, sourceId: `building:${match.propertyId}`, targetId: id, relationship: 'HAS_EQUIPMENT', evidenceLevel: 'verified', evidenceSources: [csv], explanation: 'Maintenance site reference is mapped to the property through a reviewable legacy ID mapping.' }); }
    for (const match of this.matches.filter(x => x.accepted && x.recordType === 'business')) { const r = match.original, id = `business:${r.business_id}`, serviceId = `service:${r.business_id}`; g.addNode({ id, type: 'business', name: r.business_name, properties: { ...r, synthetic: true }, sources: [csv] }); g.addNode({ id: serviceId, type: 'service', name: r.service_type, properties: { category: r.business_category }, sources: [csv] }); g.addEdge({ id: `edge:hosts:${r.business_id}`, sourceId: `building:${match.propertyId}`, targetId: id, relationship: 'HOSTS', evidenceLevel: 'verified', evidenceSources: [csv], explanation: 'Business facility reference matched to property via explicit legacy mapping.' }); g.addEdge({ id: `edge:service:${r.business_id}`, sourceId: id, targetId: serviceId, relationship: 'PROVIDES_SERVICE', evidenceLevel: 'verified', evidenceSources: [csv] }); const resource = resources.find(x => normalize(x.location_reference) === normalize(r.business_name)); if (resource) { const n = `neighborhood:${resource.service_area.replace(/\s+/g,'-').toLowerCase()}`; if (!g.getNode(n)) g.addNode({ id:n,type:'neighborhood',name:resource.service_area,properties:{ reportedCapacity: resource.reported_capacity, explicitlySynthetic: true },sources:[csv] }); g.addEdge({ id:`edge:area:${r.business_id}`,sourceId:serviceId,targetId:n,relationship:'SERVES_AREA',evidenceLevel:'hypothetical',evidenceSources:[csv],explanation:'Synthetic fixture models service area only; it is not verified emergency-service coverage.' }); } }
    const road = this.geography.features.find(x => x.type === 'road'); if (road) g.addEdge({ id:'edge:road-access',sourceId:road.id,targetId:'building:RCH-BLDG-021',relationship:'ACCESSIBLE_VIA',evidenceLevel:'inferred',evidenceSources:[fixture],explanation:'The fixture road represents nearby access, not a verified transportation dependency.' });

    // ── Real POI injection (non-fatal if cache is missing) ────────────────────
    try {
      const poisSnapshot = await loadPoiSnapshot(poiCachePath(DEFAULT_REGION_ID));
      const buildingsSnapshot = await loadSnapshot(buildingPathsFor(DEFAULT_REGION_ID).cache);
      const matchResults = matchPoisToBuildings(poisSnapshot.features, buildingsSnapshot.features);
      this.poiMatches = matchResults;

      const poiSource = source('openstreetmap', 'Real OSM POI cache via Overpass API');
      for (const match of matchResults.filter(m => m.confidence === 'high' || m.confidence === 'low')) {
        const poi = poisSnapshot.features.find(p => p.id === match.poiId);
        if (!poi) continue;
        const nodeId = `real-poi:${match.poiId}`;
        g.addNode({
          id: nodeId,
          type: 'business',
          name: poi.name,
          coordinates: poi.coordinates,
          properties: { category: poi.category, osmId: poi.osmId, real: true },
          sources: [poiSource]
        });
        // HOSTS edge: only if the matched Overture building node exists in the graph.
        // Currently synthetic building: nodes are present but overture: nodes are not;
        // skip edge to avoid dangling references. Entity graph integration of Overture
        // nodes into the graph is a future step.
        if (match.buildingId) {
          const overtureNode = g.getNode(match.buildingId);
          if (overtureNode) {
            g.addEdge({
              id: `edge:hosts-real:${match.poiId}`,
              sourceId: match.buildingId,
              targetId: nodeId,
              relationship: 'HOSTS',
              evidenceLevel: match.confidence === 'high' ? 'observed' : 'inferred',
              evidenceSources: [poiSource],
              explanation: `POI coordinate matched to building via ${match.matchMethod}.`
            });
          }
          // else: Overture node not yet in graph — skip edge (see note above)
        }
      }
    } catch (error) {
      // POI cache or building cache missing — synthetic graph still built successfully
      console.warn(`[service] Real POI injection skipped: ${error.message}`);
    }

    return { summary: this.summary(), geographicSource: this.geography.source, fallbackReason: this.geography.fallbackReason };
  }
  network() { if (!this.graph) throw new Error('Build a network first'); const snap=this.graph.snapshot(); if(this.poiMatches)snap.poiMatchSummary=matchSummary(this.poiMatches); return snap; }
  node(id) { if (!this.graph) throw new Error('Build a network first'); return { node: this.graph.getNode(id), incoming: this.graph.incoming(id), outgoing: this.graph.outgoing(id) }; }
  trace(id, options) { if (!this.graph) throw new Error('Build a network first'); return this.graph.trace(id, options); }
  summary() { const graph = this.network(), count = key => Object.fromEntries([...new Set(graph[key].map(x => key === 'nodes' ? x.type : x.relationship))].map(k => [k, graph[key].filter(x => (key === 'nodes' ? x.type : x.relationship) === k).length])); return { nodeCount:graph.nodes.length, edgeCount:graph.edges.length, byNodeType:count('nodes'), byRelationship:count('edges'), byEvidence:Object.fromEntries([...new Set(graph.edges.map(x=>x.evidenceLevel))].map(k=>[k,graph.edges.filter(x=>x.evidenceLevel===k).length])) }; }
}
function normalize(x) { return String(x).toLowerCase().replace(/[^a-z0-9]/g,''); }
