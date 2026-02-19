(function () {
  const STAGES = [
    { id: "INBOX", label: "CURIOSO", short: "IN", color: "var(--stage-inbox)" },
    { id: "AQUECENDO", label: "AQUECENDO", short: "AQ", color: "var(--stage-warm)" },
    { id: "QUALIFICADO", label: "QUALIFICADO", short: "QL", color: "var(--stage-qualified)" },
    { id: "ENVIADO", label: "ENVIADO", short: "EV", color: "var(--stage-sent)" },
  ];

  const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));

  const ROOT = document.getElementById("kanbanRoot");
  const KPI_ROOT = document.getElementById("kanbanKpis");
  const DETAILS_ROOT = document.getElementById("kanbanDetails");

  const SEARCH = document.getElementById("kSearch");
  const FILTER_STAGE = document.getElementById("kStageFilter");
  const FILTER_FOLLOWUP = document.getElementById("kFollowupFilter");
  const SORT = document.getElementById("kSort");
  const LIMIT = document.getElementById("kLimit");
  const REFRESH = document.getElementById("kRefresh");

  const paths = window.__GE__?.paths || {};
  const boardPath = paths.kanban || "/crm/board";
  const movePath = paths.kanbanMove || "/crm/move";
  const notesBase = paths.crmNotesBase || "/crm/leads";
  const matchesBase = paths.crmMatchesBase || "/crm/leads";
  const reportBase = paths.crmReportBase || "/crm/leads";
  const eventRulesPath = paths.crmEventRules || "/crm/event-rules";
  const applyRuleBase = paths.crmApplyRuleBase || "/crm/leads";

  const state = {
    allItems: [],
    filteredItems: [],
    selectedId: null,
    matchesLimit: 8,
    source: "",
    boardEndpoint: "",
    moveEndpoint: "",
    notesEndpoint: "",
    matchesEndpoint: "",
    reportEndpoint: "",
    rulesEndpoint: "",
    applyRuleEndpoint: "",
    eventRules: [],
  };

  function parseMatchesLimit(rawValue) {
    const n = Number.parseInt(String(rawValue ?? ""), 10);
    if (!Number.isFinite(n)) return 8;
    return Math.max(1, Math.min(n, 50));
  }

  function uniqueNonEmpty(list) {
    const out = [];
    const seen = new Set();
    for (const raw of list || []) {
      const value = String(raw || "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
    return out;
  }

  const boardCandidates = uniqueNonEmpty([boardPath, "/crm/board", "/board"]);
  const moveCandidates = uniqueNonEmpty([movePath, "/crm/move", "/move"]);
  const notesBaseCandidates = uniqueNonEmpty([notesBase, "/crm/leads", "/leads"]);
  const matchesBaseCandidates = uniqueNonEmpty([matchesBase, "/crm/leads", "/leads"]);
  const reportBaseCandidates = uniqueNonEmpty([reportBase, "/crm/leads", "/leads"]);
  const eventRulesCandidates = uniqueNonEmpty([eventRulesPath, "/crm/event-rules", "/event-rules"]);
  const applyRuleBaseCandidates = uniqueNonEmpty([applyRuleBase, "/crm/leads", "/leads"]);
  const FALLBACK_EVENT_RULES = [
    { code: "whatsapp_reply", label: "Respondeu WhatsApp", delta: 8 },
    { code: "asked_price", label: "Pediu valores", delta: 12 },
    { code: "proposal_click", label: "Clicou na proposta", delta: 10 },
    { code: "meeting_scheduled", label: "Agendou reuniao", delta: 15 },
    { code: "meeting_attended", label: "Compareceu reuniao", delta: 18 },
    { code: "budget_confirmed", label: "Confirmou orcamento", delta: 15 },
    { code: "timeline_confirmed", label: "Confirmou prazo", delta: 10 },
    { code: "need_confirmed", label: "Confirmou necessidade", delta: 10 },
    { code: "proposal_requested", label: "Solicitou proposta formal", delta: 12 },
    { code: "sent_documents", label: "Enviou documentos", delta: 9 },
    { code: "followup_positive", label: "Retorno positivo no follow up", delta: 6 },
    { code: "no_reply_3d", label: "Sem resposta por 3 dias", delta: -6 },
    { code: "no_reply_7d", label: "Sem resposta por 7 dias", delta: -12 },
    { code: "no_reply_14d", label: "Sem resposta por 14 dias", delta: -20 },
    { code: "postponed_no_date", label: "Adiou sem nova data", delta: -12 },
    { code: "no_budget_now", label: "Sem orcamento agora", delta: -20 },
    { code: "lost_interest", label: "Esfriou sem retorno", delta: -18 },
    { code: "invalid_contact", label: "Contato invalido", delta: -8 },
  ];
  const CITIES_BY_UF = {
    SP: ["Sao Paulo", "Campinas", "Ribeirao Preto", "Sorocaba", "Sao Jose dos Campos"],
    MG: ["Belo Horizonte", "Uberlandia", "Juiz de Fora", "Contagem", "Montes Claros"],
    GO: ["Goiania", "Aparecida de Goiania", "Anapolis", "Rio Verde", "Jatai"],
    RJ: ["Rio de Janeiro", "Niteroi", "Petropolis", "Campos dos Goytacazes", "Volta Redonda"],
    PR: ["Curitiba", "Londrina", "Maringa", "Cascavel", "Ponta Grossa"],
    SC: ["Florianopolis", "Joinville", "Blumenau", "Chapeco", "Criciuma"],
    RS: ["Porto Alegre", "Caxias do Sul", "Pelotas", "Santa Maria", "Passo Fundo"],
    BA: ["Salvador", "Feira de Santana", "Vitoria da Conquista", "Ilheus", "Lauro de Freitas"],
    DF: ["Brasilia", "Taguatinga", "Ceilandia", "Samambaia", "Gama"],
  };
  const REALISTIC_NAMES = [
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
  ];
  const KNOWN_UFS = Object.keys(CITIES_BY_UF);
  const PARTNER_BRAND_CORES = [
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
  ];
  const PARTNER_STYLE_BY_SEGMENT = {
    CAVALOS: ["Haras", "Centro Equestre", "Hipica", "Rancho", "Estancia"],
    SERVICOS: ["Clinica Veterinaria", "Consultoria", "Centro de Treinamento", "Gestao Equestre", "Laboratorio"],
    EVENTOS: ["Arena", "Circuito", "Expo", "Festival", "Grand Prix"],
    EQUIPAMENTOS: ["Selaria", "Equipamentos", "Suprimentos", "Ferragens", "Sela e Cia"],
    DEFAULT: ["Grupo Equestre", "Parceiro Equestre", "Operadora Equestre"],
  };
  const PARTNER_ACTIVITY_BY_SEGMENT = {
    CAVALOS: "Criacao e Manejo de Equinos",
    SERVICOS: "Servicos Equestres",
    EVENTOS: "Eventos e Producoes Equestres",
    EQUIPAMENTOS: "Comercio de Artigos Equestres",
    DEFAULT: "Negocios Equestres",
  };
  const PARTNER_LEGAL_TYPES = ["LTDA", "S.A.", "EIRELI", "ME", "EPP"];
  const partnerIdentityCache = new Map();

  function hashString(value) {
    const s = String(value || "");
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  function pickBySeed(list, seed) {
    if (!Array.isArray(list) || list.length === 0) return "";
    const idx = hashString(seed) % list.length;
    return list[idx];
  }

  function foldText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
  }

  function normalizeTextValue(value) {
    return String(value ?? "").trim();
  }

  function normalizeCnpjKey(value) {
    return String(value ?? "").replace(/\D+/g, "");
  }

  function partnerIdentitySeed(partner) {
    const p = partner || {};
    return [
      normalizeTextValue(p?.id),
      normalizeTextValue(p?.cnpj),
      normalizeTextValue(p?.uf),
      normalizeTextValue(p?.municipio_nome || p?.municipio || p?.cidade),
      normalizeTextValue(p?.segmento),
    ].join("|");
  }

  function buildPartnerFantasyName(partner) {
    const p = partner || {};
    const segment = normalizeTextValue(p?.segmento).toUpperCase();
    const seed = partnerIdentitySeed(p);
    const styles = PARTNER_STYLE_BY_SEGMENT[segment] || PARTNER_STYLE_BY_SEGMENT.DEFAULT;
    const style = pickBySeed(styles, `${seed}:style`);
    const core = pickBySeed(PARTNER_BRAND_CORES, `${seed}:core`);
    return `${style} ${core}`.replace(/\s+/g, " ").trim();
  }

  function buildPartnerCorporateName(fantasyName, partner) {
    const p = partner || {};
    const segment = normalizeTextValue(p?.segmento).toUpperCase();
    const seed = partnerIdentitySeed(p);
    const legalType = pickBySeed(PARTNER_LEGAL_TYPES, `${seed}:legal`);
    const activity = PARTNER_ACTIVITY_BY_SEGMENT[segment] || PARTNER_ACTIVITY_BY_SEGMENT.DEFAULT;
    return `${fantasyName} ${activity} ${legalType}`.replace(/\s+/g, " ").trim();
  }

  function decoratePartnerIdentity(partner) {
    const p = partner || {};
    const nomeFantasia = buildPartnerFantasyName(p);
    const razaoSocial = buildPartnerCorporateName(nomeFantasia, p);
    return {
      ...p,
      nome_fantasia: nomeFantasia || p.nome_fantasia || p.name || "-",
      razao_social: razaoSocial || p.razao_social || "-",
    };
  }

  async function loadPartnerIdentityMap(lead) {
    const cacheKey = "__all__";
    if (partnerIdentityCache.has(cacheKey)) {
      return partnerIdentityCache.get(cacheKey);
    }

    const resp = await fetch("/api/partners", { cache: "no-store" });
    if (!resp.ok) {
      const empty = new Map();
      partnerIdentityCache.set(cacheKey, empty);
      return empty;
    }

    const payload = await resp.json();
    const partners = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    const lookup = new Map();

    for (const p of partners) {
      if (!p || typeof p !== "object") continue;
      const decorated = decoratePartnerIdentity(p);
      const pid = normalizeTextValue(decorated.id);
      const cnpj = normalizeCnpjKey(decorated.cnpj);
      if (pid) lookup.set(`id:${pid}`, decorated.nome_fantasia);
      if (cnpj) lookup.set(`cnpj:${cnpj}`, decorated.nome_fantasia);
    }

    partnerIdentityCache.set(cacheKey, lookup);
    return lookup;
  }

  async function alignMatchesPartnerNames(items, lead) {
    const lookup = await loadPartnerIdentityMap(lead);
    return (items || []).map((item) => {
      if (!item || typeof item !== "object") return item;

      const pid = normalizeTextValue(item.id);
      const cnpj = normalizeCnpjKey(item.cnpj);
      const mappedName =
        (pid && lookup.get(`id:${pid}`)) ||
        (cnpj && lookup.get(`cnpj:${cnpj}`));

      if (mappedName) {
        return {
          ...item,
          nome_fantasia: mappedName,
        };
      }

      const decorated = decoratePartnerIdentity(item);
      return {
        ...item,
        nome_fantasia: decorated.nome_fantasia || item.nome_fantasia || item.name || "-",
      };
    });
  }

  function segmentLooksSimilar(a, b) {
    const normalize = (v) => foldText(v).replace(/[^A-Z0-9]/g, "");
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.startsWith(nb) || nb.startsWith(na)) return true;

    const aliases = new Map([
      ["SERVICO", "SERVICOS"],
      ["SERVICOS", "SERVICO"],
      ["EVENTO", "EVENTOS"],
      ["EVENTOS", "EVENTO"],
      ["EQUIPAMENTO", "EQUIPAMENTOS"],
      ["EQUIPAMENTOS", "EQUIPAMENTO"],
      ["CAVALO", "CAVALOS"],
      ["CAVALOS", "CAVALO"],
    ]);

    return aliases.get(na) === nb || aliases.get(nb) === na;
  }

  async function requestJsonWithFallback(urls, options = {}) {
    let lastError = null;
    for (const url of urls || []) {
      try {
        const resp = await fetch(url, options);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        let data = null;
        try {
          data = await resp.json();
        } catch (_err) {
          data = null;
        }
        return { url, data, resp };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Requisicao falhou");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toNumber(value, fallback = -1) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeStage(rawStage, rawStatus) {
    const stage = String(rawStage || "").trim().toUpperCase();
    if (STAGE_BY_ID[stage]) return stage;

    const status = String(rawStatus || "").trim().toUpperCase();
    if (status === "CURIOSO") return "INBOX";
    if (STAGE_BY_ID[status]) return status;
    return "INBOX";
  }

  function normalizeUF(ufRaw) {
    const uf = String(ufRaw || "").trim().toUpperCase();
    return uf || "-";
  }

  function cityBelongsToUF(cityRaw, uf) {
    const city = foldText(cityRaw);
    if (!city || city === "-") return false;

    const knownCities = CITIES_BY_UF[uf] || [];
    if (!knownCities.length) return true;

    return knownCities.some((c) => foldText(c) === city);
  }

  function guessUFByCity(cityRaw) {
    const city = foldText(cityRaw);
    if (!city || city === "-") return "";

    for (const [uf, cities] of Object.entries(CITIES_BY_UF)) {
      if (cities.some((c) => foldText(c) === city)) return uf;
    }
    return "";
  }

  function isGenericName(nameRaw) {
    const name = foldText(nameRaw);
    if (!name) return true;
    if (name === "-" || name === "N/A" || name === "NA") return true;

    return (
      name.startsWith("LEAD DEMO") ||
      name.startsWith("LEAD ") ||
      name === "TESTE" ||
      name.startsWith("TESTE ") ||
      name.startsWith("TEST ")
    );
  }

  function isGenericCity(cityRaw) {
    const city = foldText(cityRaw);
    if (!city) return true;
    return (
      city === "-" ||
      city === "CIDADE" ||
      city === "CITY" ||
      city === "N/A" ||
      city === "NA" ||
      city === "NAO DEFINIDO" ||
      city === "NAO INFORMADA" ||
      city === "TESTE"
    );
  }

  function enrichLeadIdentity(lead, seed) {
    const rawNome = String(lead.nome || "").trim();
    const rawCidade = String(lead.cidade || "").trim();
    const rawUf = String(lead.uf || "").trim();

    let nome = rawNome;
    let cidade = rawCidade;
    let uf = normalizeUF(rawUf);

    if (uf === "-" && cidade) {
      const guessedUf = guessUFByCity(cidade);
      if (guessedUf) uf = guessedUf;
    }

    if (uf === "-") {
      uf = pickBySeed(KNOWN_UFS, `${seed}-uf`) || "-";
    }

    if (isGenericName(nome)) {
      nome = pickBySeed(REALISTIC_NAMES, `${seed}-name`);
    }

    const cityPool = CITIES_BY_UF[uf] || [];
    if (isGenericCity(cidade) || (cityPool.length > 0 && !cityBelongsToUF(cidade, uf))) {
      cidade = cityPool.length ? pickBySeed(cityPool, `${seed}-city`) : cidade || "-";
    }

    return {
      ...lead,
      nome: nome || `Lead ${lead.id}`,
      cidade: cidade || "-",
      uf: uf || "-",
      rawNome,
      rawCidade,
      rawUf,
    };
  }

  function normalizeLead(raw) {
    const id = String(raw.id || raw.lead_id || raw.card_id || "").trim();
    if (!id) return null;

    const stage = normalizeStage(raw.crm_stage || raw.stage, raw.status);
    const normalized = {
      id,
      nome: String(raw.nome || raw.name || raw.title || `Lead ${id}`),
      cidade: String(raw.cidade || raw.city || raw.municipio_nome || "").trim(),
      uf: String(raw.uf || "").trim(),
      segmento: String(raw.segmento_interesse || raw.segmento || raw.segment || "").trim(),
      score: raw.score,
      status: String(raw.status || "").trim(),
      stage,
      nextText: String(raw.next_action_text || raw.proxima_acao_texto || "").trim(),
      nextDate: String(raw.next_action_date || raw.proxima_acao_data || "").trim(),
      nextTime: String(raw.next_action_time || raw.proxima_acao_hora || "").trim(),
      updatedAt: String(raw.updated_at || raw.created_at || ""),
    };

    return enrichLeadIdentity(normalized, `${id}-${stage}`);
  }

  function mapMockColumns(columns) {
    const stageMap = {
      novo: "INBOX",
      contato: "AQUECENDO",
      proposta: "QUALIFICADO",
      fechado: "ENVIADO",
    };

    const list = [];
    for (const col of columns || []) {
      const mappedStage = stageMap[String(col?.id || "").toLowerCase()] || "INBOX";
      for (const card of col.cards || []) {
        list.push(
          normalizeLead({
            id: card.id,
            nome: card.title,
            cidade: "",
            uf: "",
            segmento_interesse: (card.chips || [])[0] || "",
            score: null,
            status: mappedStage,
            crm_stage: mappedStage,
            next_action_text: card.subtitle || "",
          })
        );
      }
    }

    return list.filter(Boolean);
  }

  async function fetchBoard() {
    try {
      let items = [];
      let usedEndpoint = "";

      for (const endpoint of boardCandidates) {
        try {
          const resp = await fetch(`/api${endpoint}`, { cache: "no-store" });
          if (!resp.ok) continue;

          const data = await resp.json();
          let rows = [];
          if (Array.isArray(data)) rows = data;
          else if (Array.isArray(data.items)) rows = data.items;
          else if (Array.isArray(data.columns)) rows = mapMockColumns(data.columns);

          items = rows.map(normalizeLead).filter(Boolean);
          usedEndpoint = endpoint;
          break;
        } catch (_err) {
          continue;
        }
      }

      if (!usedEndpoint) {
        throw new Error("Nenhum endpoint de board respondeu com sucesso.");
      }

      state.allItems = items;
      state.source = "backend";
      state.boardEndpoint = usedEndpoint;
    } catch (err) {
      const mockResp = await fetch("/public/js/mock_kanban.json", { cache: "no-store" });
      const mockData = await mockResp.json();
      state.allItems = mapMockColumns(mockData.columns || []);
      state.source = "mock";
      state.boardEndpoint = "mock";
    }
  }

  function getFilters() {
    return {
      query: String(SEARCH?.value || "").trim().toLowerCase(),
      stage: String(FILTER_STAGE?.value || "ALL"),
      followup: String(FILTER_FOLLOWUP?.value || "ALL"),
      sort: String(SORT?.value || "score_desc"),
      limit: Math.max(1, Number.parseInt(String(LIMIT?.value || "10"), 10) || 10),
    };
  }

  function applyFilters() {
    const f = getFilters();
    let list = [...state.allItems];

    if (f.query) {
      list = list.filter((it) => {
        const bucket = [it.nome, it.cidade, it.uf, it.segmento, it.status, it.stage].join(" ").toLowerCase();
        return bucket.includes(f.query);
      });
    }

    if (f.stage !== "ALL") {
      list = list.filter((it) => it.stage === f.stage);
    }

    if (f.followup === "QUALIFIED_TRACKING") {
      list = list.filter((it) => isQualifiedTracking(it));
    } else if (f.followup === "QUALIFIED_PENDING") {
      list = list.filter((it) => isQualifiedPendingTracking(it));
    }

    if (f.sort === "score_desc") {
      list.sort((a, b) => toNumber(b.score) - toNumber(a.score));
    } else if (f.sort === "updated_desc") {
      list.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    } else {
      list.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    }

    state.filteredItems = list;
    return { list, limit: f.limit };
  }

  function formatScore(score) {
    if (score === null || score === undefined || score === "") return "-";
    const n = Number(score);
    return Number.isFinite(n) ? String(n) : escapeHtml(score);
  }

  function formatNextAction(lead) {
    const text = String(lead.nextText || "").trim();
    const when = [lead.nextDate, lead.nextTime].filter(Boolean).join(" ").trim();

    if (!text && !when) return "Nao definida";
    if (text && when) return `${when} - ${text}`;
    return text || when;
  }

  function hasQualifiedFollowup(lead) {
    const text = String(lead?.nextText || "").trim();
    const date = String(lead?.nextDate || "").trim();
    return Boolean(text && date);
  }

  function isQualifiedTracking(lead) {
    return lead?.stage === "QUALIFICADO" && hasQualifiedFollowup(lead);
  }

  function isQualifiedPendingTracking(lead) {
    return lead?.stage === "QUALIFICADO" && !hasQualifiedFollowup(lead);
  }

  function buildFollowupHint(lead) {
    if (lead?.stage !== "QUALIFICADO") return "";
    if (hasQualifiedFollowup(lead)) return "";
    return "Qualificado sem acompanhamento: salve proxima acao com texto e data.";
  }

  function groupByStage(items) {
    const grouped = {
      INBOX: [],
      AQUECENDO: [],
      QUALIFICADO: [],
      ENVIADO: [],
    };

    for (const item of items) {
      grouped[item.stage] = grouped[item.stage] || [];
      grouped[item.stage].push(item);
    }

    return grouped;
  }

  function renderKpis(grouped) {
    if (!KPI_ROOT) return;
    const qualifiedItems = grouped.QUALIFICADO || [];
    const trackingCount = qualifiedItems.filter((lead) => isQualifiedTracking(lead)).length;

    const stageBoxesHtml = STAGES.map((s) => {
      const count = grouped[s.id]?.length || 0;
      return `
        <article class="kpi-box" style="border-top: 3px solid ${s.color};">
          <div class="kpi-label">${s.label}</div>
          <div class="kpi-value">${count} lead(s)</div>
        </article>
      `;
    }).join("");

    const followupBoxHtml = `
      <article class="kpi-box kpi-box-followup">
        <div class="kpi-label">QUALIFICADO EM ACOMPANHAMENTO</div>
        <div class="kpi-value">${trackingCount} lead(s)</div>
      </article>
    `;

    KPI_ROOT.innerHTML = `${stageBoxesHtml}${followupBoxHtml}`;
  }

  function renderBoard() {
    if (!ROOT) return;

    const { list, limit } = applyFilters();
    const grouped = groupByStage(list);
    renderKpis(grouped);

    ROOT.innerHTML = STAGES.map((stage) => {
      const allCards = grouped[stage.id] || [];
      const cards = allCards.slice(0, limit);
      const hidden = Math.max(0, allCards.length - cards.length);

      const cardsHtml = cards
        .map((lead) => {
          const location = [lead.cidade || "-", lead.uf || "-"].join("/");
          const segment = lead.segmento || "Sem segmento";
          const nextAction = formatNextAction(lead);
          const followupChip = isQualifiedTracking(lead)
            ? `<span class="k-chip k-chip-followup">ACOMPANHANDO</span>`
            : "";

          return `
            <article class="k-card">
              <div class="k-card-title">${escapeHtml(lead.nome)}</div>
              <div class="k-card-location">${escapeHtml(location)}</div>
              <div class="k-chip-row">
                <span class="k-chip">${escapeHtml(segment)}</span>
                <span class="k-chip">score: ${escapeHtml(formatScore(lead.score))}</span>
                ${followupChip}
              </div>
              <div class="k-next"><b>Proxima acao:</b> ${escapeHtml(nextAction)}</div>
              <div class="k-actions">
                <button class="btn btn-ghost" data-action="open-details" data-id="${escapeHtml(lead.id)}">Abrir detalhes</button>
              </div>
            </article>
          `;
        })
        .join("");

      const bodyHtml = cards.length
        ? cardsHtml
        : `<div class="k-empty">Sem leads nesta etapa</div>`;

      const hiddenHtml = hidden > 0 ? `<div class="k-hidden-note">+ ${hidden} lead(s) ocultos nesta coluna.</div>` : "";

      return `
        <section class="k-column" style="border-top: 3px solid ${stage.color};">
          <div class="k-column-head">
            <div class="k-column-title">${stage.short} ${stage.label}</div>
            <div class="k-column-count">${allCards.length}</div>
          </div>
          <div class="k-cards">${bodyHtml}</div>
          ${hiddenHtml}
        </section>
      `;
    }).join("");

    const selectedStillExists = state.allItems.some((it) => it.id === state.selectedId);
    if (!selectedStillExists) state.selectedId = null;

    renderDetails();
  }

  function leadOptionsHtml(selectedId) {
    const opts = state.allItems
      .map((lead) => {
        const stage = STAGE_BY_ID[lead.stage]?.label || lead.stage;
        const score = formatScore(lead.score);
        const trackingTag = isQualifiedTracking(lead) ? " - ACOMPANHANDO" : "";
        const label = `${lead.nome} - ${stage}${trackingTag} - score=${score}`;
        const selected = selectedId === lead.id ? "selected" : "";
        return `<option value="${escapeHtml(lead.id)}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");

    return `<option value="">- selecione -</option>${opts}`;
  }

  function stageOptionsHtml(currentStage) {
    return STAGES.map((s) => {
      const selected = currentStage === s.id ? "selected" : "";
      return `<option value="${s.id}" ${selected}>${s.label}</option>`;
    }).join("");
  }

  function normalizeRuleCode(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function formatRuleDelta(rawDelta) {
    const delta = Number(rawDelta);
    if (!Number.isFinite(delta)) return "0";
    if (delta > 0) return `+${delta}`;
    return String(delta);
  }

  function normalizeRule(rawRule) {
    if (!rawRule || typeof rawRule !== "object") return null;
    const code = normalizeRuleCode(rawRule.code || rawRule.event_type);
    if (!code) return null;
    const label = String(rawRule.label || code).trim() || code;
    const delta = Number.parseInt(String(rawRule.delta ?? 0), 10);
    if (!Number.isFinite(delta)) return null;
    return { code, label, delta };
  }

  function normalizeRulesPayload(payload) {
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    return items.map(normalizeRule).filter(Boolean);
  }

  function getEventRules() {
    const active = state.eventRules.map(normalizeRule).filter(Boolean);
    if (active.length) return active;
    return FALLBACK_EVENT_RULES.map(normalizeRule).filter(Boolean);
  }

  function eventRuleOptionsHtml(selectedCode = "") {
    const options = getEventRules()
      .map((rule) => {
        const selected = rule.code === selectedCode ? "selected" : "";
        const label = `${rule.label} (${formatRuleDelta(rule.delta)})`;
        return `<option value="${escapeHtml(rule.code)}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
    return `<option value="">- selecione -</option>${options}`;
  }

  async function loadEventRules() {
    try {
      const urls = eventRulesCandidates.map((endpoint) => `/api${endpoint}`);
      const { url, data } = await requestJsonWithFallback(urls, { cache: "no-store" });
      const parsed = normalizeRulesPayload(data);
      if (parsed.length) {
        state.eventRules = parsed;
        state.rulesEndpoint = url;
        return;
      }
    } catch (_err) {
      // fallback local abaixo
    }

    state.eventRules = FALLBACK_EVENT_RULES.map(normalizeRule).filter(Boolean);
    if (!state.rulesEndpoint) state.rulesEndpoint = "fallback";
  }

  function nextActionDefaults(lead) {
    return {
      text: lead?.nextText || "",
      date: lead?.nextDate || "",
      time: lead?.nextTime ? String(lead.nextTime).slice(0, 5) : "09:00",
    };
  }

  function findLeadById(id) {
    return state.allItems.find((it) => it.id === id) || null;
  }

  function renderDetails() {
    if (!DETAILS_ROOT) return;

    const lead = findLeadById(state.selectedId);

    if (!lead) {
      DETAILS_ROOT.innerHTML = `
        <h3 class="h3">Detalhes</h3>
        <p class="muted mt-8">Selecione um lead para ver detalhes e salvar proxima acao.</p>
        <label class="field mt-12">
          <span>Selecionar lead (CRM)</span>
          <select id="dLeadSelect" class="input">
            ${leadOptionsHtml("")}
          </select>
        </label>
        <div class="k-message mt-12">Nenhum lead selecionado.</div>
      `;
      return;
    }

    const defaults = nextActionDefaults(lead);
    const stageMeta = STAGE_BY_ID[lead.stage] || STAGE_BY_ID.INBOX;
    const qualifiedTracking = isQualifiedTracking(lead);
    const followupHint = buildFollowupHint(lead);
    const eventRules = getEventRules();
    const defaultRuleCode = eventRules[0]?.code || "";
    state.matchesLimit = parseMatchesLimit(state.matchesLimit);

    DETAILS_ROOT.innerHTML = `
      <h3 class="h3">Detalhes</h3>
      <p class="muted mt-8">Lead selecionado para operacao.</p>

      <label class="field mt-12">
        <span>Selecionar lead (CRM)</span>
        <select id="dLeadSelect" class="input">
          ${leadOptionsHtml(lead.id)}
        </select>
      </label>

      <div class="k-stage-badge" style="border-color:${stageMeta.color}; color:${stageMeta.color};">
        ${stageMeta.label}
      </div>
      ${qualifiedTracking ? '<div class="k-stage-badge k-stage-badge-followup">ACOMPANHANDO</div>' : ""}
      ${followupHint ? `<div class="k-message mt-8">${escapeHtml(followupHint)}</div>` : ""}

      <div class="k-form">
        <label class="field">
          <span>Mover etapa</span>
          <select id="dMoveStage" class="input">
            ${stageOptionsHtml(lead.stage)}
          </select>
        </label>
        <button id="dMoveBtn" class="btn">Atualizar etapa</button>
      </div>

      <h4 class="k-section-title">Automacao por evento</h4>
      <div class="k-form">
        <label class="field">
          <span>Evento objetivo (ajusta score e move o lead)</span>
          <select id="dEventRule" class="input">
            ${eventRuleOptionsHtml(defaultRuleCode)}
          </select>
        </label>
        <label class="field">
          <span>Observacao opcional</span>
          <input id="dEventNote" class="input" type="text" placeholder="Ex.: confirmou necessidade em ligacao" />
        </label>
        <button id="dApplyRuleBtn" class="btn">Aplicar evento</button>
      </div>

      <h4 class="k-section-title">Proxima acao</h4>
      <div class="k-form">
        <label class="field">
          <span>Texto</span>
          <input id="dNextText" class="input" type="text" value="${escapeHtml(defaults.text)}" placeholder="Ex.: confirmar interesse por WhatsApp" />
        </label>
        <label class="field">
          <span>Data</span>
          <input id="dNextDate" class="input" type="date" value="${escapeHtml(defaults.date)}" />
        </label>
        <label class="field">
          <span>Hora</span>
          <input id="dNextTime" class="input" type="time" value="${escapeHtml(defaults.time)}" />
        </label>
        <div class="k-form-actions">
          <button id="dSaveNextBtn" class="btn btn-ghost">Salvar proxima acao</button>
          <button id="dReloadMatchesBtn" class="btn btn-ghost">Atualizar matching</button>
        </div>
      </div>

      <div id="dNotice" class="k-message mt-12" style="display:none;"></div>
      <div class="k-form mt-12">
        <button id="dOpenReportBtn" class="btn">Visualizar relatorio gerencial</button>
      </div>

      <h4 class="k-section-title">Matching de parceiros</h4>
      <label class="field">
        <span>Quantidade de matches exibidos: <b id="dMatchesLimitValue">${state.matchesLimit}</b></span>
        <input id="dMatchesLimit" class="k-range" type="range" min="1" max="50" step="1" value="${state.matchesLimit}" />
      </label>
      <div id="dMatchesWrap" class="k-message">Carregando matching...</div>
    `;

    loadMatches(lead);
  }

  function setNotice(message, isError = false) {
    const el = document.getElementById("dNotice");
    if (!el) return;

    if (!message) {
      el.style.display = "none";
      el.textContent = "";
      return;
    }

    el.style.display = "block";
    el.textContent = message;
    el.style.borderColor = isError ? "rgba(255,107,129,0.5)" : "rgba(55,214,122,0.45)";
    el.style.color = isError ? "#ff9db0" : "#a5f7c7";
  }

  function formatDateTimeLocal(value) {
    const txt = String(value || "").trim();
    if (!txt) return "-";
    try {
      const dt = new Date(txt);
      if (Number.isNaN(dt.getTime())) return txt;
      return dt.toLocaleString();
    } catch (_err) {
      return txt;
    }
  }

  function formatProbabilityPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return `${(n * 100).toFixed(1)}%`;
  }

  function toSafeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function reportSectorChip(sector) {
    if (!sector || typeof sector !== "object") return "<span class=\"k-report-chip\">-</span>";
    const code = escapeHtml(String(sector.code || "-"));
    const name = escapeHtml(String(sector.name || "-"));
    return `<span class="k-report-chip"><b>${code}</b> ${name}</span>`;
  }

  function reportKeyValueRows(rows) {
    return rows
      .map(
        (row) => `
          <tr>
            <th>${escapeHtml(String(row.k || "-"))}</th>
            <td>${escapeHtml(String(row.v ?? "-"))}</td>
          </tr>
        `
      )
      .join("");
  }

  function ensureReportModal() {
    let modal = document.getElementById("kReportModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "kReportModal";
    modal.className = "k-report-modal";
    modal.innerHTML = `
      <div class="k-report-backdrop" data-action="close"></div>
      <article class="k-report-dialog" role="dialog" aria-modal="true" aria-label="Relatorio gerencial">
        <header class="k-report-toolbar">
          <h3 class="h3">Relatorio Gerencial do Lead</h3>
          <div class="btn-row">
            <button id="kReportPrintBtn" class="btn btn-ghost" type="button">Imprimir</button>
            <button id="kReportCloseBtn" class="btn btn-ghost" type="button">Fechar</button>
          </div>
        </header>
        <div id="kReportBody" class="k-report-body"></div>
      </article>
    `;

    modal.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.action === "close" || target.id === "kReportCloseBtn") {
        closeReportModal();
      }
      if (target.id === "kReportPrintBtn") {
        window.print();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (modal.classList.contains("is-open")) closeReportModal();
    });

    document.body.appendChild(modal);
    return modal;
  }

  function closeReportModal() {
    const modal = document.getElementById("kReportModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function openReportModalWithHtml(html) {
    const modal = ensureReportModal();
    const body = modal.querySelector("#kReportBody");
    if (body) body.innerHTML = html;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function buildLocalFallbackReport(lead) {
    const stage = STAGE_BY_ID[lead?.stage]?.label || lead?.stage || "INBOX";
    const score = Number(lead?.score);
    let sector = "Setor de Marketing de Nurture";
    let reason = "Lead em maturacao e sem consolidacao de sinais fortes de compra.";

    if (stage === "ENVIADO" || (Number.isFinite(score) && score >= 80)) {
      sector = "Setor de Vendas Consultivas";
      reason = "Lead com alta intencao (etapa avancada e/ou score elevado).";
    } else if (stage === "QUALIFICADO") {
      sector = "Setor de Parcerias Estrategicas";
      reason = "Lead qualificado com potencial de alavancagem via ecossistema de parceiros.";
    }

    return {
      report_id: `LOCAL-${String(lead?.id || "LEAD").slice(0, 8).toUpperCase()}`,
      generated_at: new Date().toISOString(),
      lead_snapshot: {
        id: lead?.id || "-",
        nome: lead?.nome || "-",
        uf: lead?.uf || "-",
        cidade: lead?.cidade || "-",
        segmento: lead?.segmento || "-",
        status: lead?.status || "-",
        stage,
        score: lead?.score ?? "-",
      },
      executive_summary: {
        headline: `Encaminhamento recomendado para ${sector}.`,
        sent_to: sector,
        sent_to_code: "LOCAL",
        decision_mode: "SUGERIDO",
        confidence_pct: 65,
        why_sent: [reason, "Gerado em modo local por indisponibilidade momentanea do backend de relatorios."],
      },
      routing: {
        primary_sector: { code: "LOCAL", name: sector, owner: "Engine local" },
        secondary_sectors: [],
        destination_reasoning: [reason],
      },
      qualification_intelligence: {
        score: lead?.score ?? "-",
        probability_qualified_text: "-",
        score_engine: "-",
        score_model_name: "-",
        scored_at: "-",
        score_reasons: [],
      },
      engagement: {
        total_events: 0,
        event_breakdown: {},
        timeline: [],
      },
      crm_context: {
        notes_count: 0,
        latest_notes: [],
        next_action: { text: lead?.nextText || "-", date: lead?.nextDate || "-", time: lead?.nextTime || "-" },
      },
      partner_matching: {
        total_considered: 0,
        top_matches: [],
        recommendation: "Atualize o matching para enriquecer o relatorio.",
      },
      managerial_risks: ["Relatorio em modo local (dados reduzidos)."],
      managerial_recommendations: [],
      governance: {
        data_sources: ["kanban-local-state"],
        generated_by: "kanban-local-report-fallback",
      },
    };
  }

  function renderManagerialReportHtml(report) {
    const lead = report?.lead_snapshot || {};
    const exec = report?.executive_summary || {};
    const routing = report?.routing || {};
    const qual = report?.qualification_intelligence || {};
    const engagement = report?.engagement || {};
    const crmCtx = report?.crm_context || {};
    const partner = report?.partner_matching || {};
    const governance = report?.governance || {};

    const whySentItems = toSafeArray(exec.why_sent)
      .map((txt) => `<li>${escapeHtml(String(txt || "-"))}</li>`)
      .join("");
    const secSectorsHtml = toSafeArray(routing.secondary_sectors).map(reportSectorChip).join("");
    const scoreReasonsRows = toSafeArray(qual.score_reasons)
      .map((m) => {
        const fator = String(m?.fator || "-");
        const impacto = Number(m?.impacto);
        const detalhe = String(m?.detalhe || "-");
        return `
          <tr>
            <td>${escapeHtml(fator)}</td>
            <td>${escapeHtml(Number.isFinite(impacto) ? (impacto >= 0 ? `+${impacto}` : String(impacto)) : "-")}</td>
            <td>${escapeHtml(detalhe)}</td>
          </tr>
        `;
      })
      .join("");
    const timelineRows = toSafeArray(engagement.timeline)
      .map((ev) => {
        const type = String(ev?.event_type || "-");
        const at = formatDateTimeLocal(ev?.at);
        const meta = ev?.metadata && typeof ev.metadata === "object" ? ev.metadata : {};
        const channel = String(
          meta.channel ||
            meta.setor ||
            meta.sector ||
            meta.rule_label ||
            meta.rule_code ||
            meta.note ||
            (meta.input && typeof meta.input === "object" ? meta.input.note : "") ||
            "-"
        );
        return `
          <tr>
            <td>${escapeHtml(type)}</td>
            <td>${escapeHtml(at)}</td>
            <td>${escapeHtml(channel)}</td>
          </tr>
        `;
      })
      .join("");
    const notesRows = toSafeArray(crmCtx.latest_notes)
      .map((n) => {
        const when = formatDateTimeLocal(n?.created_at);
        return `
          <tr>
            <td>${escapeHtml(String(n?.type || "-"))}</td>
            <td>${escapeHtml(String(n?.text || "-"))}</td>
            <td>${escapeHtml(when)}</td>
          </tr>
        `;
      })
      .join("");
    const matchRows = toSafeArray(partner.top_matches)
      .map((m) => {
        return `
          <tr>
            <td>${escapeHtml(String(m?.nome_fantasia || "-"))}</td>
            <td>${escapeHtml(String(m?.uf || "-"))}</td>
            <td>${escapeHtml(String(m?.municipio_nome || "-"))}</td>
            <td>${escapeHtml(String(m?.prioridade ?? "-"))}</td>
            <td>${escapeHtml(String(m?.score ?? "-"))}</td>
          </tr>
        `;
      })
      .join("");
    const risksList = toSafeArray(report?.managerial_risks)
      .map((r) => `<li>${escapeHtml(String(r || "-"))}</li>`)
      .join("");
    const recRows = toSafeArray(report?.managerial_recommendations)
      .map((r) => {
        return `
          <tr>
            <td>${escapeHtml(String(r?.horizon || "-"))}</td>
            <td>${escapeHtml(String(r?.owner || "-"))}</td>
            <td>${escapeHtml(String(r?.action || "-"))}</td>
          </tr>
        `;
      })
      .join("");

    const eventBreakdownTxt = Object.entries(engagement.event_breakdown || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");

    return `
      <section class="k-report-header-card">
        <div class="k-report-title-wrap">
          <h4 class="h3">${escapeHtml(String(exec.headline || "Relatorio gerencial do lead"))}</h4>
          <div class="muted mt-8">Relatorio: ${escapeHtml(String(report?.report_id || "-"))}</div>
          <div class="muted">Gerado em: ${escapeHtml(formatDateTimeLocal(report?.generated_at))}</div>
        </div>
        <div class="k-report-sector-wrap">
          ${reportSectorChip(routing.primary_sector)}
          <div class="muted mt-8">Modo: ${escapeHtml(String(exec.decision_mode || "-"))} | Confianca: ${escapeHtml(String(exec.confidence_pct ?? "-"))}%</div>
        </div>
      </section>

      <section class="k-report-kpi-grid">
        <article class="k-report-kpi"><div class="k-report-kpi-label">Score</div><div class="k-report-kpi-value">${escapeHtml(String(qual.score ?? lead.score ?? "-"))}</div></article>
        <article class="k-report-kpi"><div class="k-report-kpi-label">Prob. Qualificacao</div><div class="k-report-kpi-value">${escapeHtml(String(qual.probability_qualified_text || formatProbabilityPct(qual.probability_qualified)))}</div></article>
        <article class="k-report-kpi"><div class="k-report-kpi-label">Eventos</div><div class="k-report-kpi-value">${escapeHtml(String(engagement.total_events ?? 0))}</div></article>
        <article class="k-report-kpi"><div class="k-report-kpi-label">Notas CRM</div><div class="k-report-kpi-value">${escapeHtml(String(crmCtx.notes_count ?? 0))}</div></article>
      </section>

      <section class="k-report-section">
        <h4 class="k-report-section-title">1) Encaminhamento e justificativa executiva</h4>
        <div class="k-report-grid-2">
          <div class="k-report-box">
            <div class="k-report-subtitle">Destino principal</div>
            ${reportSectorChip(routing.primary_sector)}
            <div class="k-report-subtitle mt-12">Destinos secundarios</div>
            <div class="k-report-chip-row">${secSectorsHtml || "<span class=\"k-report-chip\">-</span>"}</div>
          </div>
          <div class="k-report-box">
            <div class="k-report-subtitle">Porque foi enviado</div>
            <ul class="k-report-list">${whySentItems || "<li>-</li>"}</ul>
          </div>
        </div>
      </section>

      <section class="k-report-section">
        <h4 class="k-report-section-title">2) Cadastro do lead (snapshot)</h4>
        <div class="k-report-table-wrap">
          <table class="k-report-table">
            <tbody>
              ${reportKeyValueRows([
                { k: "Lead ID", v: lead.id || "-" },
                { k: "Nome", v: lead.nome || "-" },
                { k: "Localizacao", v: `${lead.cidade || "-"} / ${lead.uf || "-"}` },
                { k: "Segmento", v: lead.segmento || "-" },
                { k: "Status / Etapa", v: `${lead.status || "-"} / ${lead.stage || "-"}` },
                { k: "Motor / Modelo", v: `${qual.score_engine || "-"} / ${qual.score_model_name || "-"}` },
              ])}
            </tbody>
          </table>
        </div>
      </section>

      <section class="k-report-section">
        <h4 class="k-report-section-title">3) Inteligencia de qualificacao (score)</h4>
        <div class="k-report-table-wrap">
          <table class="k-report-table">
            <thead>
              <tr>
                <th>Fator</th>
                <th>Impacto</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              ${scoreReasonsRows || "<tr><td colspan=\"3\">Sem fatores detalhados.</td></tr>"}
            </tbody>
          </table>
        </div>
      </section>

      <section class="k-report-section">
        <h4 class="k-report-section-title">4) Engajamento e historico CRM</h4>
        <div class="k-report-box">Distribuicao de eventos: ${escapeHtml(eventBreakdownTxt || "-")}</div>
        <div class="k-report-grid-2 mt-12">
          <div class="k-report-table-wrap">
            <table class="k-report-table">
              <thead><tr><th>Evento</th><th>Data/Hora</th><th>Canal</th></tr></thead>
              <tbody>${timelineRows || "<tr><td colspan=\"3\">Sem eventos registrados.</td></tr>"}</tbody>
            </table>
          </div>
          <div class="k-report-table-wrap">
            <table class="k-report-table">
              <thead><tr><th>Tipo</th><th>Nota</th><th>Data/Hora</th></tr></thead>
              <tbody>${notesRows || "<tr><td colspan=\"3\">Sem notas CRM registradas.</td></tr>"}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="k-report-section">
        <h4 class="k-report-section-title">5) Matching de parceiros e plano de acao</h4>
        <div class="k-report-box">${escapeHtml(String(partner.recommendation || "-"))}</div>
        <div class="k-report-grid-2 mt-12">
          <div class="k-report-table-wrap">
            <table class="k-report-table">
              <thead><tr><th>Parceiro</th><th>UF</th><th>Municipio</th><th>Prioridade</th><th>Score</th></tr></thead>
              <tbody>${matchRows || "<tr><td colspan=\"5\">Sem parceiros recomendados.</td></tr>"}</tbody>
            </table>
          </div>
          <div class="k-report-table-wrap">
            <table class="k-report-table">
              <thead><tr><th>Janela</th><th>Responsavel</th><th>Acao recomendada</th></tr></thead>
              <tbody>${recRows || "<tr><td colspan=\"3\">Sem plano recomendado.</td></tr>"}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="k-report-section">
        <h4 class="k-report-section-title">6) Riscos e governanca</h4>
        <div class="k-report-grid-2">
          <div class="k-report-box">
            <div class="k-report-subtitle">Riscos gerenciais</div>
            <ul class="k-report-list">${risksList || "<li>Sem riscos relevantes.</li>"}</ul>
          </div>
          <div class="k-report-box">
            <div class="k-report-subtitle">Rastreabilidade</div>
            <p>Fontes: ${escapeHtml(String((governance.data_sources || []).join(", ") || "-"))}</p>
            <p>Engine: ${escapeHtml(String(governance.generated_by || "-"))}</p>
            <p>Endpoint: ${escapeHtml(String(state.reportEndpoint || "-"))}</p>
          </div>
        </div>
      </section>
    `;
  }

  async function openManagerialReport() {
    const lead = findLeadById(state.selectedId);
    if (!lead) {
      setNotice("Selecione um lead para visualizar o relatorio gerencial.", true);
      return;
    }

    openReportModalWithHtml(`<div class="k-message">Gerando relatorio gerencial...</div>`);

    try {
      const leadId = String(lead.id || "").trim();
      const urls = reportBaseCandidates.map(
        (base) => `/api${base}/${encodeURIComponent(leadId)}/managerial-report`
      );
      const { url, data } = await requestJsonWithFallback(urls, { cache: "no-store" });
      state.reportEndpoint = url;

      const report = data?.report && typeof data.report === "object" ? data.report : data;
      const html = renderManagerialReportHtml(report || buildLocalFallbackReport(lead));
      openReportModalWithHtml(html);
      setNotice("Relatorio gerencial carregado.");
    } catch (_err) {
      const fallback = buildLocalFallbackReport(lead);
      const warningHtml = `<div class="k-message">Nao foi possivel carregar o relatorio completo do backend. Exibindo versao local resumida.</div>`;
      openReportModalWithHtml(`${warningHtml}${renderManagerialReportHtml(fallback)}`);
      setNotice("Relatorio exibido em modo local (fallback).", true);
    }
  }

  function extractMatchesItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  }

  function renderMatchesTable(wrap, items, isCompatibilityMode = false) {
    const rows = items
      .map((it) => {
        const nome = it.nome_fantasia || it.name || "-";
        const municipio = it.municipio_nome || it.municipio || it.cidade || "-";
        const prioridade = it.prioridade ?? it.priority ?? "-";
        const cnae = it.cnae_principal || it.cnae || "-";
        const scoreMatch = it.score ?? it.match_score ?? "-";
        return `
          <tr>
            <td>${escapeHtml(String(prioridade))}</td>
            <td>${escapeHtml(nome)}</td>
            <td>${escapeHtml(it.uf || "-")}</td>
            <td>${escapeHtml(municipio)}</td>
            <td>${escapeHtml(cnae)}</td>
            <td>${escapeHtml(String(scoreMatch))}</td>
          </tr>
        `;
      })
      .join("");

    const compatibilityNote = isCompatibilityMode
      ? `<div class="k-hidden-note">Matching em modo compatibilidade (similar ao Streamlit).</div>`
      : "";

    wrap.className = "k-matches";
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Prioridade</th>
            <th>Nome fantasia</th>
            <th>UF</th>
            <th>Municipio</th>
            <th>CNAE</th>
            <th>Score match</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${compatibilityNote}
    `;
  }

  async function buildMatchesByPartnersFallback(lead, limit = state.matchesLimit) {
    if (!lead) return [];

    const q = new URLSearchParams();
    const rawUfFilter = String(lead.rawUf || "").trim().toUpperCase();
    if (rawUfFilter) q.set("uf", rawUfFilter);

    const url = q.toString() ? `/api/partners?${q.toString()}` : "/api/partners";
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return [];

    const payload = await resp.json();
    const partners = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    if (!partners.length) return [];

    const leadSeg = foldText(lead.segmento);
    const leadUf = foldText(lead.rawUf || lead.uf);
    const leadCity = foldText(lead.rawCidade || lead.cidade);

    const ranked = partners
      .map((p) => {
        const decorated = decoratePartnerIdentity(p);
        let score = 0;
        if (leadSeg && segmentLooksSimilar(leadSeg, p.segmento || p.segment)) score += 4;
        if (leadUf && foldText(p.uf) === leadUf) score += 2;
        if (leadCity && foldText(p.municipio_nome || p.municipio || p.cidade) === leadCity) score += 3;

        const prioridadeRaw = String(p.prioridade || "").trim();
        const prioridadeNum = Number(prioridadeRaw);
        if (Number.isFinite(prioridadeNum)) {
          // prioridade menor = melhor
          score += Math.max(0, 4 - Math.min(prioridadeNum, 4));
        } else {
          const prioridade = foldText(prioridadeRaw);
          if (prioridade === "ALTA") score += 2;
          else if (prioridade === "MEDIA") score += 1;
        }

        return {
          ...p,
          ...decorated,
          score,
        };
      })
      .filter((p) => p.score > 0)
      .sort((a, b) => {
        if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
        return String(a.nome_fantasia || a.name || "").localeCompare(String(b.nome_fantasia || b.name || ""));
      });

    return ranked.slice(0, parseMatchesLimit(limit));
  }

  async function loadMatches(lead) {
    const wrap = document.getElementById("dMatchesWrap");
    if (!wrap) return;
    const limit = parseMatchesLimit(state.matchesLimit);

    wrap.className = "k-message";
    wrap.textContent = "Carregando matching...";

    try {
      const leadId = String(lead?.id || "").trim();
      const urls = matchesBaseCandidates.map(
        (base) => `/api${base}/${encodeURIComponent(leadId)}/matches?limit=${limit}`
      );

      const { url, data } = await requestJsonWithFallback(urls, { cache: "no-store" });
      state.matchesEndpoint = url;

      const items = extractMatchesItems(data);
      const alignedItems = await alignMatchesPartnerNames(items, lead);
      if (alignedItems.length) {
        renderMatchesTable(wrap, alignedItems, false);
        return;
      }

      const compatibilityItems = await buildMatchesByPartnersFallback(lead, limit);
      if (compatibilityItems.length) {
        renderMatchesTable(wrap, compatibilityItems, true);
        return;
      }

      wrap.className = "k-message";
      wrap.textContent = "Sem matches para este lead no momento.";
    } catch (err) {
      const compatibilityItems = await buildMatchesByPartnersFallback(lead, limit).catch(() => []);
      if (compatibilityItems.length) {
        renderMatchesTable(wrap, compatibilityItems, true);
        return;
      }

      wrap.className = "k-message";
      wrap.textContent = "Matching indisponivel agora.";
    }
  }

  async function updateStage() {
    const lead = findLeadById(state.selectedId);
    const stageEl = document.getElementById("dMoveStage");
    if (!lead || !stageEl) return;

    const nextStage = String(stageEl.value || "");
    if (!STAGE_BY_ID[nextStage]) return;

    try {
      const urls = moveCandidates.map((endpoint) => `/api${endpoint}`);
      const { url, data } = await requestJsonWithFallback(urls, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, stage: nextStage }),
      });
      state.moveEndpoint = url;
      const transition = data?.transition && typeof data.transition === "object" ? data.transition : {};
      const stageInfo =
        transition.from_stage && transition.to_stage
          ? `${transition.from_stage} -> ${transition.to_stage}`
          : `${lead.stage} -> ${nextStage}`;
      const scoreInfo =
        Number.isFinite(Number(transition.from_score)) && Number.isFinite(Number(transition.to_score))
          ? ` | score ${transition.from_score} -> ${transition.to_score}`
          : "";
      await refreshBoard({ preserveSelection: true });
      const refreshedLead = findLeadById(lead.id);
      const followupHint = buildFollowupHint(refreshedLead);
      const messageBase = `Etapa atualizada com sucesso (${stageInfo}${scoreInfo}).`;
      setNotice(followupHint ? `${messageBase} ${followupHint}` : messageBase);
    } catch (err) {
      setNotice("Nao foi possivel atualizar a etapa.", true);
    }
  }

  async function applyEventRule() {
    const lead = findLeadById(state.selectedId);
    const ruleEl = document.getElementById("dEventRule");
    const noteEl = document.getElementById("dEventNote");
    if (!lead || !(ruleEl instanceof HTMLSelectElement)) return;

    const ruleCode = normalizeRuleCode(ruleEl.value);
    if (!ruleCode) {
      setNotice("Selecione um evento objetivo para aplicar.", true);
      return;
    }

    const note = noteEl instanceof HTMLInputElement ? String(noteEl.value || "").trim() : "";
    const payload = {
      rule_code: ruleCode,
      source: "kanban_ui",
      metadata: note ? { note } : {},
    };

    try {
      const urls = applyRuleBaseCandidates.map(
        (base) => `/api${base}/${encodeURIComponent(lead.id)}/apply-rule`
      );
      const { url, data } = await requestJsonWithFallback(urls, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.applyRuleEndpoint = url;

      const transition = data?.transition && typeof data.transition === "object" ? data.transition : {};
      const rule =
        normalizeRule(data?.rule) ||
        getEventRules().find((item) => item.code === ruleCode) ||
        { code: ruleCode, label: ruleCode, delta: 0 };
      const stageInfo =
        transition.from_stage && transition.to_stage
          ? `${transition.from_stage} -> ${transition.to_stage}`
          : "-";
      const scoreInfo =
        Number.isFinite(Number(transition.from_score)) && Number.isFinite(Number(transition.to_score))
          ? `${transition.from_score} -> ${transition.to_score}`
          : "-";

      const missingSignals = Array.isArray(data?.qualification_gate?.missing_signals)
        ? data.qualification_gate.missing_signals.filter(Boolean)
        : [];
      const gateInfo = missingSignals.length ? ` | pendencias: ${missingSignals.join(", ")}` : "";
      const messageBase = `Evento aplicado (${rule.label} ${formatRuleDelta(rule.delta)}). Etapa ${stageInfo} | score ${scoreInfo}${gateInfo}.`;

      if (noteEl instanceof HTMLInputElement) noteEl.value = "";
      await refreshBoard({ preserveSelection: true });
      const refreshedLead = findLeadById(lead.id);
      const followupHint = buildFollowupHint(refreshedLead);
      setNotice(followupHint ? `${messageBase} ${followupHint}` : messageBase);
    } catch (_err) {
      setNotice("Nao foi possivel aplicar o evento agora.", true);
    }
  }

  async function saveNextAction() {
    const lead = findLeadById(state.selectedId);
    if (!lead) return;

    const text = String(document.getElementById("dNextText")?.value || "").trim();
    const date = String(document.getElementById("dNextDate")?.value || "").trim();
    const time = String(document.getElementById("dNextTime")?.value || "").trim();
    const isQualified = lead.stage === "QUALIFICADO";
    const hasText = Boolean(text);
    const hasDate = Boolean(date);
    const wantsTracking = hasText || hasDate;

    if (isQualified && wantsTracking && (!hasText || !hasDate)) {
      setNotice(
        "Para marcar QUALIFICADO como ACOMPANHANDO, preencha texto e data da proxima acao.",
        true
      );
      return;
    }

    const note = `NEXT_ACTION|${date}|${time}|${text}`;

    try {
      const urls = notesBaseCandidates.map(
        (base) => `/api${base}/${encodeURIComponent(lead.id)}/notes`
      );
      const { url } = await requestJsonWithFallback(urls, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      state.notesEndpoint = url;
      await refreshBoard({ preserveSelection: true });
      const refreshedLead = findLeadById(lead.id);
      const isTracking = isQualifiedTracking(refreshedLead);
      if (lead.stage === "QUALIFICADO" && isTracking) {
        setNotice("Proxima acao salva. Lead QUALIFICADO agora esta em ACOMPANHANDO.");
      } else if (lead.stage === "QUALIFICADO" && !hasText && !hasDate) {
        setNotice("Acompanhamento removido deste lead QUALIFICADO.");
      } else {
        setNotice("Proxima acao salva com sucesso.");
      }
    } catch (err) {
      setNotice("Nao foi possivel salvar a proxima acao.", true);
    }
  }

  async function refreshBoard(opts = {}) {
    const preserveSelection = Boolean(opts.preserveSelection);
    const selectedBefore = preserveSelection ? state.selectedId : null;

    if (ROOT) {
      ROOT.innerHTML = `<div class="k-message">Carregando board...</div>`;
    }

    await fetchBoard();

    if (preserveSelection) {
      state.selectedId = state.allItems.some((it) => it.id === selectedBefore) ? selectedBefore : null;
    } else {
      state.selectedId = null;
    }

    renderBoard();
  }

  function bindEvents() {
    SEARCH?.addEventListener("input", () => renderBoard());
    FILTER_STAGE?.addEventListener("change", () => renderBoard());
    FILTER_FOLLOWUP?.addEventListener("change", () => renderBoard());
    SORT?.addEventListener("change", () => renderBoard());
    LIMIT?.addEventListener("change", () => renderBoard());
    REFRESH?.addEventListener("click", () => refreshBoard({ preserveSelection: true }));

    ROOT?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action='open-details']");
      if (!button) return;

      const leadId = String(button.getAttribute("data-id") || "");
      if (!leadId) return;

      state.selectedId = leadId;
      renderDetails();
    });

    DETAILS_ROOT?.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id === "dMatchesLimit") {
        const nextLimit = parseMatchesLimit(target.value);
        state.matchesLimit = nextLimit;
        target.value = String(nextLimit);
        const badge = document.getElementById("dMatchesLimitValue");
        if (badge) badge.textContent = String(nextLimit);
        if (state.selectedId) {
          const lead = findLeadById(state.selectedId);
          if (lead) loadMatches(lead);
        }
        return;
      }

      if (!(target instanceof HTMLSelectElement)) return;

      if (target.id === "dLeadSelect") {
        const leadId = String(target.value || "");
        state.selectedId = leadId || null;
        renderDetails();
      }
    });

    DETAILS_ROOT?.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id !== "dMatchesLimit") return;
      const badge = document.getElementById("dMatchesLimitValue");
      if (badge) badge.textContent = String(parseMatchesLimit(target.value));
    });

    DETAILS_ROOT?.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.id === "dMoveBtn") {
        event.preventDefault();
        await updateStage();
      }

      if (target.id === "dApplyRuleBtn") {
        event.preventDefault();
        await applyEventRule();
      }

      if (target.id === "dSaveNextBtn") {
        event.preventDefault();
        await saveNextAction();
      }

      if (target.id === "dReloadMatchesBtn") {
        event.preventDefault();
        if (state.selectedId) {
          const lead = findLeadById(state.selectedId);
          if (lead) await loadMatches(lead);
        }
      }

      if (target.id === "dOpenReportBtn") {
        event.preventDefault();
        await openManagerialReport();
      }
    });
  }

  async function init() {
    if (!ROOT || !KPI_ROOT || !DETAILS_ROOT) return;
    bindEvents();
    await loadEventRules();
    await refreshBoard({ preserveSelection: false });

    if (state.source === "mock") {
      const info = document.createElement("div");
      info.className = "k-message mt-12";
      info.textContent = "Modo demo: board carregado por mock local (rotas do backend indisponiveis).";
      ROOT.parentElement?.appendChild(info);
    }
  }

  init();
})();
