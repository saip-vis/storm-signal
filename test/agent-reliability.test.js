import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAgent,nvidiaOnce } from '../src/agent/agent.js';
import { createToolRuntime } from '../src/agent/tools.js';
import { agentLimits,toolText } from '../src/agent/budget.js';
import { predictBuildingDamageBatch } from '../src/ml.js';
import { investigate,withAbort } from '../frontend/agent-client.js';
const saved=process.env.NVIDIA_API_KEY;
before(()=>{process.env.NVIDIA_API_KEY='unit-test-placeholder';});after(()=>{if(saved===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=saved;});
const limits={totalTimeoutMs:1000,modelTimeoutMs:500,maxModelCalls:3,maxToolCalls:6,maxOutputTokens:900,maxToolResultChars:12000};
const call=(id='one',name='get_network_summary',args={locationId:'richardson-north-central-study'})=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const fakeRuntime=()=>({stats:{graphLoads:1,analysisRuns:0,cacheHits:0},execute:async()=>({nodeCount:11018,edgeCount:42})});
test('parallel tool/report lookups share exactly one real graph and one analysis',async()=>{
  const runtime=createToolRuntime({scenarioId:'richardson-flood-demo',predictionMode:'exposure'});
  const results=await Promise.all([runtime.execute('get_network_summary',{locationId:'richardson-north-central-study'}),runtime.execute('get_real_buildings',{limit:1}),runtime.execute('run_disaster_simulation',{scenarioId:'richardson-flood-demo'}),runtime.execute('get_disaster_impact_report',{scenarioId:'richardson-flood-demo'}),runtime.execute('run_disaster_simulation',{scenarioId:'richardson-flood-demo'})]);
  assert.equal(runtime.stats.graphLoads,1);assert.equal(runtime.stats.analysisRuns,1);assert.ok(runtime.stats.cacheHits>=2);assert.equal(results[2].exposedBuildingCount,2293);assert.deepEqual(results[2],results[4]);assert.ok(JSON.stringify(results[2]).length<12000);
});
test('full model/tool budget caps oversized tool batches and reserves synthesis',async()=>{
  const flags=[];let executed=0;
  const agent=createAgent({limitsFactory:()=>limits,runtimeFactory:()=>({stats:{},execute:async()=>{executed++;return {nodeCount:11018,edgeCount:42};}}),modelRequest:async(_messages,options)=>{flags.push(options.allowTools);return options.allowTools?{tool_calls:Array.from({length:20},(_,i)=>call(String(i)))}:{content:'11,018 source nodes and 42 inferred edges.'};}});
  const r=await agent.chat({message:'Summarize',provider:'nvidia'});assert.equal(r.status,'completed');assert.equal(executed,6);assert.equal(r.budget.toolCalls,6);assert.equal(r.budget.modelCalls,2);assert.deepEqual(flags,[true,false]);assert.equal(r.liveNvidiaVerified,false);
});
test('verification requires an explicit smoke with successful tools and matching count evidence',async()=>{
  const agent=createAgent({limitsFactory:()=>limits,runtimeFactory:fakeRuntime,modelRequest:async messages=>messages.some(m=>m.role==='tool')?{content:'11,018 nodes and 42 inferred edges.'}:{tool_calls:[call()]}});
  assert.equal((await agent.chat({message:'Summary',provider:'nvidia'})).liveNvidiaVerified,false);
  const r=await agent.chat({sessionId:'smoke',message:'Summary',provider:'nvidia',smokeTest:true});assert.equal(r.liveNvidiaVerified,true);
  assert.equal((await createAgent().chat({message:'Summary',provider:'mock_test',smokeTest:true})).liveNvidiaVerified,false);
});
test('full deadline stops a hung provider and makes no retries or tool calls',async()=>{
  let receivedSignal;const agent=createAgent({limitsFactory:()=>({...limits,totalTimeoutMs:25}),runtimeFactory:fakeRuntime,modelRequest:async(_m,{signal})=>{receivedSignal=signal;return new Promise(()=>{});}});
  const r=await agent.chat({message:'Summary',provider:'nvidia'});assert.equal(r.status,'timeout');assert.equal(r.budget.modelCalls,1);assert.equal(r.budget.toolCalls,0);assert.equal(receivedSignal.aborted,true);assert.match(r.warnings[0],/time budget/);
});
test('cancellation propagates to provider and releases the busy session',async()=>{
  const controller=new AbortController();let receivedSignal;
  const agent=createAgent({limitsFactory:()=>limits,runtimeFactory:fakeRuntime,modelRequest:async(_m,{signal})=>{receivedSignal=signal;return new Promise(()=>{});}});
  const pending=agent.chat({sessionId:'cancel',message:'Summary',provider:'nvidia'},{signal:controller.signal});
  await assert.rejects(()=>agent.chat({sessionId:'cancel',message:'Second',provider:'nvidia'}),/already running/);controller.abort(new DOMException('Cancelled by user','AbortError'));const r=await pending;assert.equal(r.status,'cancelled');assert.equal(receivedSignal.aborted,true);assert.deepEqual(agent.reset('cancel'),{reset:true,sessionId:'cancel'});
});
test('Python tool failures are actionable and stop further model requests',async()=>{
  let count=0;const agent=createAgent({limitsFactory:()=>limits,modelRequest:async()=>{count++;return {tool_calls:[call('py','run_disaster_simulation',{scenarioId:'richardson-flood-demo'})]};},runtimeFactory:()=>({stats:{},execute:async()=>{throw new Error('Python/XGBoost inference failed');}})});
  const r=await agent.chat({message:'Analyze',provider:'nvidia'});assert.equal(r.status,'failed');assert.equal(count,1);assert.match(r.warnings.at(-1),/Choose Geometry exposure/);
});
test('NVIDIA HTTP errors give safe actions instead of provider bodies or automatic retries',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('secret-provider-body',{status:401});});
  await assert.rejects(()=>nvidiaOnce([]),error=>/NVIDIA HTTP 401/.test(error.message)&&/NVIDIA_API_KEY/.test(error.message)&&!error.message.includes('secret-provider-body'));assert.equal(calls,1);
});
test('Python cancellation kills the child process rather than leaving background inference',async()=>{
  const controller=new AbortController();let killed=false;
  const spawnImpl=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>setTimeout(()=>controller.abort(new DOMException('Stop','AbortError')),5);child.kill=()=>{killed=true;};return child;};
  await assert.rejects(()=>predictBuildingDamageBatch([{nodeId:'x',buildingAttributes:{waterDepth:2}}],{signal:controller.signal,spawnImpl}),/Stop/);assert.equal(killed,true);
});
test('Python failure returns an unavailable assessment with a usable fallback action',async()=>{
  const spawnImpl=()=>{throw new Error('no python');};const [r]=await predictBuildingDamageBatch([{nodeId:'x',buildingAttributes:{waterDepth:2}}],{spawnImpl});assert.equal(r.estimatedDamageFraction,null);assert.equal(r.predictionMethod,'unavailable');assert.match(r.limitations[0],/Geometry exposure/);
});
test('stream client decodes split progress/final records and refuses incomplete streams',async()=>{
  const packets=JSON.stringify({type:'progress',detail:'Reading source evidence'})+'\n'+JSON.stringify({type:'result',result:{status:'completed',answer:'Source evidence only.'}})+'\n',bytes=new TextEncoder().encode(packets),progress=[];
  const fetchImpl=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,19));controller.enqueue(bytes.slice(19));controller.close();}}));
  const r=await investigate({message:'Summary'},{fetchImpl,onProgress:p=>progress.push(p)});assert.equal(r.status,'completed');assert.equal(progress.length,1);
  await assert.rejects(()=>investigate({},{fetchImpl:async()=>new Response('')}),/without a final result/);
  const c=new AbortController(),pending=withAbort(new Promise(()=>{}),c.signal);c.abort(new DOMException('Cancel preflight','AbortError'));await assert.rejects(()=>pending,/Cancel preflight/);
});
test('limits and tool JSON remain bounded despite oversized environment values or data',t=>{
  for(const key of ['AGENT_MAX_STEPS','AGENT_TOTAL_TIMEOUT_MS','AGENT_MAX_TOOL_CALLS']){const prior=process.env[key];t.after(()=>{if(prior===undefined)delete process.env[key];else process.env[key]=prior;});process.env[key]='9999999';}const r=agentLimits();assert.equal(r.maxModelCalls,3);assert.equal(r.maxToolCalls,6);assert.equal(r.totalTimeoutMs,45000);assert.ok(toolText({records:Array.from({length:1000},()=>({text:'x'.repeat(10000)}))}).length<=12000);
});
