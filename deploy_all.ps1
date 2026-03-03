# WebtopKids - Full deploy script
# Usage: .\deploy_all.ps1
# Run from: project folder (Webtop_APP)

param(
  [string]$Server = "root@76.13.8.113",
  [string]$RemotePath = "/srv/webtop",
  [switch]$SkipGit,
  [switch]$PushDataFirst
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$tempTar = Join-Path $env:TEMP "webtop_deploy_$(Get-Date -Format 'yyyyMMdd_HHmmss').tar"
$dashboardUrl = "http://76.13.8.113:3001"

function Step { param($n, $msg) Write-Host "`n[$n/7] $msg" -ForegroundColor Cyan }
function Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Fail { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red; throw $msg }
function Info { param($msg) Write-Host "  $msg" -ForegroundColor Gray }

Write-Host "`n=== WebtopKids Deploy ===" -ForegroundColor DarkCyan

try {
  Step 1 "Testing SSH connection to $Server..."
  $null = ssh -o ConnectTimeout=5 -o BatchMode=yes $Server "echo OK" 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "SSH connection failed - check key/password" }
  Ok "Connected"

  if ($PushDataFirst) {
    Info "Pushing fresh data (push_scrape)..."
    $pushScript = Join-Path $projectRoot "push_scrape.mjs"
    if (Test-Path $pushScript) {
      Push-Location $projectRoot
      & node $pushScript 2>&1 | Out-Null
      Pop-Location
      Ok "Data pushed"
    }
  }

  Step 2 "Creating archive and uploading..."
  Remove-Item $tempTar -ErrorAction SilentlyContinue
  Push-Location $projectRoot
  & tar -cf $tempTar --exclude=node_modules --exclude=.git --exclude=.env --exclude="*.env" --exclude=homework_status.json --exclude=.webtop_session.json --exclude=.cursor --exclude=.webtop_profile --exclude=data_cache.json --exclude=sent_reminders.json --exclude=nul --exclude=push_scrape.log --exclude=daemon.log --exclude="*.log" .
  Pop-Location
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempTar)) { Fail "Archive creation failed" }
  Ok "Archive: $([math]::Round((Get-Item $tempTar).Length/1KB)) KB"

  & scp $tempTar "${Server}:${RemotePath}/webtop_deploy.tar"
  if ($LASTEXITCODE -ne 0) { Fail "Upload failed" }
  Ok "Files uploaded"

  Step 3 "Server status before update..."
  $statusBefore = ssh $Server 'pm2 describe webtop 2>/dev/null | head -5'
  Info $statusBefore

  Step 4 "Syncing - stop, extract, install, start..."
  $sshCmd = "cd $RemotePath && pm2 stop webtop 2>/dev/null; tar -xf webtop_deploy.tar && rm -f webtop_deploy.tar && npm install --production && (pm2 start webtop 2>/dev/null || pm2 start server.js --name webtop) && pm2 save"
  ssh $Server $sshCmd
  if ($LASTEXITCODE -ne 0) { Fail "Sync failed" }
  Ok "Sync done"

  Step 5 "Verifying server is up..."
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-WebRequest -Uri "$dashboardUrl/api/data" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    Ok "Server responded (HTTP $($r.StatusCode))"
  } catch {
    try {
      $r = Invoke-WebRequest -Uri $dashboardUrl -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
      Ok "Dashboard available: $dashboardUrl"
    } catch {
      Info "Could not verify - check server manually"
    }
  }

  Step 6 "Final status..."
  $statusAfter = ssh $Server "pm2 list | grep -E 'webtop|online'"
  Info $statusAfter
  Ok "Server running"

  Step 7 "Git push..."
  Write-Host ""
  $doGit = if ($SkipGit) { "N" } else { Read-Host "Do you want to push to Git? (Y/N)" }
  if ($doGit -notmatch '^[yY]') {
    Info "Skipping Git. Deploy complete."
  } else {
    Push-Location $projectRoot
    $changes = git status --short 2>$null
    if ($changes) {
      $msg = Read-Host "Enter commit message (Enter = default)"
      if ([string]::IsNullOrWhiteSpace($msg)) { $msg = "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
      git add -A
      git commit -m $msg
      git push
      Ok "Pushed to Git"
    } else {
      Info "No changes to push"
    }
    Pop-Location
  }

  Write-Host "`n=== Deploy completed successfully ===" -ForegroundColor Green
  Write-Host "  Dashboard: $dashboardUrl`n" -ForegroundColor White

} catch {
  Write-Host "`n[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Remove-Item $tempTar -Force -ErrorAction SilentlyContinue
}
