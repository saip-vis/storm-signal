import { mkdir, cp, readdir } from 'node:fs/promises';
await mkdir('dist/vendor',{recursive:true});
await cp('frontend','dist',{recursive:true});
for(const name of await readdir('node_modules/maplibre-gl/dist'))if(name.endsWith('.mjs')||name.endsWith('.css'))await cp(`node_modules/maplibre-gl/dist/${name}`,`dist/vendor/${name}`);
console.log('Static frontend and MapLibre assets built to dist/. Serve through the Node backend for API access.');
