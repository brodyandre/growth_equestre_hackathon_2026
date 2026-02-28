param(
  [int]$ExpectedLeads = 3000,
  [switch]$IgnoreExpectedMismatch,
  [string]$DbService = "db",
  [string]$DbUser = "app",
  [string]$DbName = "appdb",
  [string]$BackendUrl = "http://localhost:3000",
  [string]$DatasetPath = "data/ml/lead_scoring_dataset.csv",
  [string]$ArtifactsDir = "data/ml/artifacts",
  [switch]$SkipBackfill,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $repoRoot

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-PythonExecutable {
  $venvPy = Join-Path $repoRoot ".venv\Scripts\python.exe"
  if (Test-Path $venvPy) { return $venvPy }
  return "python"
}

function Invoke-OrDryRun([string]$Label, [scriptblock]$Action) {
  Write-Step $Label
  if ($DryRun) {
    Write-Host "DryRun ativo: etapa nao executada." -ForegroundColor Yellow
    return
  }
  & $Action
}

try {
  Write-Host "Repositorio: $repoRoot"
  if ($DryRun) {
    Write-Host "Modo: DRY RUN" -ForegroundColor Yellow
  }

  $pythonExe = Get-PythonExecutable
  Write-Host "Python: $pythonExe"

  $leadsTotal = $null
  if (-not $DryRun) {
    Write-Step "Lendo total de leads na API"
    $leadsTotal = [int](Invoke-RestMethod -Uri "$BackendUrl/leads/count" -TimeoutSec 20).total
    Write-Host "Total de leads na API: $leadsTotal"

    if ($ExpectedLeads -gt 0 -and $leadsTotal -ne $ExpectedLeads) {
      $msg = "Total atual ($leadsTotal) difere do esperado ($ExpectedLeads)."
      if ($IgnoreExpectedMismatch) {
        Write-Host "$msg Continuando por -IgnoreExpectedMismatch." -ForegroundColor Yellow
      } else {
        throw "$msg Use -IgnoreExpectedMismatch para continuar mesmo assim."
      }
    }
  }

  Invoke-OrDryRun "Extraindo dataset do Postgres para CSV" {
    $datasetDir = Split-Path -Parent $DatasetPath
    if ($datasetDir) {
      New-Item -ItemType Directory -Path $datasetDir -Force | Out-Null
    }

    $query = @'
\copy (
  WITH event_agg AS (
    SELECT
      lead_id,
      COUNT(*)::int AS n_events,
      COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS n_page_view,
      COUNT(*) FILTER (WHERE event_type = 'hook_complete')::int AS n_hook_complete,
      COUNT(*) FILTER (WHERE event_type IN ('cta_click', 'whatsapp_click'))::int AS n_cta_click,
      EXTRACT(EPOCH FROM (now() - MAX(ts))) / 3600.0 AS recency_last_event_hours
    FROM events
    GROUP BY lead_id
  )
  SELECT
    l.id AS lead_id,
    COALESCE(l.uf, '') AS uf,
    COALESCE(l.cidade, '') AS cidade,
    COALESCE(l.segmento_interesse, '') AS segmento_interesse,
    COALESCE(l.orcamento_faixa, '') AS orcamento_faixa,
    COALESCE(l.prazo_compra, '') AS prazo_compra,
    COALESCE(l.status, 'CURIOSO') AS status,
    COALESCE(e.n_events, 0) AS n_events,
    COALESCE(e.n_page_view, 0) AS n_page_view,
    COALESCE(e.n_hook_complete, 0) AS n_hook_complete,
    COALESCE(e.n_cta_click, 0) AS n_cta_click,
    COALESCE(e.recency_last_event_hours, 9999) AS recency_last_event_hours,
    CASE
      WHEN UPPER(COALESCE(l.status, '')) IN ('QUALIFICADO', 'ENVIADO') THEN 1
      ELSE 0
    END AS label_qualified
  FROM leads l
  LEFT JOIN event_agg e ON e.lead_id = l.id
) TO STDOUT WITH CSV HEADER
'@

    $csvContent = docker compose exec -T $DbService psql -U $DbUser -d $DbName -c $query
    $csvContent | Set-Content -Path $DatasetPath -Encoding UTF8
    Write-Host "Dataset salvo em: $DatasetPath"

    $lineCount = (Get-Content $DatasetPath | Measure-Object -Line).Lines
    Write-Host "Linhas do CSV (inclui cabecalho): $lineCount"
  }

  if (-not $DryRun) {
    $lineCount = (Get-Content $DatasetPath | Measure-Object -Line).Lines
    if ($lineCount -lt 2) {
      throw "CSV vazio ou invalido em $DatasetPath"
    }
    if ($null -ne $leadsTotal) {
      $expectedLines = $leadsTotal + 1
      if ($lineCount -ne $expectedLines) {
        Write-Host "Aviso: linhas do CSV ($lineCount) diferem do esperado ($expectedLines)." -ForegroundColor Yellow
      }
    }
  }

  Invoke-OrDryRun "Treinando modelos ML (best + runner-up + report)" {
    & $pythonExe "tools/ml/train_lead_scoring.py" --input-csv $DatasetPath --output-dir $ArtifactsDir
  }

  Invoke-OrDryRun "Publicando novo modelo no scoring service" {
    docker compose up -d --build scoring
  }

  Invoke-OrDryRun "Validando health e modelo vencedor" {
    $health = Invoke-RestMethod -Uri "http://localhost:8000/health" -TimeoutSec 20
    $modelInfo = Invoke-RestMethod -Uri "$BackendUrl/ml/model-info" -TimeoutSec 20
    Write-Host ("Health scoring: " + ($health | ConvertTo-Json -Compress))
    Write-Host ("Winner: " + ($modelInfo.winner.label))
    Write-Host ("Runner-up: " + ($modelInfo.runner_up.label))
  }

  if (-not $SkipBackfill) {
    Invoke-OrDryRun "Backfill de score em todos os leads" {
      & $pythonExe "tools/ml/backfill_lead_scores.py" --backend-url $BackendUrl
    }
  } else {
    Write-Host ""
    Write-Host "Backfill pulado por -SkipBackfill."
  }

  Write-Host ""
  Write-Host "Fluxo concluido." -ForegroundColor Green
  Write-Host "Dataset: $DatasetPath"
  Write-Host "Artefatos: $ArtifactsDir"
}
finally {
  Pop-Location
}
