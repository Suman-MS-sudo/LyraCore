#!/usr/bin/env node
/**
 * LyraCore — single start script (Windows & Linux)
 * Usage:  node start.js
 */

const { spawn } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';
const npx   = isWin ? 'npx.cmd' : 'npx';
const npm   = isWin ? 'npm.cmd' : 'npm';

const ROOT     = __dirname;
const BACKEND  = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');

const RESET  = '\x1b[0m';
const COLORS = { backend: '\x1b[36m', frontend: '\x1b[35m', info: '\x1b[33m' };

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
console.log(`${COLORS.info}   Frontend → https://localhost${RESET}\n`);

const backend  = run('backend',  npx,  ['ts-node', 'src/index.ts'], BACKEND);
const frontend = run('frontend', npm,  ['run', 'dev'],               FRONTEND);

// Graceful shutdown — kill both children on Ctrl+C
function shutdown() {
  console.log(`\n${COLORS.info}Shutting down...${RESET}`);
  backend.kill();
  frontend.kill();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
