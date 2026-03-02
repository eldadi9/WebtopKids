# Deploy Webtop to VPS - uses Windows SSH (same as: ssh root@76.13.8.113)
# Usage: .\deploy.ps1
# Or: .\deploy.ps1 -Server root@76.13.8.113 -RemotePath /root/WebtopKids

param(
  [string]$Server = "root@76.13.8.113",
  [string]$RemotePath = "/srv/webtop"
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$tempTar = Join-Path $env:TEMP "webtop_deploy.tar"

try {
  Write-Host "Creating archive (excluding node_modules, .env, .git, nul)..." -ForegroundColor Cyan
  Remove-Item $tempTar -ErrorAction SilentlyContinue
  try {
    Push-Location $projectRoot
    & tar -cf $tempTar --exclude=node_modules --exclude=.git --exclude=.env --exclude="*.env" --exclude=homework_status.json --exclude=.webtop_session.json --exclude=.cursor --exclude=.webtop_profile --exclude=data_cache.json --exclude=sent_reminders.json --exclude=nul --exclude=push_scrape.log --exclude=daemon.log --exclude="*.log" .
    if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
    if (-not (Test-Path $tempTar)) { throw "tar did not create archive" }
  } finally { Pop-Location -ErrorAction SilentlyContinue }

  Write-Host "Uploading to ${Server}:${RemotePath} ..." -ForegroundColor Cyan
  & scp $tempTar "${Server}:${RemotePath}/webtop_deploy.tar"
  if ($LASTEXITCODE -ne 0) { throw "scp failed" }

  Write-Host "Installing and restarting PM2 on server..." -ForegroundColor Cyan
  $cmd = "cd $RemotePath && tar -xf webtop_deploy.tar && rm -f webtop_deploy.tar && npm install --production && (pm2 restart webtop --update-env 2>/dev/null || pm2 start server.js --name webtop) && pm2 save"
  & ssh $Server $cmd
  if ($LASTEXITCODE -ne 0) { throw "ssh command failed" }

  Write-Host "`nDeployed successfully!" -ForegroundColor Green
  Write-Host "   Dashboard: http://76.13.8.113:3001" -ForegroundColor Gray
} finally {
  Remove-Item $tempTar -Force -ErrorAction SilentlyContinue
}
