// One-time local setup (no Docker): .env with random secrets, Python venv, migrations, npm installs.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKEND, ROOT, npm, run, systemPython, venvPython } from './common.mjs';

const envFile = path.join(ROOT, '.env');
if (!existsSync(envFile)) {
  copyFileSync(path.join(ROOT, '.env.example'), envFile);
  const secret = () => randomBytes(32).toString('base64url');
  const adminPw = randomBytes(9).toString('base64url');
  let env = readFileSync(envFile, 'utf8')
    .replace(/^DJANGO_SECRET_KEY=.*$/m, `DJANGO_SECRET_KEY=${secret()}`)
    .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${secret()}`)
    .replace(/^GATEWAY_API_KEY=.*$/m, `GATEWAY_API_KEY=${secret()}`)
    .replace(/^EVOLUTION_API_KEY=.*$/m, `EVOLUTION_API_KEY=${secret()}`)
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${adminPw}`)
    .replace(/^DJANGO_DEBUG=.*$/m, 'DJANGO_DEBUG=true'); // this script sets up local development, not Docker
  writeFileSync(envFile, env);
  console.log(`\nCreated .env with random secrets.\n  Dashboard login: admin / ${adminPw}\n  (also saved as ADMIN_PASSWORD in .env)\n`);
} else {
  console.log('.env already exists; leaving it as is.');
}

if (!existsSync(venvPython)) {
  const [py, pre] = systemPython();
  console.log('Creating Python virtual environment…');
  await run(py, [...pre, '-m', 'venv', path.join(BACKEND, '.venv')]);
}
console.log('Installing Python packages…');
await run(venvPython, ['-m', 'pip', 'install', '-q', '--upgrade', 'pip']);
await run(venvPython, ['-m', 'pip', 'install', '-q', '-r', path.join(BACKEND, 'requirements-dev.txt')]);

console.log('Preparing the database…');
await run(venvPython, ['manage.py', 'migrate', '--noinput'], { cwd: BACKEND });
await run(venvPython, ['manage.py', 'ensure_admin'], { cwd: BACKEND });

for (const dir of ['gateway', 'frontend']) {
  console.log(`Installing ${dir} packages…`);
  await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: path.join(ROOT, dir) });
}

console.log('\nSetup complete. Start everything with:  npm run dev\n');
