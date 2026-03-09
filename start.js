#!/usr/bin/env node
/**
 * LyraCore — single start script (Windows & Linux)
 * Usage:  node start.js
 *
 * Starts:
 *   1. Backend  (ts-node-dev, port 5000)
 *   2. Frontend (Vite dev, port 5173)
 *   3. PM2      (ecosystem.config.js) — skipped if pm2 is not installed
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';
const npx   = isWin ? 'npx.cmd' : 'npx';
const npm   = isWin ? 'npm.cmd' : 'npm';
const pm2   = isWin ? 'pm2.cmd' : 'pm2';

const ROOT     = __dirname;
const BACKEND  = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');

const RESET  = '\x1b[0m';
const COLORS = { backend: '\x1b[36m', frontend: '\x1b[35m', pm2: '\x1b[32m', info: '\x1b[33m' };

function tag(name) {
  return `${COLORS[name] || ''}[${name.toUpperCase()}]${RESET}`;
}

function prefix(name, data) {
  String(data).split('\n').forEach(line => {
    if (line.trim()) console.log(`${tag(name)} ${line}`);
  });
}

function run(label, cmd, args, cwd) {
  const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin });

  proc.stdout.on('data', d => prefix(label, d));
  proc.stderr.on('data', d => prefix(label, d));

  proc.on('exit', code => {
    if (code !== 0 && code !== null) {
      console.error(`${tag(label)} exited with code ${code}. Shutting down...`);
      process.exit(code);
    }
  });

  return proc;
}

console.log(`${COLORS.info}▶  Starting LyraCore...${RESET}`);
console.log(`${COLORS.info}   Backend  → http://localhost:5000${RESET}`);
console.log(`${COLORS.info}   Frontend → http://localhost:5173${RESET}\n`);

const backend  = run('backend',  npx, ['ts-node-dev', '--respawn', '--transpile-only', 'src/index.ts'], BACKEND);
const frontend = run('frontend', npm, ['run', 'dev'], FRONTEND);

// Start PM2 if available
const pm2Check = spawnSync(pm2, ['--version'], { shell: isWin });
if (pm2Check.status === 0) {
  console.log(`${COLORS.pm2}[PM2   ] Starting ecosystem.config.js...${RESET}`);
  const pm2Proc = spawnSync(pm2, ['start', path.join(ROOT, 'ecosystem.config.js'), '--env', 'production'], {
    cwd: ROOT,
    shell: isWin,
    stdio: 'inherit',
  });
  if (pm2Proc.status === 0) {
    console.log(`${COLORS.pm2}[PM2   ] Started. Run 'pm2 logs' to view output.${RESET}`);
  } else {
    console.warn(`${COLORS.pm2}[PM2   ] pm2 start failed (exit ${pm2Proc.status}) — continuing without PM2.${RESET}`);
  }
} else {
  console.warn(`${COLORS.info}[INFO  ] pm2 not found — skipping PM2 service. Install with: npm install -g pm2${RESET}`);
}

// Graceful shutdown — kill both children on Ctrl+C
function shutdown() {
  console.log(`\n${COLORS.info}Shutting down...${RESET}`);
  backend.kill();
  frontend.kill();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
