// Small task runner: `node scripts/run.mjs test`
import { BACKEND, requireVenv, run, venvPython } from './common.mjs';

const task = process.argv[2];
requireVenv();
if (task === 'test') {
  await run(venvPython, ['-m', 'pytest'], { cwd: BACKEND, env: { ...process.env, DJANGO_DEBUG: 'true' } });
} else {
  console.error('Usage: node scripts/run.mjs test');
  process.exit(1);
}
