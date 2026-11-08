import { NetworkService } from './service.js';
const service = new NetworkService(); const result = await service.build('richardson-tx',{mode:'demo'});
console.log(JSON.stringify({ ...result, trace: service.trace('building:RCH-BLDG-012', { maxDepth: 4 }), matches: service.matches }, null, 2));
