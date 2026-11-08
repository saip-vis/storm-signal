export const layerCategory=node=>node.type==='building'?'building':node.type==='road'?'road':node.type==='business'?'business':node.type==='equipment'?'equipment':'other';
export function inheritedPoint(graph,node){if(node.coordinates)return {coordinates:node.coordinates,locationMethod:'observed_coordinate'};const host=graph.edges.find(e=>e.targetId===node.id&&['HOSTS','HAS_EQUIPMENT'].includes(e.relationship));const source=host&&graph.nodes.find(n=>n.id===host.sourceId);return source?.coordinates?{coordinates:source.coordinates,locationMethod:`derived_from:${source.id}`}:null;}
export function networkToPoints(graph,riskFor=()=>'unknown'){
  // Skip real-data nodes: Overture buildings appear as polygon footprints;
  // real OSM POI nodes appear via the dedicated real-pois-layer.
  // Both are identified by properties.real === true.
  return graph.nodes.filter(node=>!node.properties?.real).map(node=>{const loc=inheritedPoint(graph,node);return loc&&{type:'Feature',id:node.id,geometry:{type:'Point',coordinates:loc.coordinates},properties:{id:node.id,name:node.name,type:node.type,category:layerCategory(node),locationMethod:loc.locationMethod,risk:riskFor(node.id)}};}).filter(Boolean);}
export function scenarioToFeatureCollection(scenario){return scenario?.footprint?{type:'FeatureCollection',features:[{type:'Feature',geometry:scenario.footprint,properties:{source:scenario.sourceType??'unknown'}}]}:{type:'FeatureCollection',features:[]};}
// A bounded selection neighborhood. Never manufacture positions for graph nodes.
export function selectionNeighborhood(graph,id,limit=16){
  const byId=new Map(graph.nodes.map(node=>[node.id,node]));
  const all=graph.edges.filter(edge=>edge.sourceId===id||edge.targetId===id);
  const edges=all.slice(0,limit),ids=new Set([id,...edges.flatMap(edge=>[edge.sourceId,edge.targetId])]);
  const located=node=>Array.isArray(node?.coordinates)&&node.coordinates.length===2&&node.coordinates.every(Number.isFinite);
  return {edges,total:all.length,nodes:[...ids].map(key=>byId.get(key)).filter(Boolean),lines:edges.filter(edge=>located(byId.get(edge.sourceId))&&located(byId.get(edge.targetId))).map(edge=>({type:'Feature',geometry:{type:'LineString',coordinates:[byId.get(edge.sourceId).coordinates,byId.get(edge.targetId).coordinates]},properties:{relationship:edge.relationship,evidence:edge.evidenceLevel}}))};
}
