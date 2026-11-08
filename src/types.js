/** Stable Component 1 contracts. Coordinates are always [longitude, latitude]. */
export const NODE_TYPES = new Set(['building', 'business', 'infrastructure', 'equipment', 'road', 'shelter', 'neighborhood', 'service']);
// 'observed' = relationship determined by direct spatial observation (e.g. point-in-polygon match)
export const EVIDENCE_LEVELS = new Set(['verified', 'inferred', 'hypothetical', 'observed']);
export const RELATIONSHIPS = new Set(['LOCATED_IN', 'HOSTS', 'HAS_EQUIPMENT', 'PROVIDES_SERVICE', 'SERVES_AREA', 'ACCESSIBLE_VIA', 'DEPENDS_ON']);
export const richardson = {
  id: 'richardson-tx', displayName: 'Richardson, Texas',
  center: [-96.7299, 32.9483], bbox: [-96.766, 32.925, -96.688, 32.982],
  source: { category: 'configured_test_area', reference: 'MVP pilot boundary; coordinates are [longitude, latitude].' }
};
export function source(category, reference, retrievedAt) { return { category, reference, retrievedAt }; }
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function validateNode(node) {
  assert(node && typeof node.id === 'string' && node.id, 'Node id is required');
  assert(NODE_TYPES.has(node.type), `Unsupported node type: ${node.type}`);
  assert(typeof node.name === 'string', 'Node name is required');
  if (node.coordinates) assert(Array.isArray(node.coordinates) && node.coordinates.length === 2 && node.coordinates.every(Number.isFinite), 'Coordinates must be [longitude, latitude]');
  return node;
}
export function validateEdge(edge) {
  assert(edge && edge.id && edge.sourceId && edge.targetId, 'Edge ids are required');
  assert(RELATIONSHIPS.has(edge.relationship), `Unsupported relationship: ${edge.relationship}`);
  assert(EVIDENCE_LEVELS.has(edge.evidenceLevel), `Unsupported evidence: ${edge.evidenceLevel}`);
  return edge;
}
