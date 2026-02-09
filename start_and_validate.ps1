$ErrorActionPreference = "Stop"

if (!(Test-Path .\docker-compose.yml)) { throw "Rode na pasta onde está o docker-compose.yml." }
if (!(Test-Path .\data\partners_demo.csv)) { throw "Arquivo .\data\partners_demo.csv não encontrado." }

docker compose up -d --build | Out-Host

$backendCid = (docker compose ps -q backend).Trim()
if (-not $backendCid) { throw "Não encontrei o serviço 'backend'. Confira o nome no docker-compose.yml." }

$healthUrl = "http://localhost:3000/health"
$deadline  = (Get-Date).AddSeconds(60)
$code = ""
do {
  try {
    $code = curl.exe -s -o NUL -w "%{http_code}" $healthUrl
    if ($code -eq "200") { break }
  } catch {}
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

if ($code -ne "200") { throw "Backend não ficou UP em $healthUrl (último status: $code)" }
Write-Host "OK: backend UP" -ForegroundColor Green

docker exec $backendCid sh -lc "test -f /app/data/partners_demo.csv && echo 'OK: /app/data/partners_demo.csv' || (echo 'ERRO: CSV nao montado em /app/data' && exit 1)" | Out-Host

$importUrl  = "http://localhost:3000/admin/import/partners"
$importJson = curl.exe -s -X POST $importUrl
$import     = $importJson | ConvertFrom-Json

Write-Host ("IMPORT: inserted={0} updated={1} skipped={2} total={3} source={4} csvPath={5}" -f `
  $import.inserted,$import.updated,$import.skipped,$import.total,$import.source,$import.csvPath) -ForegroundColor Cyan

if ($import.errors -and $import.errors.Count -gt 0) {
  Write-Host "ERROS DO IMPORT:" -ForegroundColor Yellow
  $import.errors | ConvertTo-Json -Depth 6 | Write-Host
}

$partners = (curl.exe -s "http://localhost:3000/partners") | ConvertFrom-Json
Write-Host ("PARTNERS: {0} registros" -f $partners.Count) -ForegroundColor Green

$summary = (curl.exe -s "http://localhost:3000/partners/summary") | ConvertFrom-Json
Write-Host "SUMMARY:" -ForegroundColor Green
$summary | Format-Table -AutoSize
