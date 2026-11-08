import { buildCache, loadSnapshot, buildingPathsFor } from '../src/buildings.js';
import { DEFAULT_REGION_ID } from '../src/regions.js';

const report = s => ({
  schemaVersion: s.schemaVersion,
  rawRecordCount: s.rawRecordCount,
  acceptedRecordCount: s.acceptedRecordCount,
  rejectedRecordCount: s.rejectedRecordCount,
  source: s.source,
  coverage: s.coverage
});

function parseArgs(argv) {
  const rest = argv.slice(2);
  const args = { command: 'normalize', regionId: DEFAULT_REGION_ID };
  if (rest[0] && !rest[0].startsWith('--')) args.command = rest.shift();
  const flag = rest.indexOf('--region');
  if (flag !== -1 && rest[flag + 1]) args.regionId = rest[flag + 1];
  return args;
}

const { command, regionId } = parseArgs(process.argv);
const paths = buildingPathsFor(regionId);

try {
  if (command === 'normalize') {
    console.log(JSON.stringify(report(await buildCache({
      rawPath: paths.raw,
      regionId,
      cachePath: paths.cache
    })), null, 2));
  } else if (command === 'summary') {
    console.log(JSON.stringify(report(await loadSnapshot(paths.cache)), null, 2));
  } else {
    throw new Error('Use normalize or summary');
  }
} catch (error) {
  throw new Error(`Building cache unavailable: ${error.message}. Run npm run data:buildings:fetch; only complete validated Overture extracts can be cached.`);
}
