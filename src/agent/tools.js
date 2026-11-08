import { NetworkService } from '../service.js';
import { analyzeHazard, getScenario } from '../hazards/index.js';
import { loadCensusSnapshot } from '../census.js';
import { VISUALIZATION_REGION_ID } from '../regions.js';
const sampleLimit=8;
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function compactNode(n){return {id:n.id,name:n.name,type:n.type,coordinates:n.coordinates??null,geometryType:n.geometry?.type??null,properties:{real:n.properties?.real,category:n.properties?.category,buildingClass:n.properties?.buildingClass,heightMeters:n.properties?.heightMeters??null,floors:n.properties?.floors??null},sources:(n.sources??[]).slice(0,3).map(s=>({category:s.category,acquiredAt:s.acquiredAt??s.reference?.acquiredAt??null,provider:s.reference?.provider??null,datasetRelease:s.reference?.datasetRelease??null})),operatingCondition:'unknown'};}
function compactEdges(edges){return edges.slice(0,12).map(e=>({id:e.id,sourceId:e.sourceId,targetId:e.targetId,relationship:e.relationship,evidenceLevel:e.evidenceLevel,explanation:e.explanation??null}));}
export function compactSimulation(r){return {scenarioId:r.scenarioId,locationId:r.locationId,graphCounts:r.graphCounts,disasterType:r.scenario.disasterType,sourceType:r.scenario.sourceType,eventDate:r.scenario.eventDate??null,reportedContourRating:r.scenario.reportedContourRating??null,eventMaximumRating:r.scenario.eventMaximumRating??null,hazardSource:r.scenario.source?{provider:r.scenario.source.provider,objectId:r.scenario.source.objectId,url:r.scenario.source.url}:null,predictionModeUsed:r.predictionModeUsed,mlInferenceStatus:r.mlInferenceStatus,exposedAssetCount:r.exposedAssetIds.length,exposedBuildingCount:r.exposedBuildingFootprints?.length??0,exposedBuildingFootprintCount:r.exposedBuildingFootprints?.length??0,modeledUnavailableBuildingCount:r.predictionModeUsed==='exposure'?null:r.failures.filter(x=>x.predictedStatus==='potentially_unavailable').length,businessImpact:{...r.businessImpact,affectedBusinesses:r.businessImpact.affectedBusinesses.slice(0,sampleLimit),exposedFacilities:r.businessImpact.exposedFacilities?.slice(0,sampleLimit),sampleLimit},directCommunityImpact:{...r.directCommunityImpact,neighborhoods:r.directCommunityImpact.neighborhoods?.slice(0,sampleLimit),sampleLimit},shelterNeeds:r.shelterNeeds,serviceGaps:r.serviceGaps,assumptions:r.assumptions,limitations:r.limitations};}
export function createToolRuntime(context={}, {signal,serviceFactory=()=>new NetworkService(),analyze=analyzeHazard,censusLoader=loadCensusSnapshot}={}){
  let servicePromise,censusPromise;const analyses=new Map(),toolResults=new Map(),scenarios=new Map();const stats={graphLoads:0,analysisRuns:0,cacheHits:0};
  const check=()=>signal?.throwIfAborted();
  const service=()=>{check();return servicePromise??=(async()=>{stats.graphLoads++;const s=serviceFactory();await s.build();check();return s;})();};
  const census=()=>{check();return censusPromise??=censusLoader();};
  async function scenario(id){check();if(context.scenarioId&&id!==context.scenarioId)throw new Error(`Use the selected scenario ID: ${context.scenarioId}`);if(!scenarios.has(id))scenarios.set(id,getScenario(id));return scenarios.get(id);}
  async function analysis(id,overrides=context.scenarioOverrides??{}){
    await scenario(id);const input={scenarioId:id,predictionMode:context.predictionMode??'exposure',overrides},key=canonical(input);
    if(analyses.has(key)){stats.cacheHits++;return analyses.get(key);}
    if(analyses.size>=3)throw new Error('Analysis budget reached. Start a focused investigation for another scenario.');
    const promise=(async()=>{const s=await service();check();stats.analysisRuns++;return analyze(input,{graph:s.network(),signal});})();analyses.set(key,promise);return promise;
  }
  async function execute(name,args={}){
    check();const key=canonical({name,args});if(toolResults.has(key)){stats.cacheHits++;return toolResults.get(key);}
    const pending=dispatch(name,args);toolResults.set(key,pending);return pending;
  }
  async function dispatch(name,args){
    if(name==='get_network_summary'){
      if(!['richardson-tx','richardson',VISUALIZATION_REGION_ID].includes(args.locationId))throw new Error(`Unknown location ID. Use ${VISUALIZATION_REGION_ID}.`);
      const s=await service(),net=s.network();return {...s.summary(),locationId:VISUALIZATION_REGION_ID,realBuildingCount:s.realBuildingCount??0,realPoiCount:net.nodes.filter(n=>n.type==='business').length,source:'Real Overture / OpenStreetMap geographic records',relationshipEvidence:'Spatially inferred; not verified operating dependencies'};
    }
    if(name==='find_network_nodes'){const q=String(args.query??'').trim().slice(0,160).toLowerCase();if(!q)throw new Error('Provide a nonempty node name or ID');const s=await service(),all=s.network().nodes.filter(n=>n.id.toLowerCase().includes(q)||n.name.toLowerCase().includes(q));return {totalCount:all.length,returnedCount:Math.min(all.length,sampleLimit),records:all.slice(0,sampleLimit).map(compactNode)};}
    if(name==='inspect_network_node'){const s=await service(),r=s.node(args.nodeId);if(!r.node)throw new Error('Unknown node ID');return {node:compactNode(r.node),incoming:compactEdges(r.incoming),outgoing:compactEdges(r.outgoing),totalIncoming:r.incoming.length,totalOutgoing:r.outgoing.length};}
    if(name==='trace_node_dependencies'){const s=await service(),r=s.trace(args.nodeId,{maxDepth:Math.min(4,Math.max(1,Number(args.maxDepth)||2))});return {startNodeId:r.startNodeId,totalRelatedNodes:r.affectedNodeIds.length,affectedNodeIds:r.affectedNodeIds.slice(0,12),traversedEdges:compactEdges(r.traversedEdges),totalEdges:r.traversedEdges.length,disclosure:'Graph association does not establish historical damage or an operating dependency.'};}
    if(name==='run_disaster_simulation')return compactSimulation(await analysis(args.scenarioId));
    if(name==='get_disaster_impact_report'){const r=compactSimulation(await analysis(args.scenarioId)),c=args.category;return c==='business'?r.businessImpact:c==='community'?r.directCommunityImpact:c==='shelter'?r.shelterNeeds:c==='services'?r.serviceGaps:r;}
    if(name==='explain_node_risk'){
      const [r,s]=await Promise.all([analysis(args.scenarioId),service()]),n=s.node(args.nodeId).node;if(!n)throw new Error('Unknown node ID');const exposure=r.exposure.find(e=>e.nodeId===n.id),failure=r.failures.find(f=>f.nodeId===n.id);
      return {node:compactNode(n),hazard:{type:r.scenario.disasterType,sourceType:r.scenario.sourceType,eventDate:r.scenario.eventDate??null},directExposure:exposure,predictedStatus:failure?.predictedStatus??'unknown',experimentalAssessment:failure??null,assumptions:r.assumptions,limitations:r.limitations};
    }
    if(name==='compare_disaster_scenarios'){
      await scenario(args.scenarioId);if(args.scenarioId!=='richardson-flood-demo'||context.predictionMode!=='hybrid')throw new Error('Preservation is available only in explicit experimental flood hybrid mode');
      const [before,after]=await Promise.all([analysis(args.scenarioId),analysis(args.scenarioId,{...context.scenarioOverrides,...args.modification})]);const prior=new Map(before.failures.map(f=>[f.nodeId,f.predictedStatus])),changed=after.failures.filter(f=>f.predictedStatus!==prior.get(f.nodeId));return {baseline:compactSimulation(before),modified:compactSimulation(after),changedStatusCount:changed.length,changedStatusSample:changed.slice(0,sampleLimit),financialBenefit:null,hypothetical:true};
    }
    if(name==='get_real_buildings'||name==='get_real_facilities'){
      const s=await service(),limit=Math.min(sampleLimit,Math.max(1,Number(args.limit)||sampleLimit)),nodes=s.network().nodes.filter(n=>n.type===(name==='get_real_buildings'?'building':'business')&&(!args.category||n.properties.category===args.category));
      return {regionId:VISUALIZATION_REGION_ID,totalCount:nodes.length,returnedCount:Math.min(limit,nodes.length),records:nodes.slice(0,limit).map(compactNode)};
    }
    if(name==='get_census_population'){try{const snap=await census();return {populationScope:'Full intersecting Census tract totals, not residents inside the smaller rectangle or disaster impacts.',tractCount:snap.tractCount,totalPopulation:snap.features.every(t=>t.population!=null)?snap.features.reduce((sum,t)=>sum+t.population,0):null,totalHousingUnits:snap.features.every(t=>t.housingUnits!=null)?snap.features.reduce((sum,t)=>sum+t.housingUnits,0):null,dataYear:snap.dataYear,source:snap.source,...(args.summary===false?{records:snap.features.slice(0,sampleLimit).map(t=>({geoid:t.geoid,name:t.name,population:t.population,housingUnits:t.housingUnits}))}:{})};}catch{check();return {available:false,reason:'Census cache unavailable. Run npm run data:census:fetch.'};}}
    throw new Error(`Unauthorized tool: ${name}`);
  }
  return {execute,stats};
}
export async function executeTool(name,args,context={},runtime=createToolRuntime(context)){return runtime.execute(name,args);}
