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
import requests
import streamlit as st
import json
from io import StringIO

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
        # PT-BR: Nunca exibimos dict/list “cru”; convertemos para string JSON legível.
        # ES:    Nunca mostramos dict/list “en bruto”; lo convertimos a string JSON legible.
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


def badge_status(status: str) -> str:
    """
    PT-BR: Converte status comercial em “badge” visual padronizado (emoji + rótulo).
    ES:    Convierte el estado comercial en “badge” visual estandar (emoji + etiqueta).
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
    PT-BR: Converte dict em bullets para leitura rápida no painel (sem JSON “cru”).
    ES:    Convierte un diccionario en bullets para lectura rápida en el panel (sin JSON “crudo”).
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


# =============================================================================
# CSS / TEMA
# =============================================================================
def apply_css(presentation_light: bool):
    """
    PT-BR: Aplica CSS base e, opcionalmente, uma variante clara (“modo apresentação”)
           para maior legibilidade em projetor/telão.
    ES:    Aplica CSS base y, opcionalmente, una variante clara (“modo presentación”)
           para mejor legibilidad en proyector/pantalla.
    EN:    Applies base CSS and, optionally, a light variant (“presentation mode”)
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
      /* melhora legibilidade no sidebar */
      [data-testid="stSidebar"] * { color: rgba(255,255,255,0.92); }
      [data-testid="stSidebar"] .stCaption { color: rgba(255,255,255,0.70) !important; }

      /* evita “apagado” no rádio em alguns temas */
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

          /* cards */
          .kpi-card {
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
st.sidebar.title("Growth Equestre (MVP)")
st.sidebar.caption("Admin • MG/SP/GO • Funil + Lead Scoring + Parceiros")

page = st.sidebar.radio(
    "Navegação",
    ["Visão geral", "Leads", "Parceiros", "Criar lead (demo)", "Roteiro de demo"],
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
    leads, err = safe_get("/leads", params={}, timeout=15)
    if err:
        show_error("Não foi possível carregar os dados agora. Tente novamente.", err)
        leads = []

    total = len(leads)
    qualificados = sum(1 for l in leads if (l.get("status") or "").upper() == "QUALIFICADO")
    aquecendo = sum(1 for l in leads if (l.get("status") or "").upper() == "AQUECENDO")
    enviados = sum(1 for l in leads if (l.get("status") or "").upper() == "ENVIADO")
    conversao = (qualificados / total * 100) if total else 0.0

    colA, colB, colC, colD = st.columns(4)
    kpi(colA, "Leads (total)", total)
    kpi(colB, "Qualificados", qualificados)
    kpi(colC, "Aquecendo", aquecendo)
    kpi(colD, "Conversão p/ qualificado", f"{conversao:.1f}%")

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
        for l in leads:
            display.append({
                "Nome": l.get("nome"),
                "UF": l.get("uf"),
                "Cidade": l.get("cidade"),
                "Segmento": segment_label(l.get("segmento_interesse")),
                "Orçamento": l.get("orcamento_faixa"),
                "Prazo": l.get("prazo_compra"),
                "Score": l.get("score"),
                "Status": badge_status(l.get("status")),
                "Motivos (resumo)": format_motivos(l.get("score_motivos")),
                "ID": l.get("id"),
            })

        if pd is not None:
            st.dataframe(pd.DataFrame(display), use_container_width=True, hide_index=True)
        else:
            st.table(display)

        st.divider()

        lead_options = []
        for l in leads:
            lid = l.get("id")
            if not lid:
                continue
            name = l.get("nome") or "Lead"
            stt = badge_status(l.get("status"))
            scr = l.get("score")
            seg_lbl = segment_label(l.get("segmento_interesse"))
            ufv = l.get("uf") or ""
            city = l.get("cidade") or ""
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
            if not selected:
                st.warning("Não encontrei os detalhes deste lead na lista atual. Clique em “Atualizar lista”.")
            else:
                cA, cB = st.columns([1.2, 1])

                with cA:
                    st.markdown("### Detalhes do lead (sem termos técnicos)")
                    details = {
                        "Nome": selected.get("nome"),
                        "WhatsApp": selected.get("whatsapp") or "—",
                        "E-mail": selected.get("email") or "—",
                        "UF": selected.get("uf") or "—",
                        "Cidade": selected.get("cidade") or "—",
                        "Segmento": segment_label(selected.get("segmento_interesse")),
                        "Orçamento": selected.get("orcamento_faixa") or "—",
                        "Prazo": selected.get("prazo_compra") or "—",
                        "Score": selected.get("score"),
                        "Status": badge_status(selected.get("status")),
                    }
                    kv_table(details)

                with cB:
                    st.markdown("### Ações")
                    st.caption("Fluxo típico: calcular score → handoff (ENVIADO)." )

                    if st.button("🧠 Calcular/Atualizar score", key="btn_score"):
                        resp, perr = safe_post(f"/leads/{chosen_id}/score", payload=None, timeout=30)
                        if perr:
                            show_error("Não foi possível calcular o score agora.", perr)
                        else:
                            st.success("Score atualizado com sucesso!" )
                            score = resp.get("score") if isinstance(resp, dict) else None
                            status_resp = resp.get("status") if isinstance(resp, dict) else None
                            motivos = resp.get("motivos") if isinstance(resp, dict) else None

                            m1, m2, m3 = st.columns(3)
                            kpi(m1, "Score", score if score is not None else "—")
                            kpi(m2, "Status", badge_status(status_resp))
                            kpi(m3, "Sugestão", "Priorizar" if (status_resp or "").upper() == "QUALIFICADO" else "Nutrir" )

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

                st.markdown("### Explicação do score (detalhada)" )
                motivos = selected.get("score_motivos", []) or []
                if not motivos:
                    st.info("Ainda não há explicação salva para este lead. Clique em “Calcular/Atualizar score”." )
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
# PAGE: PARCEIROS
# =============================================================================
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

    export_rows = []
    for p in partners:
        export_rows.append({
            "cnpj": p.get("cnpj"),
            "razao_social": p.get("razao_social"),
            "nome_fantasia": p.get("nome_fantasia"),
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
        if not partners:
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
            for p in partners:
                base = {
                    "CNPJ": p.get("cnpj"),
                    "Nome fantasia": p.get("nome_fantasia") or "—",
                    "Razão social": p.get("razao_social") or "—",
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

    if partners:
        partner_options = []
        for p in partners:
            pid = p.get("id")
            if not pid:
                continue
            cnpj = p.get("cnpj") or "—"
            nome = p.get("nome_fantasia") or p.get("razao_social") or "Parceiro"
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
            selected = next((x for x in partners if x.get("id") == chosen_id), None)
            if selected:
                c1, c2 = st.columns([1, 1])

                with c1:
                    info = {
                        "CNPJ": selected.get("cnpj"),
                        "Nome fantasia": selected.get("nome_fantasia") or "—",
                        "Razão social": selected.get("razao_social") or "—",
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

        lead, err = safe_post("/leads", payload=payload, timeout=15)
        if err:
            show_error("Não foi possível criar o lead agora.", err)
        else:
            st.success("Lead criado com sucesso!" )
            st.write(f"**Nome:** {lead.get('nome')}  |  **Segmento:** {segment_label(lead.get('segmento_interesse'))}  |  **UF:** {lead.get('uf')}" )

            lid = lead.get("id")
            if lid:
                if do_page_view:
                    safe_post("/events", payload={"lead_id": lid, "event_type": "page_view"}, timeout=10)
                if do_hook:
                    safe_post("/events", payload={"lead_id": lid, "event_type": "hook_complete"}, timeout=10)
                if do_cta:
                    safe_post("/events", payload={"lead_id": lid, "event_type": "cta_click"}, timeout=10)

                resp, perr = safe_post(f"/leads/{lid}/score", payload=None, timeout=30)
                if perr:
                    show_error("Lead criado, mas não consegui calcular o score automaticamente.", perr)
                else:
                    st.success("Score calculado automaticamente ✅" )
                    score = resp.get("score")
                    status_resp = resp.get("status")
                    motivos = resp.get("motivos") or []

                    m1, m2, m3 = st.columns(3)
                    kpi(m1, "Score", score if score is not None else "—")
                    kpi(m2, "Status", badge_status(status_resp))
                    kpi(m3, "Próxima ação", "Priorizar atendimento" if (status_resp or "").upper() == "QUALIFICADO" else "Nutrir interesse" )

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

# =============================================================================
# PAGE: ROTEIRO DE DEMO
# =============================================================================
else:
    st.subheader("Roteiro de demo (para o pitch)")
    st.caption("Use esta página para apresentar o produto sem se perder — 100% guiado." )

    st.markdown("### 1) Gerar cenário completo em 1 clique")
    st.write("Cria 3 leads com perfis diferentes, registra eventos e calcula o score automaticamente." )

    def create_demo_lead(nome, uf, cidade, seg, orc, prazo, events):
        payload = {
            "nome": nome,
            "whatsapp": None,
            "email": None,
            "uf": uf,
            "cidade": cidade,
            "segmento_interesse": seg,
            "orcamento_faixa": orc,
            "prazo_compra": prazo,
        }
        lead, err = safe_post("/leads", payload=payload, timeout=15)
        if err:
            return None, err

        lid = lead.get("id")
        for ev in events:
            safe_post("/events", payload={"lead_id": lid, "event_type": ev}, timeout=10)

        scored, perr = safe_post(f"/leads/{lid}/score", payload=None, timeout=30)
        if perr:
            return lead, perr

        return scored, None

    col1, col2 = st.columns([1, 1])
    if col1.button("🚀 Criar cenário de demo (3 leads)", key="demo_create_3"):
        scenarios = [
            {
                "nome": "Lead Demo — Alta intenção",
                "uf": "SP",
                "cidade": "São Paulo",
                "seg": "EQUIPAMENTOS",
                "orc": "60k+",
                "prazo": "7d",
                "events": ["page_view", "hook_complete", "cta_click"],
            },
            {
                "nome": "Lead Demo — Médio",
                "uf": "MG",
                "cidade": "Belo Horizonte",
                "seg": "SERVICOS",
                "orc": "20k-60k",
                "prazo": "30d",
                "events": ["page_view", "hook_complete"],
            },
            {
                "nome": "Lead Demo — Curioso",
                "uf": "GO",
                "cidade": "Goiânia",
                "seg": "EVENTOS",
                "orc": "0-5k",
                "prazo": "90d",
                "events": ["page_view"],
            },
        ]

        results_rows = []
        for s in scenarios:
            r, e = create_demo_lead(**s)
            if e:
                show_error("Falha ao criar um dos leads de demo.", e)
            else:
                results_rows.append({
                    "Nome": r.get("nome"),
                    "UF": r.get("uf"),
                    "Cidade": r.get("cidade"),
                    "Segmento": segment_label(r.get("segmento_interesse")),
                    "Score": r.get("score"),
                    "Status": badge_status(r.get("status")),
                    "Motivos (resumo)": format_motivos(r.get("motivos") or r.get("score_motivos")),
                })

        if results_rows:
            st.success("Cenário criado! Agora vá em **Leads** e filtre por status/score." )
            if pd is not None:
                st.dataframe(pd.DataFrame(results_rows), use_container_width=True, hide_index=True)
            else:
                st.table(results_rows)

    if col2.button("🧹 Reset demo (limpar leads/parceiros demo)", key="demo_reset_btn"):
        resp, err = safe_post("/demo/reset", payload=None, timeout=30)
        if err:
            st.warning("Seu backend ainda não tem o endpoint **/demo/reset**." )
            st.caption("Sugestão: crie esse endpoint para limpar dados de demo e reiniciar a apresentação com 1 clique." )
        else:
            st.success("Demo resetada com sucesso! ✅" )

    st.divider()

    st.markdown("### 2) O que mostrar (ordem recomendada)")
    st.markdown(
        """
        1. **Visão geral**: KPIs (total, qualificados, conversão).
        2. **Leads**: filtre por **✅ QUALIFICADO** e mostre o detalhe + motivos do score.
        3. **Handoff**: clique em “📤 Handoff” para simular envio para atendimento.
        4. **Parceiros**: filtre por UF/segmento e exporte CSV.
        5. **Export CSV**: baixe “leads_filtrados.csv” como evidência de produto.
        """
    )

    st.markdown("### 3) Checklist rápido (antes de apresentar)")
    st.markdown(
        """
        - Backend UP: `http://localhost:3000/health`
        - UI OK: `http://localhost:8501`
        - Criar cenário demo: botão nesta página
        - Abrir **Leads** e filtrar por status/score
        - Mostrar motivos do score (explicabilidade)
        """
    )
