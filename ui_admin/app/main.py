# -*- coding: utf-8 -*-
"""
PT-BR: Painel administrativo Streamlit do Growth Equestre (MVP) para acompanhar leads,
       scoring e operação de CRM de forma simples e demonstrável (hackathon).
ES:    Panel administrativo en Streamlit de Growth Equestre (MVP) para monitorear leads,
       scoring y operación de CRM de forma simple y demostrable (hackathon).
EN:    Growth Equestre (MVP) Streamlit admin panel to monitor leads, scoring, and CRM
       operations in a simple, demo-friendly way (hackathon).
"""

import os
import base64
import requests
import streamlit as st
import json
import html
import unicodedata
from io import StringIO
from pathlib import Path

try:
    import pandas as pd
except Exception:
    # PT-BR: Fallback — se o pandas não estiver disponível, usamos tabelas simples do Streamlit.
    # ES:    Fallback — si pandas no está disponible, usamos tablas simples de Streamlit.
    # EN:    Fallback — if pandas is not available, we use Streamlit’s simple tables.
    pd = None

# PT-BR: URL base do backend (Node/Express). Pode ser sobrescrita via variável de ambiente.
# ES:    URL base del backend (Node/Express). Puede sobrescribirse con variable de entorno.
# EN:    Backend base URL (Node/Express). Can be overridden via environment variable.
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")


# =============================================================================
# UI CONFIG
# =============================================================================
# PT-BR: Configuração global do app Streamlit (título, layout e estado inicial do sidebar).
# ES:    Configuración global de la app Streamlit (título, layout y estado inicial del sidebar).
# EN:    Global Streamlit app configuration (title, layout, sidebar initial state).
st.set_page_config(
    page_title="Growth Equestre (MVP) — Admin",
    layout="wide",
    initial_sidebar_state="expanded",
)


# =============================================================================
# HELPERS (HTTP + UI)
# =============================================================================
def safe_get(path, params=None, timeout=15):
    """
    PT-BR: Executa um GET no backend com tratamento seguro de erro e retorno padronizado.
           Retorna (json, None) em sucesso ou (None, mensagem_erro) em falha.
    ES:    Ejecuta un GET en el backend con manejo seguro de errores y retorno estandarizado.
           Devuelve (json, None) si hay éxito o (None, mensaje_error) si falla.
    EN:    Performs a backend GET with safe error handling and standardized return.
           Returns (json, None) on success or (None, error_message) on failure.
    """
    try:
        r = requests.get(f"{BACKEND_URL}{path}", params=params, timeout=timeout)
        r.raise_for_status()
        return r.json(), None
    except Exception as e:
        return None, str(e)


def safe_post(path, payload=None, timeout=15):
    """
    PT-BR: Executa um POST no backend e, em caso de erro, tenta anexar o body da resposta
           para facilitar debug (quando disponível).
    ES:    Ejecuta un POST en el backend y, en caso de error, intenta adjuntar el body
           de la respuesta para facilitar el debug (cuando esté disponible).
    EN:    Performs a backend POST and, on failures, tries to attach the response body
           to help debugging (when available).
    """
    r = None
    try:
        r = requests.post(f"{BACKEND_URL}{path}", json=payload, timeout=timeout)
        r.raise_for_status()
        return r.json(), None
    except Exception as e:
        try:
            body = (r.text or "").strip() if r is not None else ""
            return None, f"{e} | body={body}"
        except Exception:
            return None, str(e)


def show_error(user_msg, debug_msg=None):
    """
    PT-BR: Exibe erro amigável ao usuário e (opcionalmente) detalhes técnicos quando
           o modo debug estiver ligado.
    ES:    Muestra un error amigable al usuario y (opcionalmente) detalles técnicos
           cuando el modo debug esté activado.
    EN:    Displays a user-friendly error and (optionally) technical details when
           debug mode is enabled.
    """
    st.error(user_msg)
    if st.session_state.get("debug_mode") and debug_msg:
        with st.expander("Detalhes técnicos (debug)", expanded=False):
            st.code(debug_msg)


def sanitize_text(v):
    """
    PT-BR: Normaliza valores para exibição segura em texto (evita quebrar UI com objetos).
    ES:    Normaliza valores para una visualización segura en texto (evita romper UI con objetos).
    EN:    Normalizes values for safe text rendering (prevents UI issues with objects).
    """
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        # PT-BR: Nunca exibimos dict/list "cru"; convertemos para string JSON legível.
        # ES:    Nunca mostramos dict/list "en bruto"; lo convertimos a string JSON legible.
        # EN:    We never show raw dict/list; we convert it to a readable JSON string.
        return json.dumps(v, ensure_ascii=False)
    return str(v)


def format_motivos(motivos):
    """
    PT-BR: Gera resumo legível de motivos de score sem expor JSON bruto na tabela.
    ES:    Genera un resumen legible de motivos del score sin exponer JSON crudo en la tabla.
    EN:    Builds a human-readable score-reason summary without showing raw JSON in the table.
    """
    if not motivos:
        return ""

    parts = []
    for m in motivos:
        if not isinstance(m, dict):
            continue
        fator = str(m.get("fator", "")).strip() or "Fator"
        impacto = m.get("impacto", 0)
        detalhe = str(m.get("detalhe", "")).strip()
        if detalhe and detalhe.lower() != "none":
            parts.append(f"{fator} {impacto:+} — {detalhe}")
        else:
            parts.append(f"{fator} {impacto:+}")
    return " | ".join(parts[:6])


def format_score_engine(engine_value):
    """
    PT-BR: Formata origem do score para exibicao amigavel na UI.
    """
    raw = sanitize_text(engine_value).strip()
    key = raw.upper()
    if key == "ML":
        return "ML"
    if key in {"RULES", "REGRAS"}:
        return "Regras"
    return raw or "—"


def format_score_probability(prob_value):
    """
    PT-BR: Formata probabilidade [0..1] para percentual legivel.
    """
    try:
        n = float(prob_value)
    except Exception:
        return "—"
    if n < 0 or n > 1:
        return "—"
    return f"{n * 100:.1f}%"


def format_score_scored_at(value):
    """
    PT-BR: Formata timestamp de diagnostico para leitura rapida.
    """
    txt = sanitize_text(value).strip()
    if not txt:
        return "—"
    return txt.replace("T", " ")[:19]


def format_ml_model_label(model_id):
    """
    PT-BR: Traduz identificador interno do modelo para nome amigavel.
    """
    key = sanitize_text(model_id).strip().lower()
    if key == "logit_fine":
        return "Regressao Logistica (fine tuning)"
    if key == "rf_fine":
        return "Random Forest (fine tuning)"
    if key == "logit_base":
        return "Regressao Logistica (base)"
    if key == "rf_base":
        return "Random Forest (base)"
    if key == "best_model":
        return "Best model"
    if key == "runner_up_model":
        return "Runner-up model"
    return sanitize_text(model_id).strip() or "—"


def format_fine_tuning_summary(best_params):
    """
    PT-BR: Resume hiperparametros vencedores do fine tuning.
    """
    if not isinstance(best_params, dict) or not best_params:
        return "—"
    chunks = []
    for key in sorted(best_params.keys()):
        short_key = sanitize_text(key).replace("model__", "").strip()
        raw = best_params.get(key)
        value = "null" if raw is None else sanitize_text(raw).strip()
        chunks.append(f"{short_key}={value}")
    return ", ".join(chunks) if chunks else "—"


def badge_status(status: str) -> str:
    """
    PT-BR: Converte status comercial em "badge" visual padronizado (emoji + rótulo).
    ES:    Convierte el estado comercial en "badge" visual estandar (emoji + etiqueta).
    EN:    Converts commercial status into a standardized visual badge (emoji + label).
    """
    s = (status or "").upper()
    if s == "QUALIFICADO":
        return "✅ QUALIFICADO"
    if s == "AQUECENDO":
        return "🔥 AQUECENDO"
    if s == "ENVIADO":
        return "📤 ENVIADO"
    return "👀 CURIOSO"


def to_csv(rows, columns=None, sep=";", encoding="utf-8-sig"):
    """
    PT-BR: Serializa lista de dicts para CSV com escape básico de separador/aspas.
           Útil para exportar filtros (leads/parceiros) como evidência do produto.
    ES:    Serializa una lista de diccionarios a CSV con escape básico de separador/comillas.
           Útil para exportar filtros (leads/socios) como evidencia del producto.
    EN:    Serializes a list of dicts to CSV with basic delimiter/quote escaping.
           Useful to export filtered data (leads/partners) as product evidence.
    """
    if not rows:
        return ""

    if columns is None:
        columns = list(rows[0].keys())

    buf = StringIO()
    buf.write(sep.join(columns) + "\n")

    for r in rows:
        values = []
        for c in columns:
            v = r.get(c, "")
            if isinstance(v, (dict, list)):
                v = json.dumps(v, ensure_ascii=False)
            v = "" if v is None else str(v)
            v = v.replace("\n", " ").replace("\r", " ")
            if sep in v or '"' in v:
                v = v.replace('"', '""')
                v = f'"{v}"'
            values.append(v)
        buf.write(sep.join(values) + "\n")
    return buf.getvalue()


def kv_table(data: dict, title: str = None):
    """
    PT-BR: Renderiza dict em tabela Campo/Valor para leitura rápida (sem JSON bruto).
    ES:    Renderiza un diccionario en tabla Campo/Valor para lectura rápida (sin JSON crudo).
    EN:    Renders a dict as a Field/Value table for quick reading (no raw JSON).
    """
    if title:
        st.markdown(f"### {title}")
    if not data:
        st.info("Sem dados para exibir.")
        return

    rows = [{"Campo": k, "Valor": sanitize_text(v)} for k, v in data.items()]
    if pd is not None:
        df = pd.DataFrame(rows)
        st.dataframe(df, use_container_width=True, hide_index=True)
    else:
        st.table(rows)


def dict_to_bullets(d: dict):
    """
    PT-BR: Converte dict em bullets para leitura rápida no painel (sem JSON "cru").
    ES:    Convierte un diccionario en bullets para lectura rápida en el panel (sin JSON "crudo").
    EN:    Converts a dict into bullets for quick panel reading (no raw JSON).
    """
    if not d or not isinstance(d, dict):
        st.caption("Não informado.")
        return
    for k, v in d.items():
        st.write(f"- **{k}**: {sanitize_text(v)}")


def segment_label(seg: str) -> str:
    """
    PT-BR: Traduz código de segmento para rótulo amigável na interface (com ícone).
    ES:    Traduce el código de segmento a una etiqueta amigable en la interfaz (con ícono).
    EN:    Maps segment code to a user-friendly label in the UI (with icon).
    """
    s = (seg or "").upper()
    if s == "CAVALOS":
        return "🐴 Cavalos"
    if s == "SERVICOS":
        return "🧰 Serviços"
    if s == "EVENTOS":
        return "🎪 Eventos"
    if s == "EQUIPAMENTOS":
        return "🧲 Equipamentos"
    return s or "—"


def status_to_crm_stage(status: str) -> str:
    """
    PT-BR: Mapeia status comercial para coluna padrao do Kanban CRM.
    ES:    Mapea estado comercial a la columna estandar del Kanban CRM.
    EN:    Maps commercial status to the default CRM Kanban column.
    """
    s = (status or "").upper().strip()
    if s == "ENVIADO":
        return "ENVIADO"
    if s == "QUALIFICADO":
        return "QUALIFICADO"
    if s == "AQUECENDO":
        return "AQUECENDO"
    return "INBOX"


def crm_stage_label(stage: str) -> str:
    """
    PT-BR: Rotulo amigavel de coluna Kanban.
    ES:    Etiqueta amigable de columna Kanban.
    EN:    Friendly Kanban column label.
    """
    s = (stage or "").upper().strip()
    if s == "INBOX":
        return "Inbox"
    if s == "AQUECENDO":
        return "Aquecendo"
    if s == "QUALIFICADO":
        return "Qualificado"
    if s == "ENVIADO":
        return "Enviado"
    return s or "Inbox"


def normalize_crm_stage(stage_value: str, status_value: str = "") -> str:
    """
    PT-BR: Normaliza etapa do CRM com fallback para status comercial.
    """
    stage = sanitize_text(stage_value).strip().upper()
    if stage in {"INBOX", "AQUECENDO", "QUALIFICADO", "ENVIADO"}:
        return stage
    return status_to_crm_stage(status_value)


def crm_stage_to_status_label(stage_value: str) -> str:
    """
    PT-BR: Converte etapa CRM para rótulo de status exibido na visão geral.
    """
    stage = sanitize_text(stage_value).strip().upper()
    if stage == "INBOX":
        return "CURIOSO"
    if stage in {"AQUECENDO", "QUALIFICADO", "ENVIADO"}:
        return stage
    return "CURIOSO"


def normalize_commercial_status(status_value: str, stage_value: str = "") -> str:
    """
    PT-BR: Normaliza status comercial para os 4 rótulos usados na visão geral/Leads.
    """
    status = sanitize_text(status_value).strip().upper()
    if status in {"CURIOSO", "AQUECENDO", "QUALIFICADO", "ENVIADO"}:
        return status
    stage = normalize_crm_stage(stage_value, status_value)
    return crm_stage_to_status_label(stage)


def extract_crm_board_items(payload):
    """
    PT-BR: Extrai lista de leads do payload de /crm/board.
    """
    if isinstance(payload, dict) and isinstance(payload.get("items"), list):
        return payload.get("items") or []
    if isinstance(payload, list):
        return payload
    return []


def build_crm_status_counts(items: list) -> dict:
    """
    PT-BR: Conta status comercial (CURIOSO/AQUECENDO/QUALIFICADO/ENVIADO).
           Fallback para etapa CRM apenas quando status não vier preenchido.
    """
    counts = {"CURIOSO": 0, "AQUECENDO": 0, "QUALIFICADO": 0, "ENVIADO": 0}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        status_label = normalize_commercial_status(item.get("status"), item.get("crm_stage"))
        counts[status_label] = int(counts.get(status_label, 0) or 0) + 1
    return counts


# =============================================================================
# HELPERS: DISPLAY IDENTIDADE (UI ONLY)
# =============================================================================
# PT-BR: Mantem dados reais intactos e ajusta apenas o que e exibido (nome/cidade/uf)
#        para ficar mais realista e consistente com a UI Node.js.
REALISTIC_CITIES_BY_UF = {
    "SP": ["Sao Paulo", "Campinas", "Ribeirao Preto", "Sorocaba", "Sao Jose dos Campos"],
    "MG": ["Belo Horizonte", "Uberlandia", "Juiz de Fora", "Contagem", "Montes Claros"],
    "GO": ["Goiania", "Aparecida de Goiania", "Anapolis", "Rio Verde", "Jatai"],
    "RJ": ["Rio de Janeiro", "Niteroi", "Petropolis", "Campos dos Goytacazes", "Volta Redonda"],
    "PR": ["Curitiba", "Londrina", "Maringa", "Cascavel", "Ponta Grossa"],
    "SC": ["Florianopolis", "Joinville", "Blumenau", "Chapeco", "Criciuma"],
    "RS": ["Porto Alegre", "Caxias do Sul", "Pelotas", "Santa Maria", "Passo Fundo"],
    "BA": ["Salvador", "Feira de Santana", "Vitoria da Conquista", "Ilheus", "Lauro de Freitas"],
    "DF": ["Brasilia", "Taguatinga", "Ceilandia", "Samambaia", "Gama"],
}

REALISTIC_LEAD_NAMES = [
    "Lucas Almeida",
    "Mariana Costa",
    "Rafael Nogueira",
    "Camila Fernandes",
    "Bruno Carvalho",
    "Juliana Ribeiro",
    "Thiago Martins",
    "Patricia Azevedo",
    "Diego Santana",
    "Renata Moraes",
    "Felipe Barros",
    "Aline Duarte",
    "Gustavo Leite",
    "Vanessa Rocha",
    "Eduardo Freitas",
    "Larissa Gomes",
    "Rodrigo Pires",
    "Bianca Melo",
    "Andre Teixeira",
    "Carla Mendes",
]

KNOWN_UFS = list(REALISTIC_CITIES_BY_UF.keys())

PARTNER_BRAND_CORES = [
    "Aurora",
    "Vale Verde",
    "Boa Vista",
    "Monte Real",
    "Estrela do Campo",
    "Pampa Nobre",
    "Serra Azul",
    "Alvorada",
    "Santa Helena",
    "Rio Dourado",
    "Campo Forte",
    "Nova Esperanca",
    "Portal do Hipismo",
    "Sol do Cerrado",
    "Lagoa Clara",
    "Imperio Equestre",
    "Bela Vista",
    "Vila Hipica",
    "Rota dos Cavalos",
    "Santo Trote",
]

PARTNER_STYLE_BY_SEGMENT = {
    "CAVALOS": ["Haras", "Centro Equestre", "Hipica", "Rancho", "Estancia"],
    "SERVICOS": ["Clinica Veterinaria", "Consultoria", "Centro de Treinamento", "Gestao Equestre", "Laboratorio"],
    "EVENTOS": ["Arena", "Circuito", "Expo", "Festival", "Grand Prix"],
    "EQUIPAMENTOS": ["Selaria", "Equipamentos", "Suprimentos", "Ferragens", "Sela e Cia"],
    "DEFAULT": ["Grupo Equestre", "Parceiro Equestre", "Operadora Equestre"],
}

PARTNER_ACTIVITY_BY_SEGMENT = {
    "CAVALOS": "Criacao e Manejo de Equinos",
    "SERVICOS": "Servicos Equestres",
    "EVENTOS": "Eventos e Producoes Equestres",
    "EQUIPAMENTOS": "Comercio de Artigos Equestres",
    "DEFAULT": "Negocios Equestres",
}

PARTNER_LEGAL_TYPES = ["LTDA", "S.A.", "EIRELI", "ME", "EPP"]


def _fold_text(value) -> str:
    txt = sanitize_text(value or "")
    txt = unicodedata.normalize("NFD", txt)
    txt = "".join(ch for ch in txt if unicodedata.category(ch) != "Mn")
    return txt.strip().upper()


def _seed_number(seed_value: str) -> int:
    # JS parity: same hash logic used in ui_web/public/js/*.js
    h = 0
    for ch in sanitize_text(seed_value):
        h = ((h * 31) + ord(ch)) & 0xFFFFFFFF
    return h


def _pick_seeded(options, seed_value: str) -> str:
    if not options:
        return ""
    idx = _seed_number(seed_value) % len(options)
    return options[idx]


def _normalize_uf(value: str) -> str:
    return sanitize_text(value or "").strip().upper()


def _normalize_cnpj_key(value: str) -> str:
    return "".join(ch for ch in sanitize_text(value or "") if ch.isdigit())


def _city_belongs_to_uf(city_value: str, uf_value: str) -> bool:
    city_fold = _fold_text(city_value)
    if not city_fold:
        return False
    candidates = REALISTIC_CITIES_BY_UF.get(uf_value, [])
    if not candidates:
        return True
    return any(_fold_text(c) == city_fold for c in candidates)


def _guess_uf_by_city(city_value: str) -> str:
    city_fold = _fold_text(city_value)
    if not city_fold:
        return ""
    for uf_code, cities in REALISTIC_CITIES_BY_UF.items():
        if any(_fold_text(c) == city_fold for c in cities):
            return uf_code
    return ""


def _is_generic_name(name_value: str) -> bool:
    name_fold = _fold_text(name_value)
    if not name_fold or name_fold in {"-", "N/A", "NA"}:
        return True
    return (
        name_fold.startswith("LEAD DEMO")
        or name_fold.startswith("LEAD ")
        or name_fold == "TESTE"
        or name_fold.startswith("TESTE ")
        or name_fold.startswith("TEST ")
    )


def _is_generic_city(city_value: str) -> bool:
    city_fold = _fold_text(city_value)
    if not city_fold:
        return True
    return city_fold in {
        "-",
        "CIDADE",
        "CITY",
        "N/A",
        "NA",
        "NAO DEFINIDO",
        "NAO INFORMADA",
        "TESTE",
    }


def decorate_lead_for_ui(lead: dict, seed_hint: str = "", fill_missing_uf: bool = False) -> dict:
    """
    PT-BR: Prepara campos __ui_* preservando identidade real do lead.
    """
    out = dict(lead or {})
    raw_nome = sanitize_text(out.get("nome")).strip()
    raw_cidade = sanitize_text(out.get("cidade")).strip()
    raw_uf = sanitize_text(out.get("uf")).strip()

    seed_base = sanitize_text(seed_hint or out.get("id") or "lead")

    nome_ui = raw_nome
    cidade_ui = raw_cidade
    uf_ui = _normalize_uf(raw_uf)

    if not uf_ui and cidade_ui:
        guessed = _guess_uf_by_city(cidade_ui)
        if guessed:
            uf_ui = guessed

    if fill_missing_uf and not uf_ui:
        uf_ui = _pick_seeded(KNOWN_UFS, f"{seed_base}-uf")

    # Mantem nome/cidade exatamente como vieram do backend para evitar
    # divergencia entre o nome criado na tela de demo e o nome exibido em Leads.
    nome_ui = raw_nome or "-"
    cidade_ui = raw_cidade or "-"

    out["__ui_nome"] = nome_ui
    out["__ui_cidade"] = cidade_ui or "-"
    out["__ui_uf"] = uf_ui or "-"
    out["__raw_nome"] = raw_nome
    out["__raw_cidade"] = raw_cidade
    out["__raw_uf"] = raw_uf
    return out


def decorate_partner_for_ui(partner: dict) -> dict:
    """
    PT-BR: Decora parceiro com __ui_nome_fantasia e __ui_razao_social realistas.
    """
    out = dict(partner or {})
    segmento = sanitize_text(out.get("segmento")).strip().upper()

    seed_parts = [
        out.get("id"),
        out.get("cnpj"),
        out.get("uf"),
        out.get("municipio_nome") or out.get("municipio_cod"),
        segmento,
    ]
    seed_base = "|".join(sanitize_text(v) for v in seed_parts)

    styles = PARTNER_STYLE_BY_SEGMENT.get(segmento, PARTNER_STYLE_BY_SEGMENT["DEFAULT"])
    style = _pick_seeded(styles, f"{seed_base}-style")
    core = _pick_seeded(PARTNER_BRAND_CORES, f"{seed_base}-core")
    nome_fantasia_ui = " ".join(x for x in [style, core] if x).strip() or "Parceiro Equestre"

    legal_type = _pick_seeded(PARTNER_LEGAL_TYPES, f"{seed_base}-legal")
    activity = PARTNER_ACTIVITY_BY_SEGMENT.get(segmento, PARTNER_ACTIVITY_BY_SEGMENT["DEFAULT"])
    razao_social_ui = " ".join(x for x in [nome_fantasia_ui, activity, legal_type] if x).strip()

    out["__ui_nome_fantasia"] = nome_fantasia_ui
    out["__ui_razao_social"] = razao_social_ui or nome_fantasia_ui
    return out


def partner_sort_key(partner: dict):
    """
    PT-BR: Chave estável para manter a mesma ordem de parceiros entre interfaces.
    """
    pid = sanitize_text((partner or {}).get("id")).strip().lower()
    cnpj = sanitize_text((partner or {}).get("cnpj")).strip().lower()
    nome = sanitize_text((partner or {}).get("__ui_nome_fantasia")).strip().lower()
    return (pid, cnpj, nome)


def build_partner_ui_lookup(partners: list) -> dict:
    """
    PT-BR: Cria um lookup estável para garantir que o nome fantasia exibido no
    matching use exatamente a mesma regra visual da guia Parceiros.
    """
    lookup = {}
    for p in partners or []:
        if not isinstance(p, dict):
            continue
        decorated = decorate_partner_for_ui(p)
        nome_ui = sanitize_text(decorated.get("__ui_nome_fantasia")).strip()
        if not nome_ui:
            continue
        pid = sanitize_text(decorated.get("id")).strip()
        cnpj = sanitize_text(decorated.get("cnpj")).strip()
        cnpj_key = _normalize_cnpj_key(cnpj)
        if pid:
            lookup[f"id:{pid}"] = nome_ui
        if cnpj:
            lookup[f"cnpj:{cnpj}"] = nome_ui
        if cnpj_key:
            lookup[f"cnpj_digits:{cnpj_key}"] = nome_ui
    return lookup


def resolve_match_partner_name(match_item: dict, partner_lookup: dict) -> str:
    """
    PT-BR: Resolve o nome fantasia do matching priorizando o mesmo nome usado
    na guia Parceiros; se não encontrar, aplica a mesma decoração local.
    """
    m = match_item or {}
    pid = sanitize_text(m.get("id")).strip()
    if pid:
        by_id = sanitize_text((partner_lookup or {}).get(f"id:{pid}")).strip()
        if by_id:
            return by_id

    cnpj = sanitize_text(m.get("cnpj")).strip()
    if cnpj:
        by_cnpj = sanitize_text((partner_lookup or {}).get(f"cnpj:{cnpj}")).strip()
        if by_cnpj:
            return by_cnpj
    cnpj_key = _normalize_cnpj_key(cnpj)
    if cnpj_key:
        by_cnpj_key = sanitize_text((partner_lookup or {}).get(f"cnpj_digits:{cnpj_key}")).strip()
        if by_cnpj_key:
            return by_cnpj_key

    decorated = decorate_partner_for_ui(m)
    return (
        sanitize_text(decorated.get("__ui_nome_fantasia")).strip()
        or sanitize_text(m.get("nome_fantasia") or m.get("name")).strip()
        or "—"
    )


# =============================================================================
# CSS / TEMA
# =============================================================================
def apply_css(presentation_light: bool):
    """
    PT-BR: Aplica CSS base e, opcionalmente, uma variante clara ("modo apresentação")
           para maior legibilidade em projetor/telão.
    ES:    Aplica CSS base y, opcionalmente, una variante clara ("modo presentación")
           para mejor legibilidad en proyector/pantalla.
    EN:    Applies base CSS and, optionally, a light variant ("presentation mode")
           for better readability on projectors/screens.
    """
    base_css = """
    <style>
      .block-container { padding-top: 1.1rem; padding-bottom: 1.2rem; }
      [data-testid="stSidebar"] { padding-top: 1.1rem; }
      .kpi-card {
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 14px;
        padding: 14px 16px;
        background: rgba(255,255,255,0.02);
      }
      .kpi-title { font-size: 0.82rem; opacity: 0.82; margin-bottom: 6px; }
      .kpi-value { font-size: 1.55rem; font-weight: 800; letter-spacing: -0.5px; }
      .muted { opacity: 0.78; }
      .section-title { margin-top: 0.2rem; }
      .pill {
        display:inline-block; padding:4px 10px; border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04);
        font-size: 0.85rem;
      }
      .ml-info-banner {
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        padding: 12px 14px;
        background: rgba(255,255,255,0.03);
      }
      .ml-info-title {
        font-size: 0.82rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.8;
      }
      .ml-info-line {
        margin-top: 6px;
        font-size: 0.95rem;
      }
      .ml-info-meta {
        margin-top: 7px;
        font-size: 0.8rem;
        opacity: 0.75;
      }
      .sidebar-brand-logo-wrap {
        display: flex;
        width: 100%;
        align-items: center;
        justify-content: center;
        margin: 0.1rem 0 0.65rem 0;
      }
      .sidebar-brand-logo-shell {
        width: 178px;
        height: 178px;
        border-radius: 50%;
        border: 1px solid rgba(137,220,255,0.55);
        box-shadow:
          0 16px 30px rgba(0,0,0,0.35),
          0 0 0 6px rgba(74,191,255,0.12);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
      }
      .sidebar-brand-logo {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: contain;
        object-position: center;
        background: transparent;
        transform: translateY(5px);
      }
      /* melhora legibilidade no sidebar */
      [data-testid="stSidebar"] * { color: rgba(255,255,255,0.92); }
      [data-testid="stSidebar"] .stCaption { color: rgba(255,255,255,0.70) !important; }

      /* evita "apagado" no rádio em alguns temas */
      div[role="radiogroup"] label span { opacity: 1 !important; }
    </style>
    """
    st.markdown(base_css, unsafe_allow_html=True)

    if presentation_light:
        light_css = """
        <style>
          html, body, [data-testid="stAppViewContainer"] {
            background: #ffffff !important;
            color: #111827 !important;
          }

          /* sidebar */
          [data-testid="stSidebar"] {
            background: #f5f7fb !important;
            border-right: 1px solid rgba(17,24,39,0.10);
          }
          [data-testid="stSidebar"] * {
            color: #111827 !important;
          }
          [data-testid="stSidebar"] .stCaption {
            color: rgba(17,24,39,0.72) !important;
          }
          .sidebar-brand-logo-shell {
            border: 1px solid rgba(17,24,39,0.22) !important;
            box-shadow: 0 10px 20px rgba(17,24,39,0.16) !important;
          }

          /* cards */
          .kpi-card {
            border: 1px solid rgba(17,24,39,0.12) !important;
            background: #ffffff !important;
          }
          .ml-info-banner {
            border: 1px solid rgba(17,24,39,0.12) !important;
            background: #ffffff !important;
          }

          /* inputs */
          .stTextInput input,
          .stNumberInput input,
          .stSelectbox div[data-baseweb="select"],
          .stTextArea textarea {
            background: #ffffff !important;
            color: #111827 !important;
          }

          /* labels */
          label, p, span, div, h1, h2, h3, h4 { color: #111827 !important; }

          /* alertas com boa leitura */
          .stAlert {
            border-radius: 12px;
          }
        </style>
        """
        st.markdown(light_css, unsafe_allow_html=True)


def render_sidebar_logo():
    """
    Render a circular EquipePulse brand mark in Streamlit sidebar.
    """
    root_dir = Path(__file__).resolve().parents[2]
    shared_assets_dir = root_dir / "ui_web" / "public" / "images"
    assets_dir = Path(__file__).resolve().parent / "assets"
    logo_candidates = [
        assets_dir / "equipepulse_logo.png",
        shared_assets_dir / "equipepulse_logo.png",
        assets_dir / "equipepulse_circle.svg",
        shared_assets_dir / "equipepulse_circle.svg",
    ]
    logo_path = next((p for p in logo_candidates if p.exists()), None)
    if logo_path is None:
        return

    try:
        logo_b64 = base64.b64encode(logo_path.read_bytes()).decode("ascii")
    except Exception:
        return

    mime = "image/png" if logo_path.suffix.lower() == ".png" else "image/svg+xml"

    st.sidebar.markdown(
        f"""
        <div class="sidebar-brand-logo-wrap">
          <div class="sidebar-brand-logo-shell">
            <img class="sidebar-brand-logo" alt="EquipePulse" src="data:{mime};base64,{logo_b64}" />
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def kpi(container, title, value):
    """
    PT-BR: Renderiza um card de KPI reutilizável (título + valor).
    ES:    Renderiza una tarjeta KPI reutilizable (título + valor).
    EN:    Renders a reusable KPI card (title + value).
    """
    container.markdown(
        f"""
        <div class="kpi-card">
          <div class="kpi-title">{title}</div>
          <div class="kpi-value">{value}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


# =============================================================================
# SIDEBAR NAV
# =============================================================================
# PT-BR: Navegação principal do painel via sidebar.
# ES:    Navegación principal del panel vía sidebar.
# EN:    Main navigation for the panel via sidebar.
render_sidebar_logo()
st.sidebar.title("Growth Equestre (MVP)")
st.sidebar.caption("Admin • MG/SP/GO • Funil + Lead Scoring + Parceiros")

page = st.sidebar.radio(
    "Navegação",
    ["Visão geral", "Leads", "CRM (Kanban)", "Parceiros", "Criar lead (demo)", "Roteiro de demo"],
    key="nav_page",
)

with st.sidebar.expander("Configurações", expanded=False):
    st.session_state["presentation_light"] = st.checkbox(
        "Modo apresentação (claro)",
        value=False,
        key="presentation_light_toggle",
        help="Melhor para projetor/apresentação (alto contraste).",
    )
    st.session_state["debug_mode"] = st.checkbox(
        "Modo debug",
        value=False,
        key="debug_toggle",
        help="Mostra detalhes técnicos em erros (útil para dev).",
    )

    st.markdown("---")
    st.caption("Manutenção: deduplicação de leads")
    dedup_window_minutes = st.number_input(
        "Janela de deduplicação (min)",
        min_value=1,
        max_value=1440,
        value=60,
        step=1,
        key="dedup_window_minutes_sidebar",
    )

    dcol1, dcol2 = st.columns(2)
    dedup_dry_run_clicked = dcol1.button("Dry-run", key="dedup_dry_run_btn")
    dedup_run_clicked = dcol2.button("Executar", key="dedup_run_btn")

    if dedup_dry_run_clicked or dedup_run_clicked:
        payload = {
            "dry_run": bool(dedup_dry_run_clicked),
            "window_minutes": int(dedup_window_minutes),
        }
        dedup_resp, dedup_err = safe_post("/admin/dedup-leads", payload=payload, timeout=90)
        if dedup_err:
            st.error("Falha ao executar deduplicação de leads.")
            if st.session_state.get("debug_mode"):
                st.caption(str(dedup_err))
        else:
            st.session_state["dedup_last_result"] = dedup_resp
            if payload["dry_run"]:
                st.success("Dry-run concluído.")
            else:
                st.success("Limpeza de duplicados concluída.")

    last_dedup = st.session_state.get("dedup_last_result")
    if isinstance(last_dedup, dict):
        migrated = last_dedup.get("migrated") if isinstance(last_dedup.get("migrated"), dict) else {}
        dedup_rows = [
            {"Indicador": "Modo", "Valor": "dry-run" if last_dedup.get("dry_run") else "limpeza real"},
            {"Indicador": "Janela (min)", "Valor": int(last_dedup.get("window_minutes") or 0)},
            {"Indicador": "Leads antes", "Valor": int(last_dedup.get("before_leads") or 0)},
            {"Indicador": "Leads após", "Valor": int(last_dedup.get("after_leads") or 0)},
            {"Indicador": "Grupos duplicados", "Valor": int(last_dedup.get("duplicate_groups") or 0)},
            {"Indicador": "Leads removidos", "Valor": int(last_dedup.get("deleted_leads") or 0)},
            {"Indicador": "Eventos migrados", "Valor": int(migrated.get("events") or 0)},
        ]
        if pd is not None:
            st.dataframe(pd.DataFrame(dedup_rows), use_container_width=True, hide_index=True)
        else:
            st.table(dedup_rows)

# PT-BR: Aplica CSS após ler as opções do usuário no sidebar.
# ES:    Aplica CSS después de leer las opciones del usuario en el sidebar.
# EN:    Applies CSS after reading user options from the sidebar.
apply_css(st.session_state.get("presentation_light", False))

# =============================================================================
# TOP HEADER
# =============================================================================
# PT-BR: Cabeçalho do app (título e breve descrição).
# ES:    Encabezado de la app (título y breve descripción).
# EN:    App header (title and short description).
st.markdown("## Admin — Growth Equestre (MVP)")
st.caption("Acompanhe leads, priorize atendimento e explore parceiros por UF/segmento — sem telas técnicas.")

# =============================================================================
# PAGE: VISÃO GERAL
# =============================================================================
if page == "Visão geral":
    board_payload, board_err = safe_get("/crm/board", params={}, timeout=15)
    board_items = extract_crm_board_items(board_payload)

    # Fallback para /leads se /crm/board indisponivel.
    if board_err or not board_items:
        leads_payload, leads_err = safe_get("/leads", params={}, timeout=15)
        if leads_err:
            show_error(
                "Não foi possível carregar os dados agora. Tente novamente.",
                f"/crm/board: {board_err} | /leads: {leads_err}",
            )
            board_items = []
        else:
            leads_list = leads_payload if isinstance(leads_payload, list) else []
            board_items = leads_list

    status_counts = build_crm_status_counts(board_items)
    total = sum(int(status_counts.get(k, 0) or 0) for k in ["CURIOSO", "AQUECENDO", "QUALIFICADO", "ENVIADO"])
    curiosos = int(status_counts.get("CURIOSO", 0) or 0)
    qualificados = int(status_counts.get("QUALIFICADO", 0) or 0)
    aquecendo = int(status_counts.get("AQUECENDO", 0) or 0)
    enviados = int(status_counts.get("ENVIADO", 0) or 0)
    conversao = (qualificados / total * 100) if total else 0.0

    colA, colB, colC, colD, colE, colF = st.columns(6)
    kpi(colA, "Leads (total)", total)
    kpi(colB, "Curioso", curiosos)
    kpi(colC, "Aquecendo", aquecendo)
    kpi(colD, "Qualificados", qualificados)
    kpi(colE, "Enviado", enviados)
    kpi(colF, "Conversão p/ qualificado", f"{conversao:.1f}%")

    ml_info, ml_err = safe_get("/ml/model-info", timeout=15)
    winner_txt = "Indisponivel"
    fine_tuning_txt = "Sem dados"
    meta_txt = ""

    if isinstance(ml_info, dict) and ml_info.get("available"):
        winner = ml_info.get("winner") if isinstance(ml_info.get("winner"), dict) else {}
        runner_up = ml_info.get("runner_up") if isinstance(ml_info.get("runner_up"), dict) else {}
        fine_tuning = ml_info.get("fine_tuning") if isinstance(ml_info.get("fine_tuning"), dict) else {}

        winner_txt = sanitize_text(winner.get("label") or "").strip() or format_ml_model_label(winner.get("id"))
        fine_tuning_txt = (
            sanitize_text(fine_tuning.get("summary")).strip()
            or format_fine_tuning_summary(fine_tuning.get("best_params"))
        )

        runner_label = sanitize_text(runner_up.get("label") or "").strip() or format_ml_model_label(
            runner_up.get("id")
        )
        if runner_label and runner_label != "—":
            meta_txt = f"Runner-up: {runner_label}"
    else:
        meta_txt = "Treine os modelos para gerar o relatorio model_selection_report.json."
        if st.session_state.get("debug_mode") and ml_err:
            meta_txt = f"{meta_txt} Erro: {ml_err}"

    st.markdown(
        f"""
        <div class="ml-info-banner">
          <div class="ml-info-title">Modelo de ML em producao</div>
          <div class="ml-info-line"><b>Modelo vencedor:</b> {html.escape(winner_txt, quote=True)}</div>
          <div class="ml-info-line"><b>Fine tuning:</b> {html.escape(fine_tuning_txt, quote=True)}</div>
          <div class="ml-info-meta">{html.escape(meta_txt, quote=True)}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.markdown("#### Resumo por status comercial")
    status_rows = [
        {"Status": "CURIOSO", "Total": int(status_counts.get("CURIOSO", 0) or 0)},
        {"Status": "AQUECENDO", "Total": int(status_counts.get("AQUECENDO", 0) or 0)},
        {"Status": "QUALIFICADO", "Total": int(status_counts.get("QUALIFICADO", 0) or 0)},
        {"Status": "ENVIADO", "Total": int(status_counts.get("ENVIADO", 0) or 0)},
    ]
    if pd is not None:
        st.dataframe(pd.DataFrame(status_rows), use_container_width=True, hide_index=True)
    else:
        st.table(status_rows)

    st.divider()

    st.subheader("Parceiros (diretório)")
    c1, c2 = st.columns([1, 2])
    uf = c1.selectbox("UF", ["", "MG", "SP", "GO"], key="overview_uf")

    summary, err = safe_get("/partners/summary", params={"uf": uf} if uf else {}, timeout=15)
    if err:
        show_error("Não foi possível carregar o resumo de parceiros.", err)
        summary = []

    if summary:
        total_partners = sum(int(x.get("total", 0) or 0) for x in summary if isinstance(x, dict))
        cA, cB, cC, cD = st.columns(4)
        kpi(cA, "Total de parceiros", total_partners)
        ordered = sorted(summary, key=lambda x: int((x or {}).get("total", 0) or 0), reverse=True)
        cards = [cB, cC, cD]
        for i, segrow in enumerate(ordered[:3]):
            seg = segment_label(segrow.get("segmento"))
            tot = int(segrow.get("total", 0) or 0)
            kpi(cards[i], f"{seg}", tot)

        st.markdown("#### Resumo completo (tabela)")
        rows = []
        for x in ordered:
            rows.append({"Segmento": segment_label(x.get("segmento")), "Total": int(x.get("total", 0) or 0)})
        if pd is not None:
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        else:
            st.table(rows)
    else:
        st.info("Ainda não há parceiros carregados (ou nenhum resultado para esse filtro).")

    st.divider()
    st.subheader("Como usar (bem direto)")
    st.markdown(
        """
        - **Leads:** crie/receba leads → calcule score → priorize **✅ Qualificados**.
        - **Parceiros:** filtre por UF/segmento e exporte CSV para prospecção.
        - **Roteiro de demo:** gera um cenário completo em 1 clique para o pitch.
        """
    )

# =============================================================================
# PAGE: LEADS
# =============================================================================
elif page == "Leads":
    st.subheader("Leads")
    st.caption("Filtre, veja detalhes e execute ações (calcular score / handoff)." )

    f1, f2, f3, f4 = st.columns(4)
    status = f1.selectbox(
        "Status",
        ["", "CURIOSO", "AQUECENDO", "QUALIFICADO", "ENVIADO"],
        key="leads_status",
    )
    minScore = f2.number_input("Score mínimo", 0, 100, 0, 5, key="leads_min_score")
    uf = f3.selectbox("UF", ["", "MG", "SP", "GO"], key="leads_uf")
    seg = f4.selectbox("Segmento", ["", "CAVALOS", "SERVICOS", "EVENTOS", "EQUIPAMENTOS"], key="leads_seg")

    params = {}
    if status:
        params["status"] = status
    if uf:
        params["uf"] = uf
    if seg:
        params["segment"] = seg
    if minScore:
        params["minScore"] = int(minScore)

    left_top, right_top = st.columns([1, 1])
    refresh = left_top.button("🔄 Atualizar lista", key="refresh_leads_btn")
    if refresh:
        st.toast("Lista atualizada.")

    leads, err = safe_get("/leads", params=params, timeout=15)
    if err:
        show_error("Não foi possível carregar leads agora.", err)
        leads = []
    leads_ui = [
        decorate_lead_for_ui(l, seed_hint=f"{(l.get('id') or 'lead')}-{idx}", fill_missing_uf=False)
        for idx, l in enumerate(leads)
    ]
    leads_ui_by_id = {x.get("id"): x for x in leads_ui if x.get("id")}

    export_rows = []
    for l in leads:
        export_rows.append({
            "id": l.get("id"),
            "nome": l.get("nome"),
            "whatsapp": l.get("whatsapp"),
            "email": l.get("email"),
            "uf": l.get("uf"),
            "cidade": l.get("cidade"),
            "segmento_interesse": l.get("segmento_interesse"),
            "orcamento_faixa": l.get("orcamento_faixa"),
            "prazo_compra": l.get("prazo_compra"),
            "score": l.get("score"),
            "status": l.get("status"),
            "motivos_resumo": format_motivos(l.get("score_motivos")),
            "created_at": l.get("created_at"),
        })
    csv_data = to_csv(export_rows, columns=list(export_rows[0].keys()) if export_rows else None)

    right_top.download_button(
        "⬇️ Baixar CSV (leads filtrados)",
        data=csv_data.encode("utf-8-sig") if csv_data else b"",        file_name="leads_filtrados.csv",
        mime="text/csv",
        disabled=(len(export_rows) == 0),
        key="dl_leads_filtered",
    )

    if not leads:
        st.info("Nenhum lead encontrado com os filtros atuais.")
    else:
        display = []
        for idx, l in enumerate(leads_ui, start=1):
            display.append({
                "N": idx,
                "Nome": l.get("__ui_nome"),
                "UF": l.get("__ui_uf"),
                "Cidade": l.get("__ui_cidade"),
                "Segmento": segment_label(l.get("segmento_interesse")),
                "Orçamento": l.get("orcamento_faixa"),
                "Prazo": l.get("prazo_compra"),
                "Score": l.get("score"),
                "Status": badge_status(l.get("status")),
                "Motivos (resumo)": format_motivos(l.get("score_motivos")),
                "ID": l.get("id"),
            })

        if pd is not None:
            df_display = pd.DataFrame(display)
            # Streamlit grid alinha numero a direita e texto a esquerda.
            # Convertendo "N" para texto, eliminamos o desalinhamento visual com o cabecalho.
            df_display["N"] = df_display["N"].astype(str)
            st.dataframe(
                df_display,
                use_container_width=True,
                hide_index=True,
                column_config={
                    "N": st.column_config.TextColumn("N", width="small"),
                },
            )
        else:
            st.table(display)

        st.markdown("#### Exclusão de registros")
        bulk_delete_options = []
        for l in leads_ui:
            lid = l.get("id")
            if not lid:
                continue
            name = l.get("__ui_nome") or "Lead"
            stt = badge_status(l.get("status"))
            scr = l.get("score")
            seg_lbl = segment_label(l.get("segmento_interesse"))
            ufv = l.get("__ui_uf") or ""
            city = l.get("__ui_cidade") or ""
            label = f"{name} • {seg_lbl} • {city}/{ufv} • {stt} • score={scr} • {str(lid)[:8]}…"
            bulk_delete_options.append((label, lid))

        d1, d2 = st.columns([3, 1])
        bulk_selected_labels = d1.multiselect(
            "Selecione um ou mais leads para excluir",
            [x[0] for x in bulk_delete_options],
            key="bulk_delete_labels",
        )
        bulk_confirm = d2.checkbox("Confirmar exclusão", value=False, key="bulk_delete_confirm")

        if st.button("🗑️ Excluir selecionados", key="btn_bulk_delete"):
            selected_ids = [lid for (lab, lid) in bulk_delete_options if lab in bulk_selected_labels]
            if not selected_ids:
                st.warning("Selecione ao menos um lead para excluir.")
            elif not bulk_confirm:
                st.warning("Marque 'Confirmar exclusão' antes de excluir em lote.")
            else:
                resp, perr = safe_post("/leads/bulk-delete", payload={"ids": selected_ids}, timeout=45)
                if perr:
                    show_error("Não foi possível excluir os leads selecionados agora.", perr)
                else:
                    deleted = int((resp or {}).get("deleted") or 0)
                    not_found = len((resp or {}).get("not_found_ids") or [])
                    invalid = len((resp or {}).get("invalid_ids") or [])
                    st.success(
                        f"Exclusão em lote concluída. Removidos: {deleted} | Não encontrados: {not_found} | Inválidos: {invalid}"
                    )
                    st.rerun()

        st.divider()

        lead_options = []
        for l in leads_ui:
            lid = l.get("id")
            if not lid:
                continue
            name = l.get("__ui_nome") or "Lead"
            stt = badge_status(l.get("status"))
            scr = l.get("score")
            seg_lbl = segment_label(l.get("segmento_interesse"))
            ufv = l.get("__ui_uf") or ""
            city = l.get("__ui_cidade") or ""
            label = f"{name} • {seg_lbl} • {city}/{ufv} • {stt} • score={scr} • {str(lid)[:8]}…"
            lead_options.append((label, lid))

        chosen_label = st.selectbox(
            "Selecionar lead para ações",
            [""] + [x[0] for x in lead_options],
            key="lead_select_label",
        )

        chosen_id = None
        if chosen_label:
            chosen_id = next((lid for (lab, lid) in lead_options if lab == chosen_label), None)

        if chosen_id:
            selected = next((x for x in leads if x.get("id") == chosen_id), None)
            selected_ui = leads_ui_by_id.get(chosen_id, selected or {})
            if not selected:
                st.warning("Não encontrei os detalhes deste lead na lista atual. Clique em \"Atualizar lista\".")
            else:
                score_diag = {}
                diag_payload, _ = safe_get(f"/leads/{chosen_id}/score-diagnostics", timeout=15)
                if isinstance(diag_payload, dict) and isinstance(diag_payload.get("diagnostics"), dict):
                    score_diag = diag_payload.get("diagnostics") or {}

                cA, cB = st.columns([1.2, 1])

                with cA:
                    st.markdown("### Detalhes do lead (sem termos técnicos)")
                    details = {
                        "Nome": selected_ui.get("__ui_nome") or selected.get("nome"),
                        "WhatsApp": selected.get("whatsapp") or "—",
                        "E-mail": selected.get("email") or "—",
                        "UF": selected_ui.get("__ui_uf") or selected.get("uf") or "—",
                        "Cidade": selected_ui.get("__ui_cidade") or selected.get("cidade") or "—",
                        "Segmento": segment_label(selected.get("segmento_interesse")),
                        "Orçamento": selected.get("orcamento_faixa") or "—",
                        "Prazo": selected.get("prazo_compra") or "—",
                        "Score": selected.get("score"),
                        "Status": badge_status(selected.get("status")),
                        "Motor de score": format_score_engine(
                            score_diag.get("engine") if score_diag.get("engine") else selected.get("score_engine")
                        ),
                        "Modelo": sanitize_text(
                            score_diag.get("model_name") if score_diag.get("model_name") else selected.get("score_model_name")
                        ).strip() or "—",
                        "Prob. qualificado": format_score_probability(
                            score_diag.get("probability_qualified")
                            if score_diag.get("probability_qualified") is not None
                            else selected.get("score_probability")
                        ),
                        "Score calculado em": format_score_scored_at(
                            score_diag.get("scored_at") if score_diag.get("scored_at") else selected.get("score_scored_at")
                        ),
                    }
                    kv_table(details)

                with cB:
                    st.markdown("### Ações")
                    st.caption("Fluxo típico: calcular score → handoff (ENVIADO)." )

                    with st.expander("✏️ Editar lead selecionado", expanded=False):
                        def _idx(options, value):
                            try:
                                return options.index(value)
                            except Exception:
                                return 0

                        uf_options = ["", "MG", "SP", "GO"]
                        seg_options = ["CAVALOS", "SERVICOS", "EVENTOS", "EQUIPAMENTOS"]
                        orc_options = ["", "0-5k", "5k-20k", "20k-60k", "60k+"]
                        prazo_options = ["", "7d", "30d", "90d"]

                        current_uf = (selected.get("uf") or "").strip().upper()
                        current_seg = (selected.get("segmento_interesse") or "").strip().upper()
                        current_orc = (selected.get("orcamento_faixa") or "").strip()
                        current_prazo = (selected.get("prazo_compra") or "").strip()

                        if current_uf and current_uf not in uf_options:
                            uf_options.append(current_uf)
                        if current_seg and current_seg not in seg_options:
                            seg_options.append(current_seg)
                        if current_orc and current_orc not in orc_options:
                            orc_options.append(current_orc)
                        if current_prazo and current_prazo not in prazo_options:
                            prazo_options.append(current_prazo)

                        e1, e2 = st.columns(2)
                        edit_nome = e1.text_input(
                            "Nome",
                            value=selected.get("nome") or "",
                            key=f"edit_nome_{chosen_id}",
                        )
                        edit_whatsapp = e1.text_input(
                            "WhatsApp (opcional)",
                            value=selected.get("whatsapp") or "",
                            key=f"edit_whatsapp_{chosen_id}",
                        )
                        edit_email = e1.text_input(
                            "E-mail (opcional)",
                            value=selected.get("email") or "",
                            key=f"edit_email_{chosen_id}",
                        )

                        edit_uf = e2.selectbox(
                            "UF",
                            uf_options,
                            index=_idx(uf_options, current_uf),
                            key=f"edit_uf_{chosen_id}",
                        )
                        edit_cidade = e2.text_input(
                            "Cidade (opcional)",
                            value=selected.get("cidade") or "",
                            key=f"edit_cidade_{chosen_id}",
                        )
                        edit_segmento = e2.selectbox(
                            "Segmento de interesse",
                            seg_options,
                            index=_idx(seg_options, current_seg if current_seg else seg_options[0]),
                            key=f"edit_segmento_{chosen_id}",
                        )
                        edit_orc = e2.selectbox(
                            "Faixa de orçamento",
                            orc_options,
                            index=_idx(orc_options, current_orc),
                            key=f"edit_orc_{chosen_id}",
                        )
                        edit_prazo = e2.selectbox(
                            "Prazo",
                            prazo_options,
                            index=_idx(prazo_options, current_prazo),
                            key=f"edit_prazo_{chosen_id}",
                        )

                        if st.button("💾 Salvar edição do lead", key=f"btn_edit_save_{chosen_id}"):
                            payload = {
                                "nome": (edit_nome or "").strip(),
                                "whatsapp": (edit_whatsapp or "").strip() or None,
                                "email": (edit_email or "").strip() or None,
                                "uf": (edit_uf or "").strip() or None,
                                "cidade": (edit_cidade or "").strip() or None,
                                "segmento_interesse": (edit_segmento or "").strip() or None,
                                "orcamento_faixa": (edit_orc or "").strip() or None,
                                "prazo_compra": (edit_prazo or "").strip() or None,
                            }
                            resp, perr = safe_post(f"/leads/{chosen_id}/update", payload=payload, timeout=15)
                            if perr:
                                show_error("Não foi possível atualizar o lead agora.", perr)
                            else:
                                st.success("Lead atualizado com sucesso! ✅")
                                st.rerun()

                    if st.button("🧠 Calcular/Atualizar score", key="btn_score"):
                        resp, perr = safe_post(f"/leads/{chosen_id}/score", payload=None, timeout=30)
                        if perr:
                            show_error("Não foi possível calcular o score agora.", perr)
                        else:
                            st.success("Score atualizado com sucesso!" )
                            score = resp.get("score") if isinstance(resp, dict) else None
                            status_resp = resp.get("status") if isinstance(resp, dict) else None
                            motivos = resp.get("motivos") if isinstance(resp, dict) else None
                            diag = resp.get("diagnostics") if isinstance(resp, dict) else {}
                            if not isinstance(diag, dict):
                                diag = {}
                            meta = resp.get("meta") if isinstance(resp, dict) else {}
                            if not isinstance(meta, dict):
                                meta = {}

                            m1, m2, m3 = st.columns(3)
                            kpi(m1, "Score", score if score is not None else "—")
                            kpi(m2, "Status", badge_status(status_resp))
                            kpi(m3, "Sugestão", "Priorizar" if (status_resp or "").upper() == "QUALIFICADO" else "Nutrir" )

                            engine_txt = format_score_engine(diag.get("engine") or meta.get("engine"))
                            model_txt = sanitize_text(diag.get("model_name") or meta.get("model_name")).strip() or "—"
                            prob_txt = format_score_probability(
                                diag.get("probability_qualified")
                                if diag.get("probability_qualified") is not None
                                else meta.get("probability_qualified")
                            )
                            st.caption(
                                f"Diagnóstico: motor={engine_txt} | modelo={model_txt} | prob={prob_txt}"
                            )

                            st.markdown("#### Por que este score?" )
                            if motivos and isinstance(motivos, list):
                                for m in motivos:
                                    if not isinstance(m, dict):
                                        continue
                                    fator = m.get("fator", "Fator")
                                    impacto = m.get("impacto", 0)
                                    detalhe = m.get("detalhe", "")
                                    if detalhe:
                                        st.write(f"- **{fator} ({impacto:+})** — {detalhe}" )
                                    else:
                                        st.write(f"- **{fator} ({impacto:+})**" )
                            else:
                                st.info("Sem explicação detalhada disponível agora (motivos vazios)." )

                    if st.button("📤 Handoff (marcar como ENVIADO)", key="btn_handoff"):
                        resp, perr = safe_post("/handoff", payload={"lead_id": chosen_id, "channel": "admin"}, timeout=15)
                        if perr:
                            show_error("Não foi possível concluir o handoff agora.", perr)
                        else:
                            st.success("Lead marcado como ENVIADO. ✅" )
                            st.caption("Próximo passo: atendimento/contato pelo canal definido (WhatsApp, e-mail, etc.)." )

                    if st.button("🗑️ Excluir lead selecionado", key=f"btn_delete_lead_{chosen_id}"):
                        resp, perr = safe_post("/leads/bulk-delete", payload={"ids": [chosen_id]}, timeout=30)
                        if perr:
                            show_error("Não foi possível excluir o lead agora.", perr)
                        else:
                            deleted = int((resp or {}).get("deleted") or 0)
                            if deleted > 0:
                                st.success("Lead excluído com sucesso. ✅")
                                st.rerun()
                            else:
                                st.warning("Nenhum lead foi removido para o ID selecionado.")

                st.markdown("### Explicação do score (detalhada)" )
                motivos = selected.get("score_motivos", []) or []
                if not motivos:
                    st.info("Ainda não há explicação salva para este lead. Clique em \"Calcular/Atualizar score\"." )
                else:
                    for m in motivos:
                        if not isinstance(m, dict):
                            continue
                        fator = m.get("fator", "Fator")
                        impacto = m.get("impacto", 0)
                        detalhe = m.get("detalhe", "")
                        if detalhe:
                            st.write(f"- **{fator} ({impacto:+})** — {detalhe}" )
                        else:
                            st.write(f"- **{fator} ({impacto:+})**" )

# =============================================================================
# PAGE: KANBAN (CRM)
# =============================================================================
elif page == "CRM (Kanban)":
    import datetime as _dt
    import html as _html

    st.subheader("CRM Kanban")
    st.caption("Operacao visual para priorizar atendimento e acompanhar progresso em tempo real.")

    st.markdown(
        """
        <style>
          .crm-toolbar {
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 16px;
            padding: 12px 14px;
            margin-bottom: 12px;
            background:
              radial-gradient(120% 140% at 0% 0%, rgba(60,130,246,0.18), rgba(8,14,28,0.0) 48%),
              radial-gradient(120% 140% at 100% 100%, rgba(15,170,130,0.16), rgba(8,14,28,0.0) 42%),
              rgba(255,255,255,0.02);
          }
          .crm-toolbar-title {
            font-size: 0.92rem;
            font-weight: 800;
            margin-bottom: 0.35rem;
            letter-spacing: 0.1px;
          }
          .kanban-kpi {
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 14px;
            padding: 10px;
            margin-bottom: 0.8rem;
            background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
          }
          .kanban-kpi-title {
            font-size: 0.77rem;
            opacity: 0.78;
            margin-bottom: 2px;
          }
          .kanban-kpi-value {
            font-size: 1.05rem;
            font-weight: 850;
            line-height: 1.2rem;
          }
          .kanban-col-wrap {
            border: 1px solid rgba(255,255,255,0.11);
            border-radius: 18px;
            padding: 10px;
            min-height: 420px;
            background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01));
          }
          .kanban-title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-top: 0.1rem;
            margin-bottom: 0.65rem;
          }
          .kanban-col-title {
            font-size: 0.95rem;
            font-weight: 850;
            letter-spacing: 0.1px;
          }
          .kanban-col-sub {
            font-size: 0.76rem;
            opacity: 0.86;
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 999px;
            padding: 2px 8px;
            background: rgba(255,255,255,0.04);
          }
          .kanban-empty {
            font-size: 0.82rem;
            opacity: 0.75;
            border: 1px dashed rgba(255,255,255,0.16);
            border-radius: 12px;
            padding: 10px;
            text-align: center;
            margin-top: 4px;
          }
          .kanban-card {
            border: 1px solid rgba(255,255,255,0.16);
            border-radius: 14px;
            padding: 11px 11px 10px 11px;
            background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015));
            box-shadow: 0 8px 18px rgba(0,0,0,0.16);
            margin-bottom: 0.62rem;
            transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
          }
          .kanban-card:hover {
            transform: translateY(-1px);
            border-color: rgba(255,255,255,0.28);
            box-shadow: 0 12px 24px rgba(0,0,0,0.22);
          }
          .kanban-name {
            font-weight: 800;
            font-size: 0.97rem;
            margin-bottom: 1px;
            line-height: 1.24rem;
          }
          .kanban-meta {
            font-size: 0.81rem;
            opacity: 0.86;
            line-height: 1.08rem;
          }
          .kanban-chip-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 7px;
          }
          .kanban-chip {
            display: inline-flex;
            align-items: center;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 999px;
            padding: 2px 8px;
            font-size: 0.72rem;
            background: rgba(255,255,255,0.05);
            opacity: 0.95;
          }
          .kanban-next {
            margin-top: 8px;
            border: 1px solid rgba(255,255,255,0.11);
            border-radius: 11px;
            padding: 7px 9px;
            font-size: 0.76rem;
            line-height: 1.1rem;
            background: rgba(255,255,255,0.03);
          }
          .details-stage {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border: 1px solid;
            border-radius: 999px;
            padding: 4px 10px;
            font-weight: 700;
            font-size: 0.82rem;
            margin: 2px 0 10px 0;
            background: rgba(255,255,255,0.03);
          }
        </style>
        """,
        unsafe_allow_html=True,
    )

    STAGE_TO_COL = {"INBOX": "CURIOSO", "AQUECENDO": "AQUECENDO", "QUALIFICADO": "QUALIFICADO", "ENVIADO": "ENVIADO"}
    COL_TO_STAGE = {v: k for k, v in STAGE_TO_COL.items()}
    COL_ORDER = ["CURIOSO", "AQUECENDO", "QUALIFICADO", "ENVIADO"]
    STAGE_OPTIONS = ["INBOX", "AQUECENDO", "QUALIFICADO", "ENVIADO"]

    STAGE_THEME = {
        "CURIOSO": {"icon": "&#128065;", "color": "#6ca8ff"},
        "AQUECENDO": {"icon": "&#128293;", "color": "#ff9f43"},
        "QUALIFICADO": {"icon": "&#9989;", "color": "#2ecc71"},
        "ENVIADO": {"icon": "&#128228;", "color": "#ff5d73"},
    }

    def _status_to_stage(status_value: str) -> str:
        s = (status_value or "").upper().strip()
        if s in ("AQUECENDO", "QUALIFICADO", "ENVIADO"):
            return s
        return "INBOX"

    def _lead_stage(lead: dict) -> str:
        stage = (lead.get("crm_stage") or _status_to_stage(lead.get("status"))).upper().strip()
        return stage if stage in STAGE_TO_COL else "INBOX"

    def _score_value(lead: dict) -> float:
        try:
            return float(lead.get("score")) if lead.get("score") is not None else -1.0
        except Exception:
            return -1.0

    # -----------------------------
    # Carrega board do backend (preferido) e faz fallback para /leads
    # -----------------------------
    items = []
    board, err = safe_get("/crm/board", params={}, timeout=15)

    if not err:
        if isinstance(board, dict) and isinstance(board.get("items"), list):
            items = board.get("items") or []
        elif isinstance(board, list):
            items = board
        else:
            err = f"Formato inesperado em /crm/board: {type(board).__name__}"

    if err:
        fallback, err2 = safe_get("/leads", params={}, timeout=15)
        if not err2:
            if isinstance(fallback, dict) and isinstance(fallback.get("items"), list):
                items = fallback.get("items") or []
            elif isinstance(fallback, list):
                items = fallback
            else:
                show_error(
                    "Nao foi possivel interpretar os dados do CRM.",
                    f"Formato inesperado em /leads: {type(fallback).__name__}",
                )
                items = []
        else:
            show_error("Nao foi possivel carregar o CRM.", f"/crm/board: {err} | /leads: {err2}")
            items = []

    items = [
        decorate_lead_for_ui(it, seed_hint=f"{(it.get('id') or 'lead')}-{_lead_stage(it)}", fill_missing_uf=True)
        for it in items
    ]

    st.markdown("<div class='crm-toolbar'>", unsafe_allow_html=True)
    st.markdown("<div class='crm-toolbar-title'>Filtros rapidos do board</div>", unsafe_allow_html=True)
    f1, f2, f3, f4, f5 = st.columns([2.05, 1.15, 1.3, 0.85, 1.0])
    search_q = f1.text_input(
        "Buscar lead",
        value="",
        key="crm_board_search",
        placeholder="nome, cidade, UF ou segmento",
    )
    stage_filter = f2.selectbox("Etapa", ["Todas"] + COL_ORDER, key="crm_board_stage_filter")
    sort_mode = f3.selectbox(
        "Ordenacao",
        ["Score (maior primeiro)", "Atualizacao (recente)", "Nome (A-Z)"],
        key="crm_board_sort_mode",
    )
    compact_view = f4.checkbox("Compacto", value=False, key="crm_board_compact")
    cards_limit = f5.selectbox("Cards/coluna", [6, 10, 14, 20], index=1, key="crm_board_limit")
    st.markdown("</div>", unsafe_allow_html=True)

    filtered_items = list(items)
    needle = (search_q or "").strip().lower()
    if needle:
        def _matches_query(it: dict) -> bool:
            bucket = " ".join(
                [
                    str(it.get("__ui_nome") or it.get("nome") or ""),
                    str(it.get("__ui_cidade") or it.get("cidade") or ""),
                    str(it.get("__ui_uf") or it.get("uf") or ""),
                    str(it.get("segmento_interesse") or it.get("segmento") or ""),
                    str(it.get("status") or ""),
                    str(it.get("crm_stage") or ""),
                ]
            ).lower()
            return needle in bucket

        filtered_items = [it for it in filtered_items if _matches_query(it)]

    if stage_filter != "Todas":
        selected_stage = COL_TO_STAGE[stage_filter]
        filtered_items = [it for it in filtered_items if _lead_stage(it) == selected_stage]

    if sort_mode == "Score (maior primeiro)":
        filtered_items.sort(key=_score_value, reverse=True)
    elif sort_mode == "Atualizacao (recente)":
        filtered_items.sort(
            key=lambda it: str(it.get("updated_at") or it.get("created_at") or ""),
            reverse=True,
        )
    else:
        filtered_items.sort(key=lambda it: str(it.get("__ui_nome") or it.get("nome") or "").lower())

    # Agrupa itens por coluna
    columns = {c: [] for c in COL_ORDER}
    for it in filtered_items:
        stage = _lead_stage(it)
        col = STAGE_TO_COL[stage]
        columns[col].append(it)

    kpi_cols = st.columns(4)
    for i, cname in enumerate(COL_ORDER):
        meta = STAGE_THEME[cname]
        kpi_cols[i].markdown(
            f"""
            <div class='kanban-kpi' style='border-top: 3px solid {meta['color']};'>
              <div class='kanban-kpi-title'>{meta['icon']} {cname}</div>
              <div class='kanban-kpi-value'>{len(columns[cname])} lead(s)</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    if not filtered_items:
        st.info("Nenhum lead encontrado para os filtros atuais.")

    # -----------------------------
    # Layout: Board (esquerda) | Detalhes (direita)
    # -----------------------------
    board_area, details_area = st.columns([3.45, 1.55], gap="large")

    with board_area:
        cols = st.columns(4, gap="medium")
        for idx, cname in enumerate(COL_ORDER):
            stage_code = COL_TO_STAGE[cname]
            meta = STAGE_THEME[cname]
            with cols[idx]:
                st.markdown(
                    f"""
                    <div class='kanban-col-wrap' style='border-top: 3px solid {meta['color']};'>
                      <div class='kanban-title-row'>
                        <div class='kanban-col-title'>{meta['icon']} {cname}</div>
                        <div class='kanban-col-sub'>{len(columns[cname])}</div>
                      </div>
                    """,
                    unsafe_allow_html=True,
                )

                col_items = list(columns[cname])
                if not col_items:
                    st.markdown("<div class='kanban-empty'>Sem leads nesta etapa</div>", unsafe_allow_html=True)

                hidden_count = 0
                if cards_limit and len(col_items) > cards_limit:
                    hidden_count = len(col_items) - cards_limit
                    col_items = col_items[:cards_limit]

                for lead in col_items:
                    lid = lead.get("id")
                    if not lid:
                        continue

                    nome = _html.escape(sanitize_text(lead.get("__ui_nome") or lead.get("nome") or "Lead"))
                    ufv = _html.escape(sanitize_text((lead.get("__ui_uf") or lead.get("uf") or "").strip()))
                    city = _html.escape(sanitize_text(lead.get("__ui_cidade") or lead.get("cidade") or "-"))
                    seglbl = _html.escape(segment_label(lead.get("segmento_interesse") or lead.get("segmento") or ""))
                    score = lead.get("score")
                    score_txt = str(score) if score is not None else "-"

                    next_text = sanitize_text(lead.get("next_action_text") or "").strip()
                    next_date = sanitize_text(lead.get("next_action_date") or "").strip()
                    next_hour = sanitize_text(lead.get("next_action_time") or "").strip()
                    if next_text or next_date or next_hour:
                        when = " ".join([x for x in [next_date, next_hour] if x]).strip()
                        if when and next_text:
                            next_label = f"{when} - {next_text}"
                        elif when:
                            next_label = when
                        else:
                            next_label = next_text
                    else:
                        next_label = "Nao definida"
                    if len(next_label) > 72:
                        next_label = next_label[:69] + "..."
                    next_label = _html.escape(next_label)

                    card_padding = "8px 9px 8px 9px" if compact_view else "11px 11px 10px 11px"
                    st.markdown(
                        f"""
                        <div class='kanban-card' style='padding: {card_padding};'>
                          <div class='kanban-name'>{nome}</div>
                          <div class='kanban-meta'><b>{city}/{ufv}</b></div>
                          <div class='kanban-chip-row'>
                            <span class='kanban-chip'>{seglbl}</span>
                            <span class='kanban-chip'>score: {score_txt}</span>
                          </div>
                          <div class='kanban-next'><b>Proxima acao:</b> {next_label}</div>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )

                    if st.button("Abrir detalhes", key=f"crm_pick_{lid}", use_container_width=True):
                        st.session_state["crm_selected_id"] = lid
                        st.rerun()

                if hidden_count > 0:
                    st.caption(f"+ {hidden_count} lead(s) ocultos. Refine com filtros para explorar.")

                st.markdown("</div>", unsafe_allow_html=True)

    with details_area:
        st.subheader("Detalhes")
        st.caption("Selecione um lead para ver detalhes, salvar proxima acao e consultar matching.")

        option_source = filtered_items if filtered_items else items
        options = []
        id_by_label = {}
        for lead in option_source:
            lid = lead.get("id")
            if not lid:
                continue
            nome = lead.get("__ui_nome") or lead.get("nome") or "Lead"
            stage_code = _lead_stage(lead)
            stage_label = STAGE_TO_COL.get(stage_code, "CURIOSO")
            score = lead.get("score")
            label = f"{nome} - {stage_label} - score={score if score is not None else '-'} - {str(lid)[:8]}..."
            options.append(label)
            id_by_label[label] = lid

        selected_id_hint = st.session_state.get("crm_selected_id")
        default_idx = 0
        if selected_id_hint and options:
            for i, lab in enumerate(options, start=1):
                if id_by_label.get(lab) == selected_id_hint:
                    default_idx = i
                    break

        chosen_label = st.selectbox(
            "Selecionar lead (CRM)",
            ["- selecione -"] + options,
            index=default_idx,
            key="crm_selected_label",
        )
        chosen_id = None if chosen_label == "- selecione -" else id_by_label.get(chosen_label)
        if chosen_id:
            st.session_state["crm_selected_id"] = chosen_id

        if not chosen_id:
            st.info("Selecione um lead para ver os detalhes.")
        else:
            selected = next((x for x in items if x.get("id") == chosen_id), None)
            stage_code = _lead_stage(selected or {})
            stage_label = STAGE_TO_COL.get(stage_code, "CURIOSO")
            stage_meta = STAGE_THEME.get(stage_label, {"icon": "*", "color": "#9ba3ad"})

            st.markdown(
                f"<div class='details-stage' style='border-color:{stage_meta['color']}; color:{stage_meta['color']};'>{stage_meta['icon']} {stage_label}</div>",
                unsafe_allow_html=True,
            )

            move_idx = STAGE_OPTIONS.index(stage_code) if stage_code in STAGE_OPTIONS else 0
            next_stage = st.selectbox(
                "Mover etapa",
                STAGE_OPTIONS,
                index=move_idx,
                key=f"crm_move_stage_{chosen_id}",
                format_func=lambda v: "CURIOSO" if v == "INBOX" else v,
            )
            if st.button("Atualizar etapa", key=f"crm_move_details_{chosen_id}", use_container_width=True):
                _, perr = safe_post("/crm/move", payload={"lead_id": chosen_id, "stage": next_stage}, timeout=15)
                if perr:
                    show_error("Nao foi possivel mover o lead.", perr)
                else:
                    st.success("Etapa atualizada")
                    st.rerun()

            st.markdown("### Proxima acao")

            txt_key = f"crm_next_text_{chosen_id}"
            date_key = f"crm_next_date_{chosen_id}"
            hour_key = f"crm_next_hour_{chosen_id}"

            if txt_key not in st.session_state:
                st.session_state[txt_key] = ""
            if date_key not in st.session_state:
                st.session_state[date_key] = _dt.date.today()
            if hour_key not in st.session_state:
                st.session_state[hour_key] = "09:00"

            next_text = st.text_input("Texto", key=txt_key, placeholder="Ex.: confirmar interesse via WhatsApp")
            next_date = st.date_input("Data", key=date_key)
            next_hour = st.selectbox(
                "Hora",
                ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"],
                key=hour_key,
            )

            b1, b2 = st.columns(2)
            if b1.button("Salvar proxima acao", key=f"crm_save_next_{chosen_id}", use_container_width=True):
                note = f"NEXT_ACTION|{next_date.isoformat()}|{next_hour}|{(next_text or '').strip()}".strip()
                _, perr = safe_post(f"/crm/leads/{chosen_id}/notes", payload={"note": note}, timeout=15)
                if perr:
                    show_error("Nao foi possivel salvar a proxima acao.", perr)
                else:
                    st.success("Proxima acao salva")

            if b2.button("Limpar", key=f"crm_clear_next_{chosen_id}", use_container_width=True):
                st.session_state[txt_key] = ""
                st.rerun()

            st.divider()
            st.markdown("## Matching de parceiros")
            if "crm_matches_limit" not in st.session_state:
                st.session_state["crm_matches_limit"] = 8
            matches_limit = st.slider(
                "Quantidade de matches exibidos",
                min_value=1,
                max_value=50,
                step=1,
                key="crm_matches_limit",
                help="Ajuste quantos parceiros aparecem no matching deste lead.",
            )

            matches, merr = safe_get(
                f"/crm/leads/{chosen_id}/matches",
                params={"limit": int(matches_limit)},
                timeout=30,
            )
            if merr:
                st.info("Matching nao disponivel agora (endpoint /crm/leads/:id/matches).")
            else:
                mitems = matches.get("items") if isinstance(matches, dict) else matches
                if not mitems:
                    st.info("Sem matches para este lead com os filtros atuais.")
                else:
                    partners_ref, _ = safe_get("/partners", timeout=20)
                    if not isinstance(partners_ref, list):
                        partners_ref = []
                    partner_name_lookup = build_partner_ui_lookup(partners_ref)

                    rows = []
                    for m in (mitems or [])[: int(matches_limit)]:
                        if not isinstance(m, dict):
                            continue
                        rows.append(
                            {
                                "Prioridade": m.get("prioridade") or m.get("priority") or "",
                                "Nome fantasia": resolve_match_partner_name(m, partner_name_lookup),
                                "UF": m.get("uf") or "",
                                "Municipio": m.get("municipio_nome") or m.get("municipio") or "",
                                "CNAE": m.get("cnae_principal") or "",
                                "Score match": m.get("score") or m.get("match_score") or "",
                            }
                        )

                    if pd is not None:
                        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
                    else:
                        st.table(rows)

                    csv_matches = to_csv(rows, columns=list(rows[0].keys()) if rows else None)
                    st.download_button(
                        "Baixar CSV (matches)",
                        data=csv_matches.encode("utf-8-sig") if csv_matches else b"",
                        file_name="partners_matches.csv",
                        mime="text/csv",
                        disabled=(len(rows) == 0),
                        key=f"dl_matches_{chosen_id}",
                    )

elif page == "Parceiros":
    st.subheader("Parceiros")
    st.caption("Explore potenciais parceiros por UF/segmento e exporte CSV (para prospecção)." )

    def clear_partners_filters():
        st.session_state["partners_uf"] = ""
        st.session_state["partners_seg"] = ""
        st.session_state["partners_q"] = ""

    with st.container():
        f1, f2, f3, f4 = st.columns([1, 1, 2, 1])
        uf = f1.selectbox("UF", ["", "MG", "SP", "GO"], key="partners_uf")
        seg = f2.selectbox("Segmento", ["", "CAVALOS", "SERVICOS", "EVENTOS", "EQUIPAMENTOS"], key="partners_seg")
        q = f3.text_input("Busca (nome fantasia ou razão social)", key="partners_q",
                          placeholder="Ex.: haras, sela, clínica, centro equestre..." )
        f4.button("🧽 Limpar filtros", key="partners_clear", on_click=clear_partners_filters)

    params = {}
    if uf:
        params["uf"] = uf
    if seg:
        params["segment"] = seg
    if q:
        params["q"] = q

    topA, topB, topC = st.columns([1, 1, 2])
    refresh = topB.button("🔄 Atualizar", key="refresh_partners")
    if refresh:
        st.toast("Atualizado." )

    partners, err = safe_get("/partners", params=params, timeout=15)
    if err:
        show_error("Não foi possível carregar parceiros agora.", err)
        partners = []

    partners_ui = [decorate_partner_for_ui(p) for p in (partners or [])]
    partners_ui = sorted(partners_ui, key=partner_sort_key)

    export_rows = []
    for p in partners_ui:
        export_rows.append({
            "cnpj": p.get("cnpj"),
            "razao_social": p.get("__ui_razao_social"),
            "nome_fantasia": p.get("__ui_nome_fantasia"),
            "uf": p.get("uf"),
            "municipio_cod": p.get("municipio_cod"),
            "municipio_nome": p.get("municipio_nome"),
            "segmento": p.get("segmento"),
            "prioridade": p.get("prioridade"),
            "cnae_principal": p.get("cnae_principal"),
        })
    csv_data = to_csv(export_rows, columns=list(export_rows[0].keys()) if export_rows else None)

    topA.download_button(
        "⬇️ Baixar CSV (parceiros filtrados)",
        data=csv_data.encode("utf-8-sig") if csv_data else b"",        file_name="partners_filtrados.csv",
        mime="text/csv",
        disabled=(len(export_rows) == 0),
        key="dl_partners_filtered",
    )
    topC.caption("Dica: exporte para usar como lista de prospecção (priorize prioridade 1/2)." )

    st.divider()

    summary, err2 = safe_get("/partners/summary", params={"uf": uf} if uf else {}, timeout=15)
    if err2:
        summary = []

    cA, cB = st.columns([1, 2])

    with cA:
        st.markdown("### Resumo por segmento")
        if not summary:
            st.info("Sem resumo para os filtros atuais." )
        else:
            ordered = sorted(summary, key=lambda x: int((x or {}).get("total", 0) or 0), reverse=True)
            total_partners = sum(int(x.get("total", 0) or 0) for x in ordered if isinstance(x, dict))
            kpi(st, "Total", total_partners)

            cols = st.columns(2)
            idx = 0
            for row in ordered[:4]:
                segname = segment_label(row.get("segmento"))
                tot = int(row.get("total", 0) or 0)
                kpi(cols[idx % 2], segname, tot)
                idx += 1

            st.caption("Obs.: esse resumo ignora a busca por nome (q); ele é baseado no filtro de UF." )

    with cB:
        st.markdown("### Lista de parceiros")
        if not partners_ui:
            st.info("Nenhum parceiro encontrado com os filtros atuais." )
        else:
            view = st.radio(
                "Visualização da tabela",
                ["Compacta (recomendada)", "Completa (mais colunas)"],
                horizontal=True,
                key="partners_view_mode",
                help="A compacta evita truncamento e facilita leitura.",
            )

            display = []
            for p in partners_ui:
                base = {
                    "CNPJ": p.get("cnpj"),
                    "Nome fantasia": p.get("__ui_nome_fantasia") or "—",
                    "Razão social": p.get("__ui_razao_social") or "—",
                    "UF": (p.get("uf") or "").strip(),
                    "Município": p.get("municipio_nome") or p.get("municipio_cod") or "—",
                    "Segmento": segment_label(p.get("segmento")),
                    "Prioridade": p.get("prioridade"),
                    "CNAE principal": p.get("cnae_principal") or "—",
                    "ID": p.get("id"),
                }
                if view == "Compacta (recomendada)":
                    base = {
                        "CNPJ": base["CNPJ"],
                        "Nome fantasia": base["Nome fantasia"],
                        "UF": base["UF"],
                        "Município": base["Município"],
                        "Segmento": base["Segmento"],
                        "Prioridade": base["Prioridade"],
                        "ID": base["ID"],
                    }
                display.append(base)

            if pd is not None:
                st.dataframe(pd.DataFrame(display), use_container_width=True, hide_index=True)
            else:
                st.table(display)

            st.caption("Se precisar, role a tabela para o lado (scroll horizontal) para ver todas as colunas." )

    st.divider()

    if partners_ui:
        partner_options = []
        for p in partners_ui:
            pid = p.get("id")
            if not pid:
                continue
            cnpj = p.get("cnpj") or "—"
            nome = p.get("__ui_nome_fantasia") or p.get("__ui_razao_social") or "Parceiro"
            city = p.get("municipio_nome") or "—"
            ufv = (p.get("uf") or "").strip()
            seglbl = segment_label(p.get("segmento"))
            label = f"{cnpj} • {nome} — {city}/{ufv} • {seglbl} • id={str(pid)[:8]}…"
            partner_options.append((label, pid))

        st.markdown("### Detalhes do parceiro")
        chosen_label = st.selectbox(
            "Selecionar parceiro",
            [""] + [x[0] for x in partner_options],
            key="partner_select_label",
        )

        chosen_id = None
        if chosen_label:
            chosen_id = next((pid for (lab, pid) in partner_options if lab == chosen_label), None)

        if chosen_id:
            selected = next((x for x in partners_ui if x.get("id") == chosen_id), None)
            if selected:
                c1, c2 = st.columns([1, 1])

                with c1:
                    info = {
                        "CNPJ": selected.get("cnpj"),
                        "Nome fantasia": selected.get("__ui_nome_fantasia") or "—",
                        "Razão social": selected.get("__ui_razao_social") or "—",
                        "UF": (selected.get("uf") or "").strip() or "—",
                        "Município": selected.get("municipio_nome") or selected.get("municipio_cod") or "—",
                        "Segmento": segment_label(selected.get("segmento")),
                        "Prioridade": selected.get("prioridade"),
                        "CNAE principal": selected.get("cnae_principal") or "—",
                        "Início da atividade": selected.get("data_inicio_atividade") or "—",
                        "Situação cadastral": selected.get("situacao_cadastral") or "—",
                    }
                    kv_table(info, title="Informações principais")

                with c2:
                    st.markdown("### Contato")
                    dict_to_bullets(selected.get("contato") or {})
                    st.markdown("### Endereço")
                    dict_to_bullets(selected.get("endereco") or {})

# =============================================================================
# PAGE: CRIAR LEAD (DEMO)
# =============================================================================
elif page == "Criar lead (demo)":
    st.subheader("Criar lead (demo)")
    st.caption("Crie um lead de demonstração e (opcionalmente) simule ações do funil." )

    QUICK_TARGET_VARIANTS = {
        "CURIOSO": [
            {
                "label": "Baixa intencao (topo do funil)",
                "uf": "GO",
                "cidade": "Goiania",
                "segmento_interesse": "EVENTOS",
                "orcamento_faixa": "0-5k",
                "prazo_compra": "90d",
                "events": {"page_view_count": 1, "hook_count": 0, "cta_count": 0},
            },
            {
                "label": "Baixo orcamento e baixa urgencia",
                "uf": "MG",
                "cidade": "Montes Claros",
                "segmento_interesse": "SERVICOS",
                "orcamento_faixa": "5k-20k",
                "prazo_compra": "90d",
                "events": {"page_view_count": 1, "hook_count": 0, "cta_count": 1},
            },
            {
                "label": "Sem sinal forte de intencao",
                "uf": "SP",
                "cidade": "Sao Paulo",
                "segmento_interesse": "EQUIPAMENTOS",
                "orcamento_faixa": "0-5k",
                "prazo_compra": "90d",
                "events": {"page_view_count": 0, "hook_count": 0, "cta_count": 0},
            },
        ],
        "AQUECENDO": [
            {
                "label": "Interesse medio com hook",
                "uf": "SP",
                "cidade": "Sao Paulo",
                "segmento_interesse": "SERVICOS",
                "orcamento_faixa": "20k-60k",
                "prazo_compra": "30d",
                "events": {"page_view_count": 1, "hook_count": 0, "cta_count": 2},
            },
            {
                "label": "Interesse crescente",
                "uf": "MG",
                "cidade": "Belo Horizonte",
                "segmento_interesse": "EVENTOS",
                "orcamento_faixa": "5k-20k",
                "prazo_compra": "30d",
                "events": {"page_view_count": 4, "hook_count": 0, "cta_count": 1},
            },
            {
                "label": "Engajamento moderado",
                "uf": "GO",
                "cidade": "Goiania",
                "segmento_interesse": "CAVALOS",
                "orcamento_faixa": "20k-60k",
                "prazo_compra": "90d",
                "events": {"page_view_count": 2, "hook_count": 1, "cta_count": 2},
            },
        ],
        "QUALIFICADO": [
            {
                "label": "Alta intencao completa",
                "uf": "MG",
                "cidade": "Belo Horizonte",
                "segmento_interesse": "CAVALOS",
                "orcamento_faixa": "60k+",
                "prazo_compra": "7d",
                "events": {"page_view_count": 1, "hook_count": 1, "cta_count": 4},
            },
            {
                "label": "Forte intencao comercial",
                "uf": "SP",
                "cidade": "Sao Paulo",
                "segmento_interesse": "EQUIPAMENTOS",
                "orcamento_faixa": "60k+",
                "prazo_compra": "30d",
                "events": {"page_view_count": 1, "hook_count": 0, "cta_count": 4},
            },
            {
                "label": "Proximo de conversao",
                "uf": "GO",
                "cidade": "Goiania",
                "segmento_interesse": "EVENTOS",
                "orcamento_faixa": "20k-60k",
                "prazo_compra": "7d",
                "events": {"page_view_count": 2, "hook_count": 1, "cta_count": 4},
            },
        ],
    }

    def normalize_target_status(value):
        s = sanitize_text(value).strip().upper()
        if s in {"CURIOSO", "AQUECENDO", "QUALIFICADO", "ENVIADO"}:
            return s
        return "CURIOSO"

    def build_quick_payload(target_status, variant, attempt_index):
        import datetime as _dt

        stamp = _dt.datetime.now().strftime("%Y%m%d%H%M%S%f")
        target = normalize_target_status(target_status)
        payload = {
            "nome": f"Lead Demo {target} {stamp}-{attempt_index}",
            "whatsapp": None,
            "email": f"lead.demo.{target.lower()}.{stamp}.{attempt_index}@exemplo.com",
            "uf": variant.get("uf") or "MG",
            "cidade": variant.get("cidade") or None,
            "segmento_interesse": variant.get("segmento_interesse") or "CAVALOS",
            "orcamento_faixa": variant.get("orcamento_faixa") or None,
            "prazo_compra": variant.get("prazo_compra") or None,
        }
        events_flags = variant.get("events") or {
            "page_view_count": 1,
            "hook_count": 1,
            "cta_count": 1,
        }
        return payload, events_flags

    def normalize_event_counts(events_flags):
        raw = events_flags if isinstance(events_flags, dict) else {}

        def _count(count_key, bool_keys):
            direct = raw.get(count_key)
            try:
                n = int(direct)
                return max(0, n)
            except Exception:
                pass
            for key in bool_keys:
                if bool(raw.get(key)):
                    return 1
            return 0

        return {
            "page_view_count": _count("page_view_count", ["page_view"]),
            "hook_count": _count("hook_count", ["hook"]),
            "cta_count": _count("cta_count", ["cta"]),
        }

    def apply_payload_to_form_state(payload, events_flags):
        counts = normalize_event_counts(events_flags)
        st.session_state["create_nome"] = payload.get("nome") or "Visitante Demo"
        st.session_state["create_whatsapp"] = payload.get("whatsapp") or ""
        st.session_state["create_email"] = payload.get("email") or ""
        st.session_state["create_uf"] = payload.get("uf") or "MG"
        st.session_state["create_cidade"] = payload.get("cidade") or ""
        st.session_state["create_seg"] = payload.get("segmento_interesse") or "CAVALOS"
        st.session_state["create_orc"] = payload.get("orcamento_faixa") or ""
        st.session_state["create_prazo"] = payload.get("prazo_compra") or ""
        st.session_state["ev_page_view"] = counts["page_view_count"] > 0
        st.session_state["ev_hook"] = counts["hook_count"] > 0
        st.session_state["ev_cta"] = counts["cta_count"] > 0

    def execute_create_and_score(payload, events_flags):
        counts = normalize_event_counts(events_flags)
        lead, err = safe_post("/leads", payload=payload, timeout=15)
        if err:
            return {"error": err, "error_stage": "create"}

        deduplicated = bool((lead or {}).get("deduplicated"))
        lid = (lead or {}).get("id")
        if not lid:
            return {
                "error": "Lead criado sem ID para continuidade do fluxo.",
                "error_stage": "create",
                "lead": lead,
                "deduplicated": deduplicated,
            }

        if not deduplicated:
            for _ in range(int(counts["page_view_count"] or 0)):
                safe_post("/events", payload={"lead_id": lid, "event_type": "page_view"}, timeout=10)
            for _ in range(int(counts["hook_count"] or 0)):
                safe_post("/events", payload={"lead_id": lid, "event_type": "hook_complete"}, timeout=10)
            for _ in range(int(counts["cta_count"] or 0)):
                safe_post("/events", payload={"lead_id": lid, "event_type": "cta_click"}, timeout=10)

        score_resp, perr = safe_post(f"/leads/{lid}/score", payload=None, timeout=30)
        if perr:
            return {
                "error": perr,
                "error_stage": "score",
                "lead": lead,
                "deduplicated": deduplicated,
            }

        return {
            "error": None,
            "lead": lead,
            "deduplicated": deduplicated,
            "score_resp": score_resp,
        }

    def render_create_result(result, target_status="", attempt_index=1, total_attempts=1, profile_label=""):
        lead = result.get("lead") or {}
        deduplicated = bool(result.get("deduplicated"))
        score_resp = result.get("score_resp") if isinstance(result.get("score_resp"), dict) else None

        if deduplicated:
            st.warning("Lead ja existente reaproveitado (sem duplicidade)." )
            st.caption("Eventos do funil nao foram reenviados para evitar duplicidade." )
        else:
            st.success("Lead criado com sucesso!" )

        st.write(
            f"**Nome:** {lead.get('nome')}  |  **Segmento:** {segment_label(lead.get('segmento_interesse'))}  |  **UF:** {lead.get('uf')}"
        )

        if not score_resp:
            show_error("Lead salvo, mas não consegui calcular o score automaticamente.", result.get("error"))
            return

        score = score_resp.get("score")
        status_resp = normalize_target_status(score_resp.get("status"))
        motivos = score_resp.get("motivos") or []
        meta = score_resp.get("meta") if isinstance(score_resp.get("meta"), dict) else {}

        engine_txt = format_score_engine(meta.get("engine"))
        model_txt = format_ml_model_label(meta.get("model_name"))
        prob_txt = format_score_probability(meta.get("probability_qualified"))

        m1, m2, m3, m4 = st.columns(4)
        kpi(m1, "Score", score if score is not None else "—")
        kpi(m2, "Status", badge_status(status_resp))
        kpi(m3, "Próxima ação", "Priorizar atendimento" if status_resp == "QUALIFICADO" else "Nutrir interesse")
        kpi(m4, "Modelo", model_txt)

        st.caption(f"Motor: {engine_txt} | Prob. qualificado: {prob_txt}")

        if target_status:
            target_norm = normalize_target_status(target_status)
            hit = status_resp == target_norm
            outcome_txt = "Alvo atingido" if hit else "Alvo nao atingido"
            st.caption(
                f"{outcome_txt} | Alvo: {target_norm} | Previsto: {status_resp} | Tentativa: {attempt_index}/{total_attempts} | Perfil: {profile_label or '-'}"
            )

        st.markdown("#### Motivos principais" )
        if motivos and isinstance(motivos, list):
            for m in motivos:
                if not isinstance(m, dict):
                    continue
                fator = m.get("fator", "Fator")
                impacto = m.get("impacto", 0)
                detalhe = m.get("detalhe", "")
                if detalhe:
                    st.write(f"- **{fator} ({impacto:+})** — {detalhe}" )
                else:
                    st.write(f"- **{fator} ({impacto:+})**" )
        else:
            st.caption("Sem motivos detalhados disponíveis." )

    st.markdown("#### Atalhos inteligentes por status (considera ML)")
    st.caption(
        "Cada atalho preenche automaticamente o perfil, cria o lead e calcula o score com o modelo de ML. "
        "Quando necessário, o sistema tenta variações para aproximar o status alvo."
    )
    q1, q2, q3 = st.columns(3)
    quick_target = None
    if q1.button("Gerar CURIOSO", key="quick_create_curioso"):
        quick_target = "CURIOSO"
    if q2.button("Gerar AQUECENDO", key="quick_create_aquecendo"):
        quick_target = "AQUECENDO"
    if q3.button("Gerar QUALIFICADO", key="quick_create_qualificado"):
        quick_target = "QUALIFICADO"

    if quick_target:
        variants = QUICK_TARGET_VARIANTS.get(quick_target, [])
        total_attempts = len(variants)
        last_result = None
        matched = False

        with st.spinner(f"Gerando lead para alvo {quick_target} com presets inteligentes..."):
            for idx, variant in enumerate(variants, start=1):
                payload, events_flags = build_quick_payload(quick_target, variant, idx)
                apply_payload_to_form_state(payload, events_flags)

                result = execute_create_and_score(payload, events_flags)
                result["profile_label"] = variant.get("label") or ""
                result["attempt_index"] = idx
                result["total_attempts"] = total_attempts
                if result.get("error") and result.get("error_stage") == "create":
                    continue

                last_result = result

                score_resp = result.get("score_resp") if isinstance(result.get("score_resp"), dict) else {}
                predicted = normalize_target_status(score_resp.get("status"))
                if not result.get("error") and predicted == quick_target:
                    matched = True
                    break

        if last_result is None:
            st.error("Nao foi possivel gerar o lead por atalho no momento.")
        else:
            score_resp = last_result.get("score_resp") if isinstance(last_result.get("score_resp"), dict) else {}
            predicted = normalize_target_status(score_resp.get("status"))
            if matched:
                st.success(f"Lead alvo {quick_target} gerado com sucesso.")
            else:
                st.warning(
                    f"Lead criado com status previsto {predicted}. "
                    f"Voce pode ajustar o formulario manualmente para aproximar de {quick_target}."
                )

            render_create_result(
                last_result,
                target_status=quick_target,
                attempt_index=int(last_result.get("attempt_index") or 1),
                total_attempts=int(last_result.get("total_attempts") or max(total_attempts, 1)),
                profile_label=last_result.get("profile_label") or "",
            )

    c1, c2 = st.columns(2)

    nome = c1.text_input("Nome", "Visitante Demo", key="create_nome")
    whatsapp = c1.text_input("WhatsApp (opcional)", "", key="create_whatsapp")
    email = c1.text_input("E-mail (opcional)", "", key="create_email")

    uf = c2.selectbox("UF", ["MG", "SP", "GO"], key="create_uf")
    cidade = c2.text_input("Cidade (opcional)", "", key="create_cidade")
    segmento = c2.selectbox("Segmento de interesse", ["CAVALOS", "SERVICOS", "EVENTOS", "EQUIPAMENTOS"], key="create_seg")

    orc = c1.selectbox("Faixa de orçamento", ["", "0-5k", "5k-20k", "20k-60k", "60k+"], key="create_orc")
    prazo = c2.selectbox("Prazo", ["", "7d", "30d", "90d"], key="create_prazo")

    st.markdown("#### Simular ações do funil (para o score fazer sentido)" )
    ev1, ev2, ev3 = st.columns(3)
    do_page_view = ev1.checkbox("Visita (page view)", value=True, key="ev_page_view")
    do_hook = ev2.checkbox("Completou o quiz/calculadora (hook)", value=True, key="ev_hook")
    do_cta = ev3.checkbox("Clique no CTA/WhatsApp", value=True, key="ev_cta")

    if st.button("✅ Criar lead e simular funil", key="create_btn"):
        payload = {
            "nome": nome,
            "whatsapp": whatsapp or None,
            "email": email or None,
            "uf": uf,
            "cidade": cidade or None,
            "segmento_interesse": segmento,
            "orcamento_faixa": orc or None,
            "prazo_compra": prazo or None,
        }
        events_flags = {
            "page_view": bool(do_page_view),
            "hook": bool(do_hook),
            "cta": bool(do_cta),
        }
        result = execute_create_and_score(payload, events_flags)
        if result.get("error") and result.get("error_stage") == "create":
            show_error("Não foi possível criar o lead agora.", result.get("error"))
        else:
            render_create_result(result)

    st.divider()
    st.markdown("#### Gerar massa de leads para treino de ML")
    st.caption("Cria uma base sintética com distribuição realista entre CURIOSO, AQUECENDO, QUALIFICADO e ENVIADO.")

    bulk_c1, bulk_c2 = st.columns([1, 1])
    bulk_n = bulk_c1.number_input(
        "Quantidade de leads para gerar",
        min_value=1,
        max_value=3000,
        value=450,
        step=50,
        key="bulk_seed_n",
    )
    bulk_replace = bulk_c2.checkbox(
        "Limpar leads atuais antes de gerar",
        value=False,
        key="bulk_seed_replace",
    )

    bulk_act1, bulk_act2 = st.columns([1, 1])

    if bulk_act1.button("🧪 Gerar massa de leads", key="bulk_seed_btn"):
        payload = {"n": int(bulk_n), "replace": bool(bulk_replace)}
        resp, err = safe_post("/demo/seed-leads", payload=payload, timeout=180)
        if err:
            show_error("Não foi possível gerar a massa de leads agora.", err)
        else:
            st.success(resp.get("message") or "Massa de leads gerada com sucesso.")
            by_status = (resp or {}).get("by_status") or {}
            summary_rows = [
                {"Status": "CURIOSO", "Total": int(by_status.get("CURIOSO", 0) or 0)},
                {"Status": "AQUECENDO", "Total": int(by_status.get("AQUECENDO", 0) or 0)},
                {"Status": "QUALIFICADO", "Total": int(by_status.get("QUALIFICADO", 0) or 0)},
                {"Status": "ENVIADO", "Total": int(by_status.get("ENVIADO", 0) or 0)},
            ]
            st.caption(
                f"Eventos inseridos: {int((resp or {}).get('events_inserted') or 0)} | "
                f"Total atual de leads: {int((resp or {}).get('total_leads') or 0)}"
            )
            if pd is not None:
                st.dataframe(pd.DataFrame(summary_rows), use_container_width=True, hide_index=True)
            else:
                st.table(summary_rows)

    if bulk_act2.button("♻️ Resetar apenas leads sintéticos", key="bulk_reset_seed_btn"):
        resp, err = safe_post("/demo/reset-seeded-leads", payload={"dry_run": False}, timeout=120)
        if err:
            show_error("Não foi possível resetar os leads sintéticos.", err)
        else:
            st.success(resp.get("message") or "Leads sintéticos removidos com sucesso.")
            deleted = (resp or {}).get("deleted") or {}
            rows = [
                {"Item": "Leads", "Removidos": int(deleted.get("leads", 0) or 0)},
                {"Item": "Eventos", "Removidos": int(deleted.get("events", 0) or 0)},
                {"Item": "Notas", "Removidos": int(deleted.get("lead_notes", 0) or 0)},
                {"Item": "CRM Notas", "Removidos": int(deleted.get("crm_lead_notes", 0) or 0)},
                {"Item": "CRM Estado", "Removidos": int(deleted.get("crm_lead_state", 0) or 0)},
            ]
            st.caption(f"Total atual de leads: {int((resp or {}).get('total_leads') or 0)}")
            if pd is not None:
                st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
            else:
                st.table(rows)

# =============================================================================
# PAGE: ROTEIRO DE DEMO
# =============================================================================
else:
    st.subheader("Roteiro de demo (para o pitch)")
    st.caption("Use esta página para apresentar o produto sem se perder — 100% guiado." )

    PITCH_TARGET_VARIANTS = {
        "CURIOSO": [
            {
                "label": "Topo do funil (baixa intencao)",
                "uf": "GO",
                "cidade": "Goiania",
                "segmento_interesse": "EVENTOS",
                "orcamento_faixa": "0-5k",
                "prazo_compra": "90d",
                "events": {"page_view_count": 1, "hook_count": 0, "cta_count": 0},
            },
            {
                "label": "Baixo orcamento e baixa urgencia",
                "uf": "MG",
                "cidade": "Montes Claros",
                "segmento_interesse": "SERVICOS",
                "orcamento_faixa": "5k-20k",
                "prazo_compra": "90d",
                "events": {"page_view_count": 1, "hook_count": 0, "cta_count": 1},
            },
            {
                "label": "Sem sinal forte de intencao",
                "uf": "SP",
                "cidade": "Sao Paulo",
                "segmento_interesse": "EQUIPAMENTOS",
                "orcamento_faixa": "0-5k",
                "prazo_compra": "90d",
                "events": {"page_view_count": 0, "hook_count": 0, "cta_count": 0},
            },
        ],
        "AQUECENDO": [
            {
                "label": "Interesse medio com hook",
                "uf": "SP",
                "cidade": "Sao Paulo",
                "segmento_interesse": "SERVICOS",
                "orcamento_faixa": "20k-60k",
                "prazo_compra": "30d",
                "events": {"page_view_count": 1, "hook_count": 0, "cta_count": 2},
            },
            {
                "label": "Interesse crescente",
                "uf": "MG",
                "cidade": "Belo Horizonte",
                "segmento_interesse": "EVENTOS",
                "orcamento_faixa": "5k-20k",
                "prazo_compra": "30d",
                "events": {"page_view_count": 4, "hook_count": 0, "cta_count": 1},
            },
            {
                "label": "Engajamento moderado",
                "uf": "GO",
                "cidade": "Goiania",
                "segmento_interesse": "CAVALOS",
                "orcamento_faixa": "20k-60k",
                "prazo_compra": "90d",
                "events": {"page_view_count": 2, "hook_count": 1, "cta_count": 2},
            },
        ],
        "QUALIFICADO": [
            {
                "label": "Alta intencao completa",
                "uf": "MG",
                "cidade": "Belo Horizonte",
                "segmento_interesse": "CAVALOS",
                "orcamento_faixa": "60k+",
                "prazo_compra": "7d",
                "events": {"page_view_count": 1, "hook_count": 1, "cta_count": 4},
            },
            {
                "label": "Forte intencao comercial",
                "uf": "SP",
                "cidade": "Sao Paulo",
                "segmento_interesse": "EQUIPAMENTOS",
                "orcamento_faixa": "60k+",
                "prazo_compra": "30d",
                "events": {"page_view_count": 1, "hook_count": 0, "cta_count": 4},
            },
            {
                "label": "Proximo de conversao",
                "uf": "GO",
                "cidade": "Goiania",
                "segmento_interesse": "EVENTOS",
                "orcamento_faixa": "20k-60k",
                "prazo_compra": "7d",
                "events": {"page_view_count": 2, "hook_count": 1, "cta_count": 4},
            },
        ],
    }

    PITCH_STATUS_RANK = {"CURIOSO": 0, "AQUECENDO": 1, "QUALIFICADO": 2, "ENVIADO": 3}

    def normalize_pitch_status(value):
        s = sanitize_text(value).strip().upper()
        if s in {"CURIOSO", "AQUECENDO", "QUALIFICADO", "ENVIADO"}:
            return s
        return "CURIOSO"

    def build_pitch_payload(target_status, variant, attempt_index):
        import datetime as _dt

        stamp = _dt.datetime.now().strftime("%Y%m%d%H%M%S%f")
        target = normalize_pitch_status(target_status)
        return {
            "nome": f"Pitch {target} {stamp}-{attempt_index}",
            "whatsapp": None,
            "email": f"pitch.{target.lower()}.{stamp}.{attempt_index}@exemplo.com",
            "uf": variant.get("uf") or "MG",
            "cidade": variant.get("cidade") or None,
            "segmento_interesse": variant.get("segmento_interesse") or "CAVALOS",
            "orcamento_faixa": variant.get("orcamento_faixa") or None,
            "prazo_compra": variant.get("prazo_compra") or None,
        }

    def normalize_pitch_event_counts(events_flags):
        if isinstance(events_flags, dict):
            raw = events_flags
        elif isinstance(events_flags, list):
            lowered = [sanitize_text(ev).strip().lower() for ev in events_flags]
            raw = {
                "page_view_count": sum(1 for ev in lowered if ev == "page_view"),
                "hook_count": sum(1 for ev in lowered if ev == "hook_complete"),
                "cta_count": sum(1 for ev in lowered if ev in {"cta_click", "whatsapp_click"}),
            }
        else:
            raw = {}

        def _count(count_key, bool_keys):
            direct = raw.get(count_key)
            try:
                n = int(direct)
                return max(0, n)
            except Exception:
                pass
            for key in bool_keys:
                if bool(raw.get(key)):
                    return 1
            return 0

        return {
            "page_view_count": _count("page_view_count", ["page_view"]),
            "hook_count": _count("hook_count", ["hook", "hook_complete"]),
            "cta_count": _count("cta_count", ["cta", "cta_click", "whatsapp_click"]),
        }

    def create_and_score_pitch(payload, events_flags):
        counts = normalize_pitch_event_counts(events_flags)
        lead, err = safe_post("/leads", payload=payload, timeout=15)
        if err:
            return {"error": err, "error_stage": "create", "lead": None}

        deduplicated = bool((lead or {}).get("deduplicated"))
        lid = (lead or {}).get("id")
        if not lid:
            return {
                "error": "Lead criado sem ID para continuidade do fluxo.",
                "error_stage": "create",
                "lead": lead,
                "deduplicated": deduplicated,
            }

        if not deduplicated:
            for _ in range(int(counts["page_view_count"] or 0)):
                safe_post("/events", payload={"lead_id": lid, "event_type": "page_view"}, timeout=10)
            for _ in range(int(counts["hook_count"] or 0)):
                safe_post("/events", payload={"lead_id": lid, "event_type": "hook_complete"}, timeout=10)
            for _ in range(int(counts["cta_count"] or 0)):
                safe_post("/events", payload={"lead_id": lid, "event_type": "cta_click"}, timeout=10)

        scored, perr = safe_post(f"/leads/{lid}/score", payload=None, timeout=30)
        if perr:
            return {
                "error": perr,
                "error_stage": "score",
                "lead": lead,
                "deduplicated": deduplicated,
                "score_resp": None,
            }
        return {
            "error": None,
            "error_stage": None,
            "lead": lead,
            "deduplicated": deduplicated,
            "score_resp": scored if isinstance(scored, dict) else {},
        }

    def summarize_pitch_row(target_status, variant_label, attempt_index, total_attempts, result):
        lead = result.get("lead") or {}
        score_resp = result.get("score_resp") if isinstance(result.get("score_resp"), dict) else {}
        meta = score_resp.get("meta") if isinstance(score_resp.get("meta"), dict) else {}
        predicted = normalize_pitch_status(score_resp.get("status"))
        engine_txt = format_score_engine(meta.get("engine"))
        model_txt = format_ml_model_label(meta.get("model_name"))
        prob_txt = format_score_probability(meta.get("probability_qualified"))
        score_value = score_resp.get("score")
        obs = "ok"
        if result.get("error"):
            obs = f"erro {result.get('error_stage')}"
        elif result.get("deduplicated"):
            obs = "lead reaproveitado"
        return (
            {
                "Alvo": target_status,
                "Previsto": badge_status(predicted),
                "Score": score_value if score_value is not None else "—",
                "Modelo": model_txt,
                "Motor": engine_txt,
                "Prob. qualificado": prob_txt,
                "Tentativa": f"{attempt_index}/{total_attempts}",
                "Perfil": variant_label or "-",
                "Lead": sanitize_text(lead.get("nome")) or "-",
                "Observacao": obs,
            },
            predicted,
        )

    def run_pitch_target(target_status, variants):
        target = normalize_pitch_status(target_status)
        variants = variants or []
        total = max(1, len(variants))
        best_pack = None
        best_distance = 999

        for idx, variant in enumerate(variants, start=1):
            payload = build_pitch_payload(target, variant, idx)
            result = create_and_score_pitch(payload, variant.get("events") or [])

            row, predicted = summarize_pitch_row(
                target, variant.get("label") or "", idx, total, result
            )

            if result.get("error") and result.get("error_stage") == "create":
                continue

            distance = abs(
                int(PITCH_STATUS_RANK.get(predicted, 0))
                - int(PITCH_STATUS_RANK.get(target, 0))
            )
            if distance < best_distance:
                best_distance = distance
                best_pack = (row, result, predicted)

            if predicted == target and not result.get("error"):
                return row, result, predicted, True

        if best_pack:
            return best_pack[0], best_pack[1], best_pack[2], False
        return None, None, None, False

    st.markdown("### 1) Atalhos por status (pitch orientado por ML)")
    st.caption(
        "Cada botão cria automaticamente um lead no status alvo, usando presets e tentativa inteligente para o modelo em produção."
    )
    p1, p2, p3 = st.columns(3)
    pitch_target = None
    if p1.button("Gerar CURIOSO", key="pitch_target_curioso"):
        pitch_target = "CURIOSO"
    if p2.button("Gerar AQUECENDO", key="pitch_target_aquecendo"):
        pitch_target = "AQUECENDO"
    if p3.button("Gerar QUALIFICADO", key="pitch_target_qualificado"):
        pitch_target = "QUALIFICADO"

    if pitch_target:
        row, result, predicted, hit = run_pitch_target(
            pitch_target, PITCH_TARGET_VARIANTS.get(pitch_target, [])
        )
        if row:
            if hit:
                st.success(f"Alvo {pitch_target} atingido com sucesso.")
            else:
                st.warning(
                    f"Lead criado com status previsto {predicted}. "
                    f"Use o resultado como aproximação do alvo {pitch_target}."
                )

            if result and result.get("error") and result.get("error_stage") == "score":
                show_error("Lead criado, mas houve falha ao calcular score.", result.get("error"))

            if pd is not None:
                st.dataframe(pd.DataFrame([row]), use_container_width=True, hide_index=True)
            else:
                st.table([row])
        else:
            st.error("Nao foi possivel gerar o lead por atalho no momento.")

    st.markdown("### 2) Gerar cenário completo em 1 clique")
    st.write("Cria os 3 perfis (CURIOSO, AQUECENDO, QUALIFICADO) com diagnóstico do ML para o pitch." )

    col1, col2 = st.columns([1, 1])
    if col1.button("🚀 Criar cenário de demo (3 leads)", key="demo_create_3"):
        targets = ["QUALIFICADO", "AQUECENDO", "CURIOSO"]
        rows = []
        hits = 0

        for target in targets:
            row, result, predicted, hit = run_pitch_target(target, PITCH_TARGET_VARIANTS.get(target, []))
            if row:
                rows.append(row)
            if hit:
                hits += 1
            if result and result.get("error") and result.get("error_stage") == "score":
                show_error(f"Falha parcial no score do alvo {target}.", result.get("error"))

        if rows:
            if hits == len(targets):
                st.success("Cenário criado com todos os alvos atingidos.")
            else:
                st.warning(
                    f"Cenário criado com {hits}/{len(targets)} alvos atingidos. "
                    "Mesmo assim, a demonstração está pronta para o pitch."
                )

            if pd is not None:
                st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
            else:
                st.table(rows)

    if col2.button("🧹 Reset demo (limpar leads/parceiros demo)", key="demo_reset_btn"):
        resp, err = safe_post("/demo/reset", payload=None, timeout=30)
        if err:
            st.warning("Seu backend ainda não tem o endpoint **/demo/reset**." )
            st.caption("Sugestão: crie esse endpoint para limpar dados de demo e reiniciar a apresentação com 1 clique." )
        else:
            st.success("Demo resetada com sucesso! ✅" )

    st.divider()

    st.markdown("### 3) O que mostrar (ordem recomendada)")
    st.markdown(
        """
        1. **Visão geral**: KPIs (total, qualificados, conversão).
        2. **Leads**: filtre por **✅ QUALIFICADO** e mostre o detalhe + motivos do score.
        3. **Handoff**: clique em "📤 Handoff" para simular envio para atendimento.
        4. **Parceiros**: filtre por UF/segmento e exporte CSV.
        5. **Export CSV**: baixe "leads_filtrados.csv" como evidência de produto.
        """
    )

    st.markdown("### 4) Checklist rápido (antes de apresentar)")
    st.markdown(
        """
        - Backend UP: `http://localhost:3000/health`
        - UI OK: `http://localhost:8501`
        - Criar cenário demo: botão nesta página
        - Abrir **Leads** e filtrar por status/score
        - Mostrar motivos do score (explicabilidade)
        """
    )
