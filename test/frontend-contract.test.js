import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('frontend controller targets exist in the static entrypoint or generated inspector',async()=>{
  const html=await readFile(new URL('../frontend/index.html',import.meta.url),'utf8'),app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8');
  for(const [,id] of app.matchAll(/\$\('#([\w-]+)'\)/g))assert.ok((html+app).includes(`id="${id}"`),`Missing controller target #${id}`);
  for(const id of ['dragonfly','view-dragonfly','hazard-select','event-select','prediction-mode','hazard-layer-label'])assert.ok(html.includes(`id="${id}"`));
});
