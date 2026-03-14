# WebtopKids Deploy
# Usage: .\deploy.ps1  or  .\deploy.ps1 -NoPrompt

param(
  [string]$Server = "root@76.13.8.113",
  [string]$RemotePath = "/root/webtop",
  [switch]$NoPrompt
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$tempTar = Join-Path $env:TEMP "webtop_deploy.tar"
$dashboardUrl = "http://76.13.8.113:3001"

function Step { param($n, $msg) Write-Host ""; Write-Host "[$n/6] $msg" -ForegroundColor Cyan }
function Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Fail { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red; throw $msg }
function Info { param($msg) Write-Host "  $msg" -ForegroundColor Gray }

Write-Host ""
Write-Host "=== WebtopKids - Deploy ===" -ForegroundColor DarkCyan

$pushFirst = $false
if (-not $NoPrompt) {
  Write-Host ""
  $r = Read-Host "Pull data before deploy? (Y/N)"
  if ($r -match '^[yY]') { $pushFirst = $true }
}

if ($pushFirst) {
  Step 0 "Pulling data..."
  try {
    Set-Location $projectRoot
    $out = & node webtop_scrape.mjs 2>&1
    $txt = if ($out -is [array]) { $out -join [Environment]::NewLine } else { [string]$out }
    $data = $txt | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($data -and $data.ok) {
      $sec = "webtop2026"
      if (Test-Path ".env") {
        Get-Content ".env" | ForEach-Object {
          if ($_ -match 'PUSH_SECRET\s*=\s*(.+)') { $sec = $Matches[1].Trim().Trim('"').Trim("'") }
        }
      }
      $body = @{ secret = $sec; data = $data } | ConvertTo-Json -Depth 25 -Compress
      Invoke-RestMethod -Uri ($dashboardUrl + "/api/push") -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType "application/json; charset=utf-8" -TimeoutSec 30 | Out-Null
      Ok "Data pushed"
    }
  }
  catch {
    Info "Error: $($_.Exception.Message)"
  }
  Pop-Location -ErrorAction SilentlyContinue
}

Step 1 "Testing SSH..."
$testResult = ssh -o ConnectTimeout=5 -o BatchMode=yes $Server "echo OK" 2>&1
if ($LASTEXITCODE -ne 0) { Fail "SSH connection failed" }
Ok "Connected"

Step 2 "Creating archive and uploading..."
Remove-Item $tempTar -ErrorAction SilentlyContinue
Push-Location $projectRoot
& tar -cf $tempTar --exclude=node_modules --exclude=.git --exclude=.env --exclude="*.env" --exclude=homework_status.json --exclude=.webtop_session.json --exclude=.cursor --exclude=.webtop_profile --exclude=data_cache.json --exclude=sent_reminders.json --exclude=children_config.json --exclude=nul --exclude="*.log" .
Pop-Location
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempTar)) { Fail "Archive failed" }
Ok "Archive created"

& scp $tempTar "${Server}:${RemotePath}/webtop_deploy.tar"
if ($LASTEXITCODE -ne 0) { Fail "Upload failed" }
Ok "Uploaded"

Step 3 "Installing on server..."
$remoteCmd = "cd $RemotePath" + " && pm2 stop webtop 2>/dev/null; tar -xf webtop_deploy.tar && rm -f webtop_deploy.tar && npm install --omit=dev && (pm2 restart webtop 2>/dev/null || pm2 start server.js --name webtop) && pm2 save"
ssh $Server $remoteCmd
if ($LASTEXITCODE -ne 0) { Fail "Server sync failed" }
Ok "Server updated"

Step 4 "Verifying..."
Start-Sleep -Seconds 3
try {
  Invoke-WebRequest -Uri ($dashboardUrl + "/api/data") -TimeoutSec 10 -UseBasicParsing | Out-Null
  Ok "Server responding"
}
catch {
  Info "Could not verify"
}

$doGit = $false
if (-not $NoPrompt) {
  Write-Host ""
  $r = Read-Host "Push to Git? (Y/N)"
  if ($r -match '^[yY]') { $doGit = $true }
}

if ($doGit) {
  Step 5 "Pushing to Git..."
  Push-Location $projectRoot
  $ch = git status --short 2>&1
  if ($ch) {
    $msg = Read-Host "Commit message (Enter=default)"
    if ([string]::IsNullOrWhiteSpace($msg)) { $msg = "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
    git add -A
    git commit -m $msg
    git push
    Ok "Pushed"
  }
  Pop-Location
}
else {
  Step 5 "Skipping Git"
}

Write-Host ""
Write-Host "=== Deploy complete ===" -ForegroundColor Green
Write-Host "   $dashboardUrl" -ForegroundColor White
Write-Host ""
Remove-Item $tempTar -Force -ErrorAction SilentlyContinue
