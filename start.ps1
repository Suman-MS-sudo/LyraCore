# LyraCore — Start everything (Backend + Frontend + PM2)
# Double-click this file or run:  powershell -ExecutionPolicy Bypass -File start.ps1

Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  ██╗  ██╗   ██╗██████╗  █████╗  ██████╗ ██████╗ ██████╗ ███████╗" -ForegroundColor Cyan
Write-Host "  ██║  ╚██╗ ██╔╝██╔══██╗██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝" -ForegroundColor Cyan
Write-Host "  ██║   ╚████╔╝ ██████╔╝███████║██║     ██║   ██║██████╔╝█████╗  " -ForegroundColor Cyan
Write-Host "  ██║    ╚██╔╝  ██╔══██╗██╔══██║██║     ██║   ██║██╔══██╗██╔══╝  " -ForegroundColor Cyan
Write-Host "  ███████╗██║   ██║  ██║██║  ██║╚██████╗╚██████╔╝██║  ██║███████╗" -ForegroundColor Cyan
Write-Host "  ╚══════╝╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Starting LyraCore..." -ForegroundColor Yellow
Write-Host "  Backend   → http://localhost:5000" -ForegroundColor Gray
Write-Host "  Frontend  → http://localhost:5173" -ForegroundColor Gray
Write-Host ""

# ── 1. Backend (new window) ───────────────────────────────────────────────────
Write-Host "  [1/3] Starting Backend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command',
  'cd e:\LyraCore\backend; Write-Host "[BACKEND] Starting..." -ForegroundColor Cyan; npm run dev' `
  -WindowStyle Normal

Start-Sleep -Seconds 2

# ── 2. Frontend (new window) ──────────────────────────────────────────────────
Write-Host "  [2/3] Starting Frontend..." -ForegroundColor Magenta
Start-Process powershell -ArgumentList '-NoExit', '-Command',
  'cd e:\LyraCore\frontend; Write-Host "[FRONTEND] Starting..." -ForegroundColor Magenta; npm run dev' `
  -WindowStyle Normal

Start-Sleep -Seconds 2

# ── 3. PM2 (in current window) ───────────────────────────────────────────────
Write-Host "  [3/3] Starting PM2..." -ForegroundColor Green
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2) {
  pm2 start ecosystem.config.js --env production
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  [PM2] Started. Run 'pm2 logs' to view output." -ForegroundColor Green
  } else {
    Write-Host "  [PM2] pm2 start failed — continuing without PM2." -ForegroundColor Yellow
  }
} else {
  Write-Host "  [PM2] pm2 not found — skipping. Install with: npm install -g pm2" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  ✔  LyraCore is running!" -ForegroundColor Green
Write-Host "     Open http://localhost:5173 in your browser." -ForegroundColor White
Write-Host ""
Read-Host "  Press Enter to exit this launcher"
