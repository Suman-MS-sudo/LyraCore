@echo off
echo Starting LyraCore Backend...
cd /d %~dp0\backend
npx ts-node src/index.ts
