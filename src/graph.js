import { validateEdge, validateNode } from './types.js';
export class Graph {
  constructor(locationId) { this.locationId = locationId; this.nodes = new Map(); this.edges = new Map(); this.out = new Map(); this.in = new Map(); }
  addNode(node) { validateNode(node); this.nodes.set(node.id, node); return node; }
  addEdge(edge) { validateEdge(edge); if (!this.nodes.has(edge.sourceId) || !this.nodes.has(edge.targetId)) throw new Error(`Edge references missing node: ${edge.id}`); this.edges.set(edge.id, edge); (this.out.get(edge.sourceId) ?? this.out.set(edge.sourceId, []).get(edge.sourceId)).push(edge); (this.in.get(edge.targetId) ?? this.in.set(edge.targetId, []).get(edge.targetId)).push(edge); return edge; }
  getNode(id) { return this.nodes.get(id) ?? null; }
  outgoing(id) { return this.out.get(id) ?? []; } incoming(id) { return this.in.get(id) ?? []; }
  snapshot() { return { locationId: this.locationId, nodes: [...this.nodes.values()], edges: [...this.edges.values()], generatedAt: new Date().toISOString() }; }
  trace(startId, { maxDepth = 4, relationshipTypes } = {}) {
    if (!this.nodes.has(startId)) throw new Error('Unknown node'); maxDepth = Math.min(Math.max(Number(maxDepth) || 4, 0), 10);
    const allowed = relationshipTypes?.length ? new Set(relationshipTypes) : null;
    const queue = [{ id: startId, depth: 0, path: [startId] }], seen = new Set([startId]), traversed = [], paths = {};
    while (queue.length) { const item = queue.shift(); if (item.depth >= maxDepth) continue; for (const edge of this.outgoing(item.id)) { if (allowed && !allowed.has(edge.relationship)) continue; traversed.push(edge); if (!seen.has(edge.targetId)) { seen.add(edge.targetId); const path = [...item.path, edge.targetId]; paths[edge.targetId] = path; queue.push({ id: edge.targetId, depth: item.depth + 1, path }); } } }
    return { startNodeId: startId, affectedNodeIds: [...seen].filter(x => x !== startId), traversedEdges: [...new Map(traversed.map(x => [x.id, x])).values()], paths };
  }
}
