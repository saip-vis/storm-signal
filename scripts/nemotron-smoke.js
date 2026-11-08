/** One bounded live verification against the running server; never treats offline/partial answers as success. */
const base=process.env.AGENT_SMOKE_URL??`http://localhost:${process.env.PORT??3030}`;
const health=await fetch(base+'/api/agent/health',{signal:AbortSignal.timeout(8000)}).then(async r=>{if(!r.ok)throw new Error('Health endpoint unavailable; start the backend first.');return r.json();});
console.log(JSON.stringify({provider:health.provider,model:health.model,apiKeyConfigured:health.apiKeyConfigured,limits:health.limits,previouslyVerified:health.liveNvidiaVerified}));
if(!health.apiKeyConfigured||health.provider!=='nvidia')throw new Error(health.action??'NVIDIA is not configured');
const response=await fetch(base+'/api/agent/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:`live-smoke-${Date.now()}`,smokeTest:true,message:'Call get_network_summary exactly once for richardson-north-central-study. Then state its exact nodeCount and edgeCount in one concise sentence. Do not run simulations or request any other tools.',context:{locationId:'richardson-north-central-study',scenarioId:'richardson-flood-demo',predictionMode:'exposure'}}),signal:AbortSignal.timeout(health.limits.totalTimeoutMs+5000)});
const result=await response.json();
console.log(JSON.stringify({status:result.status,answer:result.answer,tools:result.toolTrace?.map(t=>({name:t.toolName,status:t.status,result:t.resultSummary})),warnings:result.warnings,budget:result.budget,runtime:result.runtime,liveNvidiaVerified:result.liveNvidiaVerified},null,2));
if(!response.ok||result.provider!=='nvidia'||result.status!=='completed'||!result.answer?.trim()||!result.liveNvidiaVerified||!result.toolTrace?.some(t=>t.toolName==='get_network_summary'&&t.status==='success'))throw new Error('LIVE SMOKE FAILED: do not claim live NVIDIA verification. See the actionable error above.');
console.log('LIVE SMOKE PASSED');
