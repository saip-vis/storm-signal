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

export function inspectorPresentation(node,result){
  const p=node.properties??{},sources=node.sources??[];
  const synthetic=Boolean(p.synthetic||p.explicitlySynthetic||sources.some(s=>/synthetic/i.test(`${s.category} ${typeof s.reference==='string'?s.reference:''}`)));
  const real=p.real===true||sources.some(s=>['overture_maps','openstreetmap'].includes(s.category));
  const assessment=result?.failures?.find(item=>item.nodeId===node.id)??result?.cascadingImpacts?.impacts?.find(item=>item.nodeId===node.id);
  const exposure=result?.exposure?.find(item=>item.nodeId===node.id);
  const statusLabels={potentially_unavailable:'Potential disruption',potentially_interrupted:'Possible interruption',potentially_reduced:'Reduced service (modeled)',potentially_reduced_access:'Reduced access (modeled)',exposed_status_unknown:'Operating condition unknown',not_exposed:'Outside scenario',operational:'Operational in scenario'};
  const tone=assessment?.predictedStatus==='operational'?'low':assessment?.predictedStatus==='not_exposed'?'neutral':['high','elevated','low'].includes(assessment?.riskLevel)?assessment.riskLevel:assessment?.predictedStatus?.startsWith('potentially_')?'elevated':'neutral';
  const candidate=result?.hybridRiskAssessments?.find(item=>item.nodeId===node.id)?.mlAssessment;
  const ml=candidate?.predictionMethod==='trained_model'&&candidate.available!==false&&typeof candidate.modelVersion==='string'&&candidate.modelVersion.length>0&&Number.isFinite(candidate.estimatedDamageFraction)&&candidate.estimatedDamageFraction>=0&&candidate.estimatedDamageFraction<=1?candidate:null;
  const conditions={FLOOD_POLYGON_INTERSECTION:'Footprint intersects the hypothetical flood.',FLOOD_EXPOSURE:'Located within the hypothetical flood.',PHYSICAL_DAMAGE_HIGH:'High physical damage severity estimate.',PHYSICAL_DAMAGE_ELEVATED:'Elevated physical damage severity estimate.',PHYSICAL_DAMAGE_LOW:'Low physical damage severity estimate.',COUNTERFACTUAL_OVERRIDE:'A scenario preservation override is applied.',OUTSIDE_SCENARIO:'Outside the active flood footprint.'};
  const localImpact=result?.businessImpact?.affectedBusinesses?.find(item=>item.businessId===node.id);
  return {category:String(p.category??p.buildingClass??node.type??'Asset').replaceAll('_',' '),provenance:synthetic?'Synthetic demo record':real?'Real geographic record':'Source not established',synthetic,assessment,ml,
    status:assessment?(statusLabels[assessment.predictedStatus]??'Assessment available'):result?'No operational assessment':'Not assessed yet',tone,
    exposure:exposure?.exposureStatus==='exposed'?'Intersects hypothetical flood':exposure?.exposureStatus==='unexposed'?'Outside hypothetical flood':'Exposure not assessed',
    conditions:(assessment?.reasonCodes??[]).slice(0,3).map(code=>conditions[code]??'An additional scenario rule was applied.'),
    location:typeof p.address==='string'&&p.address.trim()?p.address:typeof p.city==='string'?p.city:'Richardson study area',
    localImpact,hasLocalNumbers:localImpact&&(Number.isFinite(localImpact.estimatedRevenueAtRiskUSD)||Number.isFinite(localImpact.estimatedDowntimeHours))};
}

export function relationshipDescription(edge,selectedId){
  const outgoing=edge.sourceId===selectedId;
  const phrases={HOSTS:outgoing?'Associated facility':'Associated building',HAS_EQUIPMENT:outgoing?'Installed equipment':'Supporting building',PROVIDES_SERVICE:outgoing?'Provides this service':'Service provider',SERVES_AREA:outgoing?'Modeled service area':'Serving resource',ACCESSIBLE_VIA:outgoing?'Access relationship':'Access relationship',DEPENDS_ON:outgoing?'Dependency link':'Linked dependency',LOCATED_IN:outgoing?'Located within':'Located here'};
  return {label:phrases[edge.relationship]??'Linked asset',evidence:({inferred:'Spatially inferred',hypothetical:'Hypothetical relationship',verified:'Verified source relationship',observed:'Source-observed association'})[edge.evidenceLevel]??'Evidence unknown'};
}
