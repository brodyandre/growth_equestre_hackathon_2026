from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

app = FastAPI(title="Scoring Service (MVP)", version="1.0.0")

class Event(BaseModel):
    event_type: str
    ts: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class Lead(BaseModel):
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
    lead: Lead
    events: List[Event] = []

@app.get("/health")
def health():
    return {"status": "UP"}

def _budget_points(budget: Optional[str]) -> int:
    if not budget: return 0
    b = budget.lower().strip()
    if "60" in b or "+" in b: return 30
    if "20" in b or "30" in b or "40" in b or "50" in b: return 20
    if "5" in b or "10" in b: return 10
    return 5

def _prazo_points(prazo: Optional[str]) -> int:
    if not prazo: return 0
    p = prazo.lower().strip()
    if "7" in p or "imediat" in p: return 20
    if "30" in p: return 12
    if "90" in p: return 6
    return 4

@app.post("/score")
def score(req: ScoreRequest):
    lead = req.lead
    events = req.events or []
    etypes = [e.event_type for e in events]

    motivos = []
    score = 0

    bp = _budget_points(lead.orcamento_faixa)
    if bp:
        score += bp
        motivos.append({"fator":"Orçamento","impacto":bp,"detalhe":lead.orcamento_faixa})

    pp = _prazo_points(lead.prazo_compra)
    if pp:
        score += pp
        motivos.append({"fator":"Prazo","impacto":pp,"detalhe":lead.prazo_compra})

    if "hook_complete" in etypes:
        score += 15
        motivos.append({"fator":"Completou o hook (quiz/calculadora)","impacto":15})

    if "cta_click" in etypes or "whatsapp_click" in etypes:
        score += 20
        motivos.append({"fator":"Clique em CTA/WhatsApp","impacto":20})

    if etypes.count("page_view") >= 3:
        score += 10
        motivos.append({"fator":"Alta navegação (>=3 páginas)","impacto":10})

    if lead.uf and lead.uf.upper() in {"MG","SP","GO"}:
        score += 5
        motivos.append({"fator":"Região foco (MG/SP/GO)","impacto":5})

    score = max(0, min(100, score))
    status = "CURIOSO"
    if score >= 70: status = "QUALIFICADO"
    elif score >= 40: status = "AQUECENDO"
    return {"score": score, "status": status, "motivos": motivos}
