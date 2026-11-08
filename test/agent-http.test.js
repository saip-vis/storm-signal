import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
async function start(t,env={}){
  const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',AGENT_PROVIDER:'nvidia',NVIDIA_API_KEY:'',...env},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('API startup timeout')),5000);child.on('error',reject);child.stderr.on('data',b=>{clearTimeout(timer);reject(new Error(b.toString()));});child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/localhost:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
}
test('HTTP health distinguishes configuration from verification; streaming returns real progress and bounded final evidence',async t=>{
  const base=await start(t),health=await fetch(base+'/api/agent/health').then(r=>r.json());assert.equal(health.apiKeyConfigured,false);assert.equal(health.liveNvidiaVerified,false);assert.equal(health.limits.maxToolCalls,6);assert.ok(health.limits.totalTimeoutMs<=45000);
  const r=await fetch(base+'/api/agent/chat',{method:'POST',headers:{'content-type':'application/json',accept:'application/x-ndjson'},body:JSON.stringify({message:'Summarize the network',provider:'mock_test'})});
  const packets=(await r.text()).trim().split('\n').map(line=>JSON.parse(line));assert.ok(packets.some(p=>p.type==='progress'&&p.stage==='tools'));const result=packets.at(-1).result;assert.equal(result.status,'completed');assert.equal(result.liveNvidiaVerified,false);assert.equal(result.runtime.graphLoads,1);assert.equal(result.budget.toolCalls,1);
  assert.equal((await fetch(base+'/fonts/BarlowCondensed-600.ttf')).status,200);assert.equal((await fetch(base+'/agent-client.js')).status,200);
});
test('HTTP client cancellation aborts the upstream provider request',async t=>{
  let providerClosed,providerReceived;const received=new Promise(resolve=>providerReceived=resolve),closed=new Promise(resolve=>providerClosed=resolve);const provider=http.createServer((req,res)=>{providerReceived();const timer=setTimeout(()=>res.end(JSON.stringify({choices:[{message:{content:'Late answer'}}]})),5000);res.on('close',()=>{clearTimeout(timer);providerClosed();});req.resume();});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>{provider.closeAllConnections();provider.close();});
  const base=await start(t,{NVIDIA_API_KEY:'local-test-only',NVIDIA_BASE_URL:`http://127.0.0.1:${provider.address().port}/v1`}),controller=new AbortController();
  const response=await fetch(base+'/api/agent/chat',{method:'POST',headers:{'content-type':'application/json',accept:'application/x-ndjson'},body:JSON.stringify({message:'Summarize'}),signal:controller.signal}),reader=response.body.getReader();let data='';
  while(!data.includes('"stage":"model"')){const part=await reader.read();data+=new TextDecoder().decode(part.value);}
  // Wait until the local provider has received the request, then cancel the client stream.
  await received;
  controller.abort();await reader.cancel().catch(()=>{});await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Provider was not aborted')),2000);closed.finally(()=>clearTimeout(timer));})]);
});
