# run_all.ps1 - Full pipeline: tests, scrape, deploy, verify, git
# Usage: .\run_all.ps1  or  .\run_all.ps1 -NoPrompt

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
Push-Location $projectRoot

Write-Host ""
Write-Host "=== WebtopKids - Full Pipeline ===" -ForegroundColor Cyan
Write-Host ""

# 1. Logic tests
Write-Host "[1/5] Notification tests..." -ForegroundColor Yellow
$r1 = & node test_notifications.mjs 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "  X Failed" -ForegroundColor Red
  Pop-Location
  exit 1
}
Write-Host "  OK" -ForegroundColor Green

# 2. Scrape + push
Write-Host "[2/5] Scrape and push to VPS..." -ForegroundColor Yellow
$r2 = & node scrape_and_push.mjs 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "  X Failed" -ForegroundColor Red
  Pop-Location
  exit 1
}
Write-Host "  OK" -ForegroundColor Green

# 3. Deploy
Write-Host "[3/5] Deploy to VPS..." -ForegroundColor Yellow
$r3 = & .\deploy.ps1 -NoPrompt 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "  X Failed" -ForegroundColor Red
  Pop-Location
  exit 1
}
Write-Host "  OK" -ForegroundColor Green

# 4. Verify API
Write-Host "[4/5] Verify server..." -ForegroundColor Yellow
$r4 = & node test_check.mjs 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "  X Failed" -ForegroundColor Red
  Pop-Location
  exit 1
}
Write-Host "  OK" -ForegroundColor Green

# 5. Git (with -NoPrompt: auto commit+push)
$noPrompt = $args -contains "-NoPrompt"
Write-Host "[5/5] Git..." -ForegroundColor Yellow
$status = git status --short 2>&1
if ($status) {
  if ($noPrompt) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm"
    git add -A
    git commit -m "deploy: $ts"
    git push
    Write-Host "  OK Pushed" -ForegroundColor Green
  } else {
    $msg = Read-Host "  Changes detected. Commit + Push? (Y/N)"
    if ($msg -match "^[yY]") {
      git add -A
      $cm = Read-Host "  Commit message (Enter=default)"
      if ([string]::IsNullOrWhiteSpace($cm)) {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm"
        $cm = "deploy: $ts"
      }
      git commit -m $cm
      git push
      Write-Host "  OK Pushed" -ForegroundColor Green
    }
  }
} else {
  Write-Host "  No changes" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Done - http://76.13.8.113:3001 ===" -ForegroundColor Green
Write-Host ""
Pop-Location
