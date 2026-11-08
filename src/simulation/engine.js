import { readFile } from 'node:fs/promises'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { NetworkService } from '../service.js';
import { predictBuildingDamageBatch, hybridAssessments } from '../ml.js';
import { loadSnapshot, buildingPathsFor } from '../buildings.js';
import { DEFAULT_REGION_ID } from '../regions.js';
import { loadCensusSnapshot } from '../census.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'); const data=path.join(root,'data/simulations');
const onSegment=(p,a,b)=>Math.abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))<1e-10&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
const inside=(p,ring)=>{let inPoly=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if(onSegment(p,ring[j],ring[i]))return true;if(((yi>p[1])!== (yj>p[1]))&&p[0] <= (xj-xi)*(p[1]-yi)/(yj-yi)+xi)inPoly=!inPoly;} return inPoly;};
const clone=x=>JSON.parse(JSON.stringify(x)); const round=x=>Math.round(x*100)/100;

// ── Polygon-flood exposure helpers ────────────────────────────────────────────

// Compute axis-aligned bbox [minLon, minLat, maxLon, maxLat] of a ring.
const ringBbox = ring => [
  Math.min(...ring.map(c => c[0])),
  Math.min(...ring.map(c => c[1])),
  Math.max(...ring.map(c => c[0])),
  Math.max(...ring.map(c => c[1]))
];

// Fast bbox overlap test.
const bboxOverlap = ([ax1,ay1,ax2,ay2],[bx1,by1,bx2,by2]) =>
  ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;

// Check whether a building polygon (Polygon or MultiPolygon) intersects the
// flood polygon ring. Uses bbox fast-reject then vertex-in-polygon spot check.
// (No full Sutherland-Hodgman clipping needed for MVP.)
function polygonFloodExposure(buildingGeometry, floodRing) {
  const floodBbox = ringBbox(floodRing);
  const outerRings = buildingGeometry.type === 'Polygon'
    ? [buildingGeometry.coordinates[0]]
    : buildingGeometry.coordinates.map(poly => poly[0]);
  for (const ring of outerRings) {
    if (!bboxOverlap(ringBbox(ring), floodBbox)) continue;
    // Any building vertex inside the flood polygon?
    if (ring.some(v => inside(v, floodRing))) return 'polygon_intersection';
    // Any flood vertex inside the building polygon?
    if (floodRing.some(v => inside(v, ring))) return 'polygon_intersection';
    // Bboxes overlap but no vertex penetration detected → bbox_overlap only
    return 'bbox_overlap';
  }
  return null; // no intersection
}

// Try to load real Overture building footprints; returns [] if cache is absent.
export async function loadBuildingFootprints() {
  try {
    const snapshot = await loadSnapshot(buildingPathsFor(DEFAULT_REGION_ID).cache);
    return snapshot.features;
  } catch {
    return [];
  }
}
export async function loadSimulationInputs(){const [scenario,attributes]=await Promise.all(['richardson-flood.json','richardson-attributes.json'].map(async f=>JSON.parse(await readFile(path.join(data,f),'utf8')))); return {scenario,attributes};}
export async function loadGraph(){const s=new NetworkService();await s.build();return {graph:s.network(),origin:'component1_offline_fixture'};}
export function validateScenario(s){if(!s||s.disasterType!=='flood')throw new Error('Only flood scenarios are supported by this MVP');if(!Number.isFinite(s.severity)||s.severity<1||s.severity>5)throw new Error('Flood severity must be 1–5');if(s.footprint?.type!=='Polygon')throw new Error('Scenario requires a Polygon footprint');}
export function calculateExposure(graph,scenario){validateScenario(scenario); const ring=scenario.footprint.coordinates[0], byId=new Map(graph.nodes.map(n=>[n.id,n])); return graph.nodes.map(n=>{let coords=n.coordinates,derivedFrom; if(!coords){const host=graph.edges.find(e=>e.targetId===n.id&&['HOSTS','HAS_EQUIPMENT'].includes(e.relationship));if(host){coords=byId.get(host.sourceId)?.coordinates;derivedFrom=host.sourceId;}} if(!coords)return {nodeId:n.id,exposureStatus:'unknown',method:'no_location',assumptions:['No coordinates or supported host location.']}; const exposed=inside(coords,ring);return {nodeId:n.id,exposureStatus:exposed?'exposed':'unexposed',method:derivedFrom?'host_inherited_point_in_polygon':'point_in_polygon',derivedFrom,source:'hypothetical_flood_footprint',assumptions:['Node coordinate approximates facility location']};});}
export function predictOperationalFailures(graph,exposures,scenario,attributes,overrides={}){const exp=new Map(exposures.map(x=>[x.nodeId,x])); return graph.nodes.filter(n=>n.type==='building').map(n=>{const forced=overrides.facilityStatus?.[n.id], e=exp.get(n.id), vuln=overrides.vulnerability?.[n.id]??attributes.facilities[n.id]?.vulnerability??'unknown'; let risk='low',status='operational',hours=0,reasons=[]; if(forced){status=forced;risk=forced==='operational'?'low':'high';hours=status==='potentially_unavailable'?scenario.durationHours:0;reasons=['COUNTERFACTUAL_OVERRIDE'];} else if(e?.exposureStatus==='exposed'){risk=(scenario.severity>=3||vuln==='high')?'high':'elevated';status='potentially_unavailable';hours=scenario.durationHours;reasons=['FLOOD_EXPOSURE',`VULNERABILITY_${vuln.toUpperCase()}`]; const equipment=graph.nodes.filter(x=>x.type==='equipment').filter(x=>graph.edges.some(ed=>ed.sourceId===n.id&&ed.targetId===x.id));if(equipment.some(x=>x.properties.maintenance_status==='service_due'))reasons.push('RELEVANT_EQUIPMENT_SERVICE_DUE');} return {nodeId:n.id,riskLevel:risk,predictedStatus:status,estimatedDowntimeHours:hours,reasonCodes:reasons,confidence:'scenario_based',simulated:true,assumptions:['Rule-based classification; not a calibrated failure probability.'],provenance:n.sources};});}
export function propagateImpacts(graph,failures){const failed=new Map(failures.filter(x=>x.predictedStatus==='potentially_unavailable').map(x=>[x.nodeId,{...x,impactType:'direct_facility_unavailability',path:[x.nodeId],direct:true}]));const queue=[...failed.values()];while(queue.length){const cur=queue.shift();for(const e of graph.edges.filter(x=>x.sourceId===cur.nodeId)){let kind,status;if(e.relationship==='HOSTS'){kind='business_interruption';status='potentially_interrupted';}else if(e.relationship==='PROVIDES_SERVICE'&&cur.impactType==='business_interruption'){kind='service_capacity_reduction';status='potentially_reduced';}else if(e.relationship==='SERVES_AREA'&&cur.impactType==='service_capacity_reduction'){kind='service_access_gap';status='potentially_reduced_access';}else continue;if(failed.has(e.targetId))continue;const next={nodeId:e.targetId,impactType:kind,predictedStatus:status,estimatedDowntimeHours:cur.estimatedDowntimeHours,path:[...cur.path,e.targetId],upstreamCause:cur.nodeId,direct:false,evidence:e.evidenceLevel,assumptions:[e.explanation??`Relationship-aware ${e.relationship} propagation.`]};failed.set(next.nodeId,next);queue.push(next);}}return {impacts:[...failed.values()]};}
export function calculateBusinessImpact(graph,cascading,attributes){const map=new Map(cascading.impacts.map(x=>[x.nodeId,x]));const businesses=graph.nodes.filter(n=>n.type==='business'&&map.has(n.id)).map(n=>{const i=map.get(n.id),a=attributes.businesses[n.id];const fraction=i.predictedStatus==='potentially_interrupted'?1:0;const revenue=a?round(a.hourlyRevenueEstimateUSD*i.estimatedDowntimeHours*fraction):null;return {businessId:n.id,name:n.name,operationalStatus:i.predictedStatus,estimatedDowntimeHours:i.estimatedDowntimeHours,interruptionFraction:fraction,hourlyRevenueEstimateUSD:a?.hourlyRevenueEstimateUSD??null,estimatedRevenueAtRiskUSD:revenue,synthetic:true,causingPath:i.path};});return {affectedBusinesses:businesses,totalAffectedBusinesses:businesses.length,totalEstimatedRevenueAtRiskUSD:round(businesses.reduce((s,x)=>s+(x.estimatedRevenueAtRiskUSD??0),0)),totalLostOperatingHours:businesses.reduce((s,x)=>s+x.estimatedDowntimeHours,0)};}
export function calculateDirectCommunityImpact(scenario,attributes,tracts=[]){
  // ── Census-backed path: real ACS population data ──────────────────────────
  if(tracts.length>0){
    const floodBbox=ringBbox(scenario.footprint.coordinates[0]);
    let totalExposed=0,totalHousing=0,tractCount=0;
    for(const tract of tracts){
      if(!tract.population||!tract.geometry)continue;
      const outerRing=tract.geometry.type==='Polygon'?tract.geometry.coordinates[0]:tract.geometry.coordinates[0][0];
      const tb=ringBbox(outerRing);
      const intMinLon=Math.max(floodBbox[0],tb[0]),intMinLat=Math.max(floodBbox[1],tb[1]);
      const intMaxLon=Math.min(floodBbox[2],tb[2]),intMaxLat=Math.min(floodBbox[3],tb[3]);
      if(intMinLon>=intMaxLon||intMinLat>=intMaxLat)continue;
      const intArea=(intMaxLon-intMinLon)*(intMaxLat-intMinLat);
      const tractArea=(tb[2]-tb[0])*(tb[3]-tb[1]);
      const frac=Math.min(1,intArea/tractArea);
      if(frac<=0)continue;
      totalExposed+=tract.population*frac;
      totalHousing+=(tract.housingUnits??0)*frac;
      tractCount++;
    }
    if(tractCount===0){
      // No tract overlaps the flood bbox — fall through to the synthetic fixture path
    }else{
    totalExposed=round(totalExposed);
    const displaced=round(totalExposed*0.10); // 10% displacement assumption
    const shelterSeekers=round(displaced*0.40); // 40% shelter-seeking of displaced
    return {
      neighborhoods:[],
      totalPopulationExposed:totalExposed,
      exposedHousingUnits:round(totalHousing),
      estimatedDisplacedResidents:displaced,
      estimatedShelterSeekers:shelterSeekers,
      dataSource:'census_acs_2022_area_weighted',
      tractCount,
      displacementAssumption:'10% of area-weighted exposed population',
      assumptions:[
        'Exposure fraction computed from bbox intersection area estimate (not full polygon clipping).',
        'Displacement rate: 10% of area-weighted exposed population (modeled, not observed).',
        'Shelter-seeking rate: 40% of displaced persons.'
      ]
    };
    }
  }
  // ── Synthetic fallback: existing CSV-fixture fractions ────────────────────
  const neighborhoods=Object.entries(attributes.communities).map(([nodeId,a])=>{const exposedPopulation=round(a.population*a.footprintExposureFraction),displaced=round(exposedPopulation*a.displacementFraction),shelter=round(displaced*a.shelterSeekingFraction);return {nodeId,population:a.population,exposedPopulation,estimatedDisplacedResidents:displaced,estimatedShelterSeekers:shelter,synthetic:true};});
  return {neighborhoods,totalPopulationExposed:neighborhoods.reduce((s,x)=>s+x.exposedPopulation,0),estimatedDisplacedResidents:neighborhoods.reduce((s,x)=>s+x.estimatedDisplacedResidents,0),estimatedShelterSeekers:neighborhoods.reduce((s,x)=>s+x.estimatedShelterSeekers,0),dataSource:'synthetic_fixture',tractCount:0,displacementAssumption:'synthetic fixture fractions',assumptions:['Neighborhood fractions are synthetic and do not represent actual displacement counts.']};
}
export function calculateShelterNeeds(community,attributes,overrides={}){const shelters=attributes.shelters.map(s=>({...s,capacity:overrides.shelterCapacity?.[s.id]??s.capacity}));const available=shelters.filter(s=>s.status==='confirmed_available_in_simulation').reduce((n,s)=>n+s.capacity,0);return {shelterDemand:community.estimatedShelterSeekers,availableCapacity:available,unmetShelterDemand:Math.max(0,community.estimatedShelterSeekers-available),shelters,assumptions:['Capacity is confirmed only within the synthetic scenario; unknown candidate capacity is excluded.']};}
export function calculateServiceGaps(graph,cascading,attributes){const impacted=new Map(cascading.impacts.map(x=>[x.nodeId,x]));const gaps=[];for(const e of graph.edges.filter(e=>e.relationship==='SERVES_AREA'&&impacted.has(e.sourceId)&&impacted.has(e.targetId))){const service=graph.nodes.find(n=>n.id===e.sourceId),a=attributes.communities[e.targetId], capacity=attributes.businesses[`business:${service.id.split(':')[1]}`]?.serviceCapacity??0,demand=a.serviceDemand[service.name]??0,alt=attributes.alternatives[e.targetId]?.[service.name]??0;gaps.push({serviceId:service.id,serviceName:service.name,neighborhoodId:e.targetId,modeledDemand:demand,remainingAccessibleCapacity:alt,estimatedCapacityLost:capacity,unmetServiceDemand:Math.max(0,demand-alt),evidence:e.evidenceLevel,synthetic:true});}return {gaps};}
export function timeline(result){return [{stage:'baseline',timeHours:0,affectedNodeIds:[],estimatedBusinessRevenueAtRiskUSD:0,estimatedUnmetShelterDemand:0},{stage:'impact',timeHours:0,affectedNodeIds:result.cascadingImpacts.impacts.map(x=>x.nodeId),estimatedBusinessRevenueAtRiskUSD:result.businessImpact.totalEstimatedRevenueAtRiskUSD,estimatedUnmetShelterDemand:result.shelterNeeds.unmetShelterDemand},{stage:'plus_6_hours',timeHours:6,affectedNodeIds:result.cascadingImpacts.impacts.filter(x=>x.estimatedDowntimeHours>=6).map(x=>x.nodeId),estimatedBusinessRevenueAtRiskUSD:round(result.businessImpact.totalEstimatedRevenueAtRiskUSD*Math.min(6/result.scenario.durationHours,1)),estimatedUnmetShelterDemand:result.shelterNeeds.unmetShelterDemand},{stage:'plus_24_hours',timeHours:24,affectedNodeIds:result.cascadingImpacts.impacts.filter(x=>x.estimatedDowntimeHours>=24).map(x=>x.nodeId),estimatedBusinessRevenueAtRiskUSD:result.businessImpact.totalEstimatedRevenueAtRiskUSD,estimatedUnmetShelterDemand:result.shelterNeeds.unmetShelterDemand}];}
export async function runSimulation({scenario,attributes,graph,overrides={},predictionMode='rules'}={}){if(!scenario||!attributes){const i=await loadSimulationInputs();scenario??=i.scenario;attributes??=i.attributes;}if(!graph)graph=(await loadGraph()).graph;validateScenario(scenario);
const effectiveDuration=overrides?.durationHours??scenario.durationHours;
scenario={...scenario,durationHours:effectiveDuration};
// Load real building footprints for polygon-flood exposure (non-fatal if cache missing)
const buildingFootprints=await loadBuildingFootprints();
// Load Census tracts for real community impact (non-fatal if cache missing)
// Only use tracts with real population data; geometry-only snapshots (populationAvailable:false)
// fall back to the synthetic calculation so existing test expectations are preserved.
let censusTracts=[];try{const censusSnap=await loadCensusSnapshot();censusTracts=censusSnap.features.filter(t=>t.population!=null&&t.population>0);}catch{}
const exposure=calculateExposure(graph,scenario),failures=predictOperationalFailures(graph,exposure,scenario,attributes,overrides);let hybridRiskAssessments=[];let _hybridPredictions=[];if(predictionMode==='hybrid'){
  // Use only exposed building nodes; include synthetic depth from severity
  const exposedNodes=graph.nodes.filter(n=>n.type==='building'&&exposure.some(e=>e.nodeId===n.id&&e.exposureStatus==='exposed'));
  const requests=exposedNodes.map(n=>({nodeId:n.id,buildingAttributes:{floodDepthFeet:scenario.severity*1.5,buildingType:n.properties?.buildingClass??'unknown',floors:n.properties?.floors??null,foundationType:null,yearBuilt:null}}));
  _hybridPredictions=await predictBuildingDamageBatch(requests);
  hybridRiskAssessments=hybridAssessments(failures,_hybridPredictions);
}const cascadingImpacts=propagateImpacts(graph,failures),businessImpact=calculateBusinessImpact(graph,cascadingImpacts,attributes),directCommunityImpact=calculateDirectCommunityImpact(scenario,attributes,censusTracts),shelterNeeds=calculateShelterNeeds(directCommunityImpact,attributes,overrides),serviceGaps=calculateServiceGaps(graph,cascadingImpacts,attributes);const result={id:`result:${scenario.id}`,scenarioId:scenario.id,locationId:scenario.locationId,scenario,predictionModeUsed:predictionMode==='hybrid'&&hybridRiskAssessments.some(x=>x.mlAssessment.available)?'hybrid':'rules',mlInferenceStatus:_hybridPredictions.length>0?(_hybridPredictions.some(p=>p.predictionMethod==='trained_model')?'available':'unavailable_fallback_used'):null,mlModelVersion:_hybridPredictions[0]?.modelVersion??null,simulated:true,generatedAt:new Date().toISOString(),exposure,exposedAssetIds:exposure.filter(x=>x.exposureStatus==='exposed').map(x=>x.nodeId),failures,hybridRiskAssessments,cascadingImpacts,businessImpact,directCommunityImpact,shelterNeeds,serviceGaps,assumptions:scenario.assumptions,limitations:['All population, revenue, capacity, vulnerability, and shelter inputs are synthetic. No output is an official forecast or verified operational assessment.']};result.timeline=timeline(result);
// Polygon-level flood exposure for real Overture building footprints (additive — does not change synthetic-node results)
const floodRing=scenario.footprint.coordinates[0];
result.exposedBuildingFootprints=buildingFootprints.reduce((acc,b)=>{const method=polygonFloodExposure(b.geometry,floodRing);if(method)acc.push({buildingId:b.id,providerId:b.providerId,exposureMethod:method,floodScenarioId:scenario.id});return acc;},[]);
return result;}
export async function compareScenarios(modification){const inputs=await loadSimulationInputs(),base=await runSimulation(inputs),modifiedScenario=clone(inputs.scenario),overrides=clone(modification??{});if(overrides.severity)modifiedScenario.severity=overrides.severity;if(overrides.footprint)modifiedScenario.footprint=overrides.footprint;const modified=await runSimulation({...inputs,scenario:modifiedScenario,overrides});return {baseline:base,modified,differences:{revenueAtRiskUSD:round(modified.businessImpact.totalEstimatedRevenueAtRiskUSD-base.businessImpact.totalEstimatedRevenueAtRiskUSD),unmetShelterDemand:modified.shelterNeeds.unmetShelterDemand-base.shelterNeeds.unmetShelterDemand,changedNodeStatuses:modified.failures.filter((x,i)=>x.predictedStatus!==base.failures[i]?.predictedStatus).map(x=>x.nodeId)},hypothetical:true,modifiedAssumptions:Object.keys(overrides)};}
// Verify that the ML inference pipeline is functional by sending a single test request.
export async function verifyMlInference(){try{const r=await predictBuildingDamageBatch([{nodeId:'verify-test',buildingAttributes:{floodDepthFeet:2.0,buildingType:'residential',floors:1,foundationType:null,yearBuilt:null}}]);return {working:r[0]?.predictionMethod==='trained_model',predictionMethod:r[0]?.predictionMethod??'unknown',error:null};}catch(error){return {working:false,predictionMethod:'rule_fallback',error:error.message};}}
export function explainNodeRisk(graph,result,nodeId){const node=graph.nodes.find(n=>n.id===nodeId);if(!node)throw new Error('Unknown node ID');const exposure=result.exposure.find(x=>x.nodeId===nodeId),failure=result.failures.find(x=>x.nodeId===nodeId),impact=result.cascadingImpacts.impacts.find(x=>x.nodeId===nodeId);return {node,baselineStatus:'operational',predictedStatus:failure?.predictedStatus??impact?.predictedStatus??'operational',directExposure:exposure,upstreamImpact:impact?.path??[],hazard:{type:result.scenario.disasterType,severity:result.scenario.severity},sourceRecords:node.sources,assumptions:[...result.assumptions,...(failure?.assumptions??impact?.assumptions??[])],limitations:result.limitations};}
