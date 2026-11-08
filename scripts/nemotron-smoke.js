/**
 * Live NVIDIA Nemotron smoke test.
 *
 * Usage: npm run agent:smoke
 *        node --env-file-if-exists=.env scripts/nemotron-smoke.js
 *
 * Exits 0 only if chat() returns an answer AND at least one tool was called.
 * Never invents a successful NVIDIA response.
 */

import { chat } from '../src/agent/agent.js';

const WATCHED_TOOLS = [
  'get_real_buildings',
  'get_real_facilities',
  'get_census_population',
  'run_disaster_simulation'
];

function fail(message) {
  console.error(`\nSMOKE FAILED: ${message}`);
  process.exit(1);
}

async function main() {
  const keyConfigured = Boolean(process.env.NVIDIA_API_KEY);
  console.log('══════════════════════════════════════════════');
  console.log('  ResilienceOS — Nemotron live smoke test');
  console.log('══════════════════════════════════════════════');
  console.log(`NVIDIA_API_KEY configured: ${keyConfigured}`);
  console.log(`Provider: ${process.env.AGENT_PROVIDER ?? 'nvidia'}`);
  console.log(`Model:    ${process.env.NVIDIA_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b'}`);

  if (!keyConfigured) {
    fail('NVIDIA_API_KEY is not configured. Set it in .env and retry.');
  }

  const message =
    'Summarize the Richardson flood scenario. Use tools. How many real buildings and facilities are in the network? What is the modeled community impact and is it Census-backed?';

  console.log('\nCalling chat()…\n');

  let response;
  try {
    response = await chat({
      sessionId: 'smoke-test',
      message,
      context: { locationId: 'richardson-tx', scenarioId: 'richardson-flood-demo' }
    });
  } catch (error) {
    fail(`chat() threw: ${error.message}`);
  }

  if (!response) fail('chat() returned no response object.');

  const answer = response.answer ?? '';
  const trace = response.toolTrace ?? [];
  const warnings = response.warnings ?? [];

  console.log(`status: ${response.status}`);
  console.log(`tools called: ${trace.length}`);
  if (warnings.length) {
    console.log('warnings:');
    warnings.forEach(w => console.log(`  - ${w}`));
  }

  console.log('\n── toolTrace ──');
  if (trace.length === 0) {
    console.log('(empty)');
  } else {
    for (const item of trace) {
      console.log(`  ${item.toolName}  [${item.status}]`);
    }
  }

  const watchedHit = WATCHED_TOOLS.filter(name => trace.some(t => t.toolName === name));
  console.log('\nWatched tools used:', watchedHit.length ? watchedHit.join(', ') : '(none of the four)');

  console.log('\n── answer ──');
  console.log(answer || '(empty answer)');
  console.log('────────────');

  if (response.status === 'failed' && !answer) {
    fail(`chat() status=failed. ${warnings.join(' | ') || 'No answer and no warnings.'}`);
  }
  if (!answer.trim()) {
    fail('chat() returned an empty answer.');
  }
  if (trace.length === 0) {
    fail('No tools were used. A live investigation must call at least one tool.');
  }

  console.log('\nSMOKE PASSED');
}

main();
