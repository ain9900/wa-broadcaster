import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BACKEND = path.join(ROOT, 'backend');
export const isWin = process.platform === 'win32';
export const venvPython = path.join(BACKEND, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
export const npm = isWin ? 'npm.cmd' : 'npm';

export function systemPython() {
  return isWin ? ['py', ['-3']] : ['python3', []];
}

/** Run a command, inherit output, resolve on exit code 0. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: isWin && cmd.endsWith('.cmd'), ...opts });
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))));
    p.on('error', reject);
  });
}

export function requireVenv() {
  if (!existsSync(venvPython)) {
    console.error('Python environment missing. Run `npm run setup` first.');
    process.exit(1);
  }
}
