// Starts the whole app for local development, with labelled, coloured output:
//   gateway (Node/Baileys) · api (Django) · worker (Celery if REDIS_URL is set, else built-in) · web (Vite)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BACKEND, ROOT, isWin, npm, requireVenv, venvPython } from './common.mjs';

requireVenv();
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const useCelery = !!env.REDIS_URL;

const procs = [
  { name: 'gateway', color: 35, cmd: process.execPath, args: ['--watch', 'src/server.js'], cwd: path.join(ROOT, 'gateway'), skip: env.WA_PROVIDER === 'evolution' },
  { name: 'api', color: 32, cmd: venvPython, args: ['manage.py', 'runserver', '127.0.0.1:8000'], cwd: BACKEND },
  useCelery
    ? { name: 'worker', color: 33, cmd: venvPython, args: ['-m', 'celery', '-A', 'config', 'worker', '-B', '-l', 'info', ...(isWin ? ['--pool', 'threads', '--concurrency', '4'] : []), '--schedule', path.join(BACKEND, '.celerybeat-schedule')], cwd: BACKEND }
    : { name: 'worker', color: 33, cmd: venvPython, args: ['manage.py', 'run_worker'], cwd: BACKEND },
  { name: 'web', color: 36, cmd: npm, args: ['run', 'dev'], cwd: path.join(ROOT, 'frontend') },
].filter(p => !p.skip);

const children = [];
for (const p of procs) {
  const child = spawn(p.cmd, p.args, { cwd: p.cwd, env: { ...process.env, PYTHONUNBUFFERED: '1', FORCE_COLOR: '1' }, shell: isWin && p.cmd.endsWith('.cmd') });
  const tag = `\x1b[${p.color}m${p.name.padEnd(7)}\x1b[0m│ `;
  const pipe = stream => {
    let buf = '';
    stream.on('data', d => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) process.stdout.write(tag + l + '\n');
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', code => process.stdout.write(`${tag}exited (${code})\n`));
  children.push(child);
}

console.log('\n  Open http://localhost:5173  (API on :8000, admin at http://localhost:8000/admin/)\n');

const stop = () => {
  for (const c of children) {
    if (isWin) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
