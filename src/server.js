import http from 'node:http'; import { readFile } from 'node:fs/promises'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { NetworkService } from './service.js'; import { loadSimulationInputs, runSimulation, compareScenarios, explainNodeRisk, loadGraph } from './simulation/engine.js'; import { chat, session as getAgentSession, reset as resetAgentSession, toolDefinitions } from './agent/agent.js'; import { mlHealth, modelMetadata, predictBuildingDamageBatch } from './ml.js'; import { buildingResponse, loadSnapshot, buildingPathsFor } from './buildings.js';
import { poiResponse, ESSENTIAL_CATEGORIES, loadPoiSnapshot, poiCachePath } from './pois.js';
import { censusResponse, loadCensusSnapshot, censusCachePath } from './census.js';
import { VISUALIZATION_REGION_ID as DEFAULT_REGION_ID, region } from './regions.js';
import { verifyMlInference } from './simulation/engine.js';
import { productionScenario } from './production-simulation.js';
import { supportedScenarios, getScenario, analyzeHazard } from './hazards/index.js';
import { frontendConfig } from './frontend-config.js';
import { agentHealth } from './agent/health.js';
import { dragonfly } from './dragonfly.js';
const service = new NetworkService(); const port = Number(process.env.PORT || 3030);
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const send = (res, status, value) => { res.writeHead(status, {'content-type':'application/json','access-control-allow-origin':'*'}); res.end(JSON.stringify(value, null, 2)); };
function query(url) { return Object.fromEntries(url.searchParams); }
const server = http.createServer(async (req,res) => { const url = new URL(req.url, `http://${req.headers.host}`); try {
  if(url.pathname==='/dragonfly'||url.pathname.startsWith('/dragonfly/'))return await dragonfly(req,res,url);
  if(req.method==='GET'&&url.pathname==='/api/frontend-config')return send(res,200,frontendConfig());
  if(req.method==='GET'&&url.pathname==='/api/hazards')return send(res,200,await supportedScenarios());
  const hazardScenario=url.pathname.match(/^\/api\/simulations\/scenarios\/(noaa-dat(?::|%3A)[0-9]+)$/i);if(req.method==='GET'&&hazardScenario)return send(res,200,await getScenario(decodeURIComponent(hazardScenario[1])));
  if(req.method==='GET'&&/^\/fonts\/(?:BarlowCondensed|SourceSans3)-(?:400|500|600)\.ttf$/.test(url.pathname)){const body=await readFile(path.join(projectRoot,'frontend','fonts',path.basename(url.pathname)));res.writeHead(200,{'content-type':'font/ttf','cache-control':'public, max-age=31536000'});return res.end(body);}
  if(req.method==='GET'&&url.pathname==='/api/region')return send(res,200,region(DEFAULT_REGION_ID));
  if(req.method==='GET'&&url.pathname==='/api/data/buildings')return send(res,200,await buildingResponse({locationId:url.searchParams.get('locationId')??undefined,regionId:url.searchParams.get('regionId')??undefined,offset:url.searchParams.get('offset')??undefined,limit:url.searchParams.get('limit')??undefined,bbox:url.searchParams.get('bbox')??undefined,geojson:url.searchParams.get('format')==='geojson'}));
  if(req.method==='GET'&&url.pathname==='/api/data/businesses/categories')return send(res,200,{categories:ESSENTIAL_CATEGORIES});
  if(req.method==='GET'&&url.pathname==='/api/data/census/summary'){const snap=await loadCensusSnapshot(censusCachePath());return send(res,200,{tractCount:snap.tractCount,totalPopulation:snap.features.every(t=>t.population!=null)?snap.features.reduce((s,t)=>s+t.population,0):null,totalHousingUnits:snap.features.every(t=>t.housingUnits!=null)?snap.features.reduce((s,t)=>s+t.housingUnits,0):null,dataYear:snap.dataYear,source:snap.source});}
  if(req.method==='GET'&&url.pathname==='/api/data/census')return send(res,200,await censusResponse({format:url.searchParams.get('format')??undefined,bbox:url.searchParams.get('bbox')??undefined}));
  if(req.method==='GET'&&url.pathname==='/api/data/businesses')return send(res,200,await poiResponse({locationId:url.searchParams.get('locationId')??undefined,category:url.searchParams.get('category')??undefined,offset:url.searchParams.get('offset')??undefined,limit:url.searchParams.get('limit')??undefined,geojson:url.searchParams.get('format')==='geojson'}));
  if(req.method==='GET'&&['/','/style.css','/app.js','/adapter.js','/agent-client.js'].includes(url.pathname)){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);const body=await readFile(path.join(projectRoot,'frontend',file));res.writeHead(200,{'content-type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html','cache-control':'no-store'});return res.end(body);}
  if(req.method==='GET'&&url.pathname.startsWith('/vendor/maplibre-')&&url.pathname.endsWith('.mjs')){const file=path.basename(url.pathname);const body=await readFile(path.join(projectRoot,'node_modules/maplibre-gl/dist',file));res.writeHead(200,{'content-type':'application/javascript','cache-control':'public, max-age=3600'});return res.end(body);}
  if(req.method==='GET'&&url.pathname==='/vendor/maplibre-gl.css'){const body=await readFile(path.join(projectRoot,'node_modules/maplibre-gl/dist/maplibre-gl.css'));res.writeHead(200,{'content-type':'text/css','cache-control':'public, max-age=3600'});return res.end(body);}
  if(req.method==='GET'&&url.pathname==='/vendor/cytoscape.js'){const body=await readFile(path.join(projectRoot,'node_modules/cytoscape/dist/cytoscape.min.js'));res.writeHead(200,{'content-type':'application/javascript','cache-control':'public, max-age=3600'});return res.end(body);}
  if(req.method==='GET'&&url.pathname==='/api/ml/health')return send(res,200,await mlHealth());
  if(req.method==='GET'&&url.pathname==='/api/ml/model')return send(res,200,await modelMetadata()??{available:false});
  if(req.method==='POST'&&(url.pathname==='/api/ml/predict-damage'||url.pathname==='/api/ml/predict-batch')){let body='';for await(const x of req)body+=x;const input=JSON.parse(body);const items=url.pathname.endsWith('batch')?input: [input];const predictions=await predictBuildingDamageBatch(items);return send(res,200,url.pathname.endsWith('batch')?predictions:predictions[0]);}
  if(req.method==='GET'&&url.pathname==='/api/agent/health')return send(res,200,await agentHealth());
  if(req.method==='GET'&&url.pathname==='/api/agent/tools')return send(res,200,toolDefinitions.map(x=>({name:x.function.name,description:x.function.description})));
  if(req.method==='POST'&&url.pathname==='/api/agent/chat'){
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>24000)throw new Error('Agent request exceeds 24 KB');}
    const input=JSON.parse(body),stream=req.headers.accept?.includes('application/x-ndjson'),controller=new AbortController();
    res.on('close',()=>{if(!res.writableEnded)controller.abort(new DOMException('Client cancelled the investigation','AbortError'));});
    const write=value=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(value)+'\n');};
    if(stream){res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-store','x-accel-buffering':'no'});res.flushHeaders();}
    try{
      const result=await chat({...input,...(input.smokeTest?{provider:'nvidia'}:{})},{signal:controller.signal,onProgress:progress=>{if(stream)write({type:'progress',...progress});}});
      if(stream){write({type:'result',result});return res.end();}return send(res,200,result);
    }catch(error){if(stream){write({type:'error',message:error.message});return res.end();}throw error;}
  }
  const agentPath=url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)(\/trace|\/reset)?$/);if(agentPath){const id=decodeURIComponent(agentPath[1]);if(req.method==='POST'&&agentPath[2]==='/reset')return send(res,200,resetAgentSession(id));if(req.method==='GET')return send(res,200,agentPath[2]==='/trace'?getAgentSession(id).trace:getAgentSession(id));}
  if (req.method === 'GET' && url.pathname === '/api/simulations/health') return send(res,200,{status:'ok',component:'disaster-simulation-engine'});
  if (req.method === 'GET' && url.pathname === '/api/simulations/scenarios') return send(res,200,(await supportedScenarios()).scenarios);
  if (req.method === 'GET' && url.pathname === '/api/simulations/scenarios/richardson-flood-demo') return send(res,200,await productionScenario());
  if (req.method === 'POST' && url.pathname === '/api/simulations/run') { let body='';for await(const x of req)body+=x;const input=body?JSON.parse(body):{};return send(res,200,await analyzeHazard(input)); }
  if (req.method === 'POST' && url.pathname === '/api/simulations/compare') { let body='';for await(const x of req)body+=x;const input=body?JSON.parse(body):{};if(input.scenarioId&&input.scenarioId!=='richardson-flood-demo')throw new Error('Counterfactuals are available only for the hypothetical flood');if(input.predictionMode!=='hybrid')throw new Error('Preservation requires explicit experimental hybrid mode');return send(res,200,await compareScenarios(input.modification)); }
  const simulationNode=url.pathname.match(/^\/api\/simulations\/results\/richardson-flood-demo\/nodes\/([^/]+)$/); if(req.method==='GET'&&simulationNode){const r=await analyzeHazard(),g=await loadGraph();return send(res,200,explainNodeRisk(g.graph,r,decodeURIComponent(simulationNode[1])));}
  if(req.method==='GET'&&url.pathname==='/api/simulations/results/richardson-flood-demo/timeline'){const r=await analyzeHazard();return send(res,200,r.timeline);}
  if(req.method==='GET'&&url.pathname==='/api/simulations/results/richardson-flood-demo/impact'){const r=await analyzeHazard();return send(res,200,{businessImpact:r.businessImpact,directCommunityImpact:r.directCommunityImpact,shelterNeeds:r.shelterNeeds,serviceGaps:r.serviceGaps});}
  if(req.method==='GET'&&url.pathname==='/api/simulations/results/richardson-flood-demo')return send(res,200,await analyzeHazard());
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{status:'ok',component:'geographic-data-and-dependency-network'});
  if (req.method === 'GET' && url.pathname === '/api/locations') return send(res,200,service.locations());
  if (req.method === 'POST' && url.pathname === '/api/network/build') { let body=''; for await(const x of req) body+=x; const input=body?JSON.parse(body):{};if(input.options?.mode==='demo'&&process.env.ALLOW_DEMO_DATA!=='1')throw new Error('Synthetic HTTP demo mode is disabled');return send(res,200,await service.build(input.locationId, input.options)); }
  if (req.method === 'GET' && url.pathname === '/api/network') return send(res,200,service.network());
  if (req.method === 'GET' && url.pathname === '/api/network/poi-matches') return send(res,200,service.poiMatches??[]);
  if (req.method === 'GET' && url.pathname === '/api/network/summary') return send(res,200,service.summary());
  if (req.method === 'GET' && url.pathname === '/api/network/matches') return send(res,200,{matches:service.matches,unresolved:service.matches.filter(x=>!x.accepted)});
  const match = url.pathname.match(/^\/api\/network\/nodes\/([^/]+)(\/dependencies)?$/); if (req.method === 'GET' && match) return send(res,200,match[2] ? service.trace(decodeURIComponent(match[1]), {maxDepth:query(url).maxDepth,relationshipTypes:query(url).relationshipTypes?.split(',')}) : service.node(decodeURIComponent(match[1])));
  return send(res,404,{error:'Not found'});
} catch(error) { return send(res,400,{error:error.message}); } });
server.listen(port,()=>console.log(`Component 1 API: http://localhost:${server.address().port} (POST /api/network/build first)`));
