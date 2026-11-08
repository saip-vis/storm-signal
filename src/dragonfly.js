import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const port=Number(process.env.DRAGONFLY_PORT||18765);
let child,ready;
async function start(){
  if(ready)return ready;
  ready=(async()=>{
    child=spawn('python3',['serve.py'],{cwd:fileURLToPath(new URL('../dragon-flyght/prototype/flight/',import.meta.url)),env:{...process.env,PORT:String(port)},stdio:['ignore','ignore','pipe']});
    let failure;child.on('error',error=>{failure=error;});child.on('exit',()=>{ready=null;});child.stderr.on('data',()=>{});
    for(let i=0;i<30;i++){if(failure)throw failure;try{const response=await fetch(`http://127.0.0.1:${port}/api/status`,{signal:AbortSignal.timeout(300)});if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    child.kill();throw new Error('Dragon Flyght could not start. Install Python 3 and retry.');
  })().catch(error=>{ready=null;throw error;});return ready;
}
process.on('exit',()=>child?.kill());
export async function dragonfly(req,res,url){
  if(url.pathname==='/dragonfly'){res.writeHead(302,{location:'/dragonfly/'});res.end();return;}
  await start();
  const upstream=http.request({hostname:'127.0.0.1',port,path:url.pathname.slice('/dragonfly'.length)+url.search,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'content-type':'text/plain'});res.end('Dragon Flyght unavailable. Restart the application and check Python 3.');});
  res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);
}
