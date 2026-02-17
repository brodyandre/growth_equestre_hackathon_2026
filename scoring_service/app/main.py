from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel

"""
PT-BR: Servico FastAPI para calcular score de leads com base em perfil e eventos.
ES: Servicio FastAPI para calcular el score de leads segun perfil y eventos.
EN: FastAPI service to compute lead scores from profile and event signals.
"""

app = FastAPI(title="Scoring Service (MVP)", version="2.0.0")


class Event(BaseModel):
    """
    PT-BR: Evento de comportamento capturado no funil.
    ES: Evento de comportamiento capturado en el embudo.
    EN: Behavioral event captured in the funnel.
    """

    event_type: str
    ts: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class Lead(BaseModel):
    """
    PT-BR: Dados principais do lead usados na qualificacao.
    ES: Datos principales del lead usados en la calificacion.
    EN: Core lead attributes used for qualification.
    """

    id: str
    nome: str
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    uf: Optional[str] = None
    cidade: Optional[str] = None
    segmento_interesse: str
    orcamento_faixa: Optional[str] = None
    prazo_compra: Optional[str] = None


class ScoreRequest(BaseModel):
    """
    PT-BR: Payload do endpoint /score com lead e eventos recentes.
    ES: Payload del endpoint /score con lead y eventos recientes.
    EN: /score payload with the lead and recent events.
    """

    lead: Lead
    events: List[Event] = []


FEATURE_COLUMNS = [
    "uf",
    "cidade",
    "segmento_interesse",
    "orcamento_faixa",
    "prazo_compra",
    "n_events",
    "n_page_view",
    "n_hook_complete",
    "n_cta_click",
    "recency_last_event_hours",
]

# Paths default dentro do container (montados via volume ./data -> /app/data).
DEFAULT_MODEL_PATH = "/app/data/ml/artifacts/lead_scoring_best_model.joblib"
DEFAULT_RUNNER_UP_MODEL_PATH = "/app/data/ml/artifacts/lead_scoring_runner_up_model.joblib"


def _safe_iso_to_dt(value: Optional[str]) -> Optional[datetime]:
    """Parse robusto de timestamp ISO, retornando timezone UTC quando ausente."""
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _extract_event_features(events: List[Event]) -> Dict[str, float]:
    """
    Converte lista de eventos em features numéricas usadas pelo modelo.

    Saída alinhada com o script de treino:
    - volume de eventos
    - contagens por tipo
    - recência do último evento (em horas)
    """
    items = events or []
    event_types = [str(e.event_type or "").strip().lower() for e in items]
    timestamps = [_safe_iso_to_dt(e.ts) for e in items]
    timestamps = [ts for ts in timestamps if ts is not None]

    recency_hours = 9999.0
    if timestamps:
        # Recência menor indica evento mais recente (sinal típico de maior intenção).
        latest = max(timestamps)
        now = datetime.now(timezone.utc)
        recency_hours = max(0.0, (now - latest).total_seconds() / 3600.0)

    return {
        "n_events": float(len(items)),
        "n_page_view": float(sum(1 for e in event_types if e == "page_view")),
        "n_hook_complete": float(sum(1 for e in event_types if e == "hook_complete")),
        "n_cta_click": float(sum(1 for e in event_types if e in {"cta_click", "whatsapp_click"})),
        "recency_last_event_hours": float(recency_hours),
    }


def _build_feature_row(lead: Lead, events: List[Event]) -> Dict[str, Any]:
    """Monta uma linha tabular de features para inferência do pipeline sklearn."""
    event_features = _extract_event_features(events)
    return {
        "uf": str(lead.uf or "").strip().upper(),
        "cidade": str(lead.cidade or "").strip(),
        "segmento_interesse": str(lead.segmento_interesse or "").strip().upper(),
        "orcamento_faixa": str(lead.orcamento_faixa or "").strip(),
        "prazo_compra": str(lead.prazo_compra or "").strip(),
        **event_features,
    }


def _score_to_status(score: int) -> str:
    """Mapeia score numérico para status comercial padronizado."""
    if score >= 70:
        return "QUALIFICADO"
    if score >= 40:
        return "AQUECENDO"
    return "CURIOSO"


def _budget_points(budget: Optional[str]) -> int:
    """Heurística legado: pontos por faixa de orçamento."""
    if not budget:
        return 0
    b = budget.lower().strip()
    if "60" in b or "+" in b:
        return 30
    if "20" in b or "30" in b or "40" in b or "50" in b:
        return 20
    if "5" in b or "10" in b:
        return 10
    return 5


def _prazo_points(prazo: Optional[str]) -> int:
    """Heurística legado: pontos por urgência/prazo de compra."""
    if not prazo:
        return 0
    p = prazo.lower().strip()
    if "7" in p or "imediat" in p:
        return 20
    if "30" in p:
        return 12
    if "90" in p:
        return 6
    return 4


def _baseline_score(lead: Lead, events: List[Event]) -> Tuple[int, str, List[Dict[str, Any]]]:
    """
    Fallback por regras (motor original).

    Este bloco garante continuidade de operação quando:
    - artefatos ML não existem
    - modelo falha na inferência em tempo de execução
    """
    etypes = [str(e.event_type or "").strip().lower() for e in (events or [])]
    motivos: List[Dict[str, Any]] = []
    score = 0

    bp = _budget_points(lead.orcamento_faixa)
    if bp:
        score += bp
        motivos.append({"fator": "Orcamento", "impacto": bp, "detalhe": lead.orcamento_faixa})

    pp = _prazo_points(lead.prazo_compra)
    if pp:
        score += pp
        motivos.append({"fator": "Prazo", "impacto": pp, "detalhe": lead.prazo_compra})

    if "hook_complete" in etypes:
        score += 15
        motivos.append({"fator": "Completou o hook (quiz/calculadora)", "impacto": 15})

    if "cta_click" in etypes or "whatsapp_click" in etypes:
        score += 20
        motivos.append({"fator": "Clique em CTA/WhatsApp", "impacto": 20})

    if etypes.count("page_view") >= 3:
        score += 10
        motivos.append({"fator": "Alta navegacao (>=3 paginas)", "impacto": 10})

    if lead.uf and str(lead.uf).upper() in {"MG", "SP", "GO"}:
        score += 5
        motivos.append({"fator": "Regiao foco (MG/SP/GO)", "impacto": 5})

    score = max(0, min(100, int(round(score))))
    return score, _score_to_status(score), motivos


def _build_ml_motivos(model_name: str, probability: float, lead: Lead, events: List[Event]) -> List[Dict[str, Any]]:
    """
    Gera justificativas legíveis para UI (sem expor detalhes internos do pipeline).
    """
    features = _extract_event_features(events)
    score = int(round(max(0.0, min(1.0, probability)) * 100))
    motivos: List[Dict[str, Any]] = [
        {
            "fator": "Modelo ML",
            "impacto": score - 50,
            "detalhe": f"{model_name}: probabilidade prevista de qualificacao = {score}%",
        }
    ]

    if features["n_hook_complete"] > 0:
        motivos.append({"fator": "Hook concluido", "impacto": 12, "detalhe": "Sinal forte de intencao"})
    if features["n_cta_click"] > 0:
        motivos.append({"fator": "CTA/WhatsApp", "impacto": 14, "detalhe": "Lead demonstrou interesse ativo"})
    if features["n_page_view"] >= 3:
        motivos.append({"fator": "Navegacao", "impacto": 8, "detalhe": "Engajamento consistente no funil"})
    if lead.uf and str(lead.uf).upper() in {"MG", "SP", "GO"}:
        motivos.append({"fator": "Regiao foco", "impacto": 4, "detalhe": "Lead em territorio prioritario"})
    if lead.orcamento_faixa:
        motivos.append({"fator": "Orcamento informado", "impacto": 6, "detalhe": str(lead.orcamento_faixa)})
    return motivos[:5]


def _load_model(path_value: str):
    """Tenta carregar artefato .joblib e devolve também um status textual para /health."""
    path = Path(path_value)
    if not path.exists():
        return None, f"missing:{path}"
    try:
        return joblib.load(path), f"loaded:{path}"
    except Exception as exc:
        return None, f"error:{path}:{exc}"


MODEL_PATH = os.environ.get("SCORING_MODEL_PATH", DEFAULT_MODEL_PATH)
RUNNER_UP_MODEL_PATH = os.environ.get("SCORING_RUNNER_UP_MODEL_PATH", DEFAULT_RUNNER_UP_MODEL_PATH)

# Carregamento no startup: evita overhead de I/O em toda requisição.
BEST_MODEL, BEST_MODEL_STATUS = _load_model(MODEL_PATH)
RUNNER_UP_MODEL, RUNNER_UP_MODEL_STATUS = _load_model(RUNNER_UP_MODEL_PATH)


def _predict_ml(lead: Lead, events: List[Event], feature_row: Dict[str, Any]):
    """
    Inference com estratégia champion/challenger.

    Ordem:
    1) best_model (campeão)
    2) runner_up_model (fallback técnico de ML)
    3) None (deixa caller cair no fallback por regras)
    """
    # Frame com ordem de colunas fixa para manter compatibilidade com o pipeline salvo.
    frame = pd.DataFrame([feature_row], columns=FEATURE_COLUMNS)

    # Tentativa 1: campeão.
    if BEST_MODEL is not None:
        try:
            proba = float(BEST_MODEL.predict_proba(frame)[0][1])
            proba = max(0.0, min(1.0, proba))
            score = int(round(proba * 100))
            return {
                "score": score,
                "status": _score_to_status(score),
                "motivos": _build_ml_motivos("best_model", proba, lead, events),
                "meta": {
                    "engine": "ml",
                    "model_name": "best_model",
                    "probability_qualified": round(proba, 6),
                },
            }
        except Exception as exc:
            print(f"[score] best model inference failed: {exc}")

    # Tentativa 2: vice-campeão.
    if RUNNER_UP_MODEL is not None:
        try:
            proba = float(RUNNER_UP_MODEL.predict_proba(frame)[0][1])
            proba = max(0.0, min(1.0, proba))
            score = int(round(proba * 100))
            return {
                "score": score,
                "status": _score_to_status(score),
                "motivos": _build_ml_motivos("runner_up_model", proba, lead, events),
                "meta": {
                    "engine": "ml",
                    "model_name": "runner_up_model",
                    "probability_qualified": round(proba, 6),
                },
            }
        except Exception as exc:
            print(f"[score] runner-up model inference failed: {exc}")

    return None


@app.get("/health")
def health():
    """
    PT-BR: Endpoint de saude para observabilidade basica.
    ES: Endpoint de salud para observabilidad basica.
    EN: Health endpoint for basic observability.
    """

    return {
        "status": "UP",
        "ml": {
            # Exibe status detalhado para facilitar diagnóstico de deploy/paths.
            "best_model": BEST_MODEL_STATUS,
            "runner_up_model": RUNNER_UP_MODEL_STATUS,
            "enabled": bool(BEST_MODEL is not None or RUNNER_UP_MODEL is not None),
        },
    }


@app.post("/score")
def score(req: ScoreRequest):
    """
    PT-BR: Calcula score final (0-100), classifica status e explica motivos.
           Usa modelo ML se artefatos estiverem disponiveis; caso contrario, fallback por regras.
    ES: Calcula score final (0-100), clasifica estado y explica motivos.
        Usa modelo ML si hay artefactos; si no, fallback por reglas.
    EN: Computes score (0-100), status, and reasons.
        Uses ML model when artifacts are available; otherwise rule-based fallback.
    """

    lead = req.lead
    events = req.events or []
    # Extração determinística de features para qualquer motor (ML ou regras).
    features = _build_feature_row(lead, events)

    # Caminho principal: inferência por ML.
    ml_result = _predict_ml(lead, events, features)
    if ml_result is not None:
        return ml_result

    # Caminho de segurança: fallback por regras para manter endpoint sempre disponível.
    fallback_score, fallback_status, fallback_motivos = _baseline_score(lead, events)
    return {
        "score": fallback_score,
        "status": fallback_status,
        "motivos": fallback_motivos,
        "meta": {"engine": "rules"},
    }
