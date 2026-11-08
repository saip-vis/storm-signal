import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?walk(`${dir}/${e.name}`):`${dir}/${e.name}`))).flat();}
for(const file of (await Promise.all(['src','frontend','scripts','test'].map(walk))).flat().filter(f=>f.endsWith('.js'))){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw new Error(`${file}: ${result.stderr}`);}
const html=await readFile('frontend/index.html','utf8');for(const file of ['app.js','style.css'])if(!html.includes(file))throw new Error(`Missing frontend asset reference ${file}`);
console.log('JavaScript syntax and static frontend entrypoint checks passed.');
