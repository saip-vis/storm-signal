import { chat } from './agent/agent.js';
const response=await chat({sessionId:'offline-demo',message:'Analyze the Richardson flood scenario, identify affected businesses and communities.',provider:'mock_test'});
console.log(JSON.stringify(response,null,2));
