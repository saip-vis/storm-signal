import { mlHealth } from '../ml.js';
import { loadSnapshot,buildingPathsFor } from '../buildings.js';
import { loadPoiSnapshot,poiCachePath } from '../pois.js';
import { loadCensusSnapshot } from '../census.js';
import { VISUALIZATION_REGION_ID } from '../regions.js';
import { liveVerification,toolDefinitions } from './agent.js';
import { agentLimits } from './budget.js';
let dataProbe,checkedAt=0;
export async function agentHealth(){
  if(!dataProbe||Date.now()-checkedAt>60000){checkedAt=Date.now();dataProbe=(async()=>{const results=await Promise.allSettled([mlHealth(),loadSnapshot(buildingPathsFor(VISUALIZATION_REGION_ID).cache),loadPoiSnapshot(poiCachePath(VISUALIZATION_REGION_ID)),loadCensusSnapshot()]);return {ml:results[0].status==='fulfilled'?results[0].value:{available:false,reason:'Python health probe failed. Choose Geometry exposure or check /api/ml/health.'},realDataLayers:{buildings:results[1].status==='fulfilled',pois:results[2].status==='fulfilled',census:results[3].status==='fulfilled'}};})();}
  const data=await dataProbe,configured=Boolean(process.env.NVIDIA_API_KEY),provider=process.env.AGENT_PROVIDER??'nvidia';
  return {status:configured&&provider==='nvidia'?'configured':'unavailable',provider,model:process.env.NVIDIA_MODEL??'nvidia/nemotron-3-ultra-550b-a55b',apiKeyConfigured:configured,...liveVerification(),regionId:VISUALIZATION_REGION_ID,toolCount:toolDefinitions.length,limits:agentLimits(),mlInferenceVerified:data.ml.available,ml:data.ml,realDataLayers:data.realDataLayers,checkedAt:new Date(checkedAt).toISOString(),action:configured?provider==='nvidia'?null:'AGENT_PROVIDER is offline. Set it to nvidia and restart.':'Set NVIDIA_API_KEY in .env and restart the server.'};
}
