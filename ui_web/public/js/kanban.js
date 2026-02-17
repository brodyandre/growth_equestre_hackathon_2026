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
  const SORT = document.getElementById("kSort");
  const LIMIT = document.getElementById("kLimit");
  const REFRESH = document.getElementById("kRefresh");

  const paths = window.__GE__?.paths || {};
  const boardPath = paths.kanban || "/crm/board";
  const movePath = paths.kanbanMove || "/crm/move";
  const notesBase = paths.crmNotesBase || "/crm/leads";
  const matchesBase = paths.crmMatchesBase || "/crm/leads";

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

    KPI_ROOT.innerHTML = STAGES.map((s) => {
      const count = grouped[s.id]?.length || 0;
      return `
        <article class="kpi-box" style="border-top: 3px solid ${s.color};">
          <div class="kpi-label">${s.label}</div>
          <div class="kpi-value">${count} lead(s)</div>
        </article>
      `;
    }).join("");
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

          return `
            <article class="k-card">
              <div class="k-card-title">${escapeHtml(lead.nome)}</div>
              <div class="k-card-location">${escapeHtml(location)}</div>
              <div class="k-chip-row">
                <span class="k-chip">${escapeHtml(segment)}</span>
                <span class="k-chip">score: ${escapeHtml(formatScore(lead.score))}</span>
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
        const label = `${lead.nome} - ${stage} - score=${score}`;
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

      <div class="k-form">
        <label class="field">
          <span>Mover etapa</span>
          <select id="dMoveStage" class="input">
            ${stageOptionsHtml(lead.stage)}
          </select>
        </label>
        <button id="dMoveBtn" class="btn">Atualizar etapa</button>
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
      const { url } = await requestJsonWithFallback(urls, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, stage: nextStage }),
      });
      state.moveEndpoint = url;
      setNotice("Etapa atualizada com sucesso.");
      await refreshBoard({ preserveSelection: true });
    } catch (err) {
      setNotice("Nao foi possivel atualizar a etapa.", true);
    }
  }

  async function saveNextAction() {
    const lead = findLeadById(state.selectedId);
    if (!lead) return;

    const text = String(document.getElementById("dNextText")?.value || "").trim();
    const date = String(document.getElementById("dNextDate")?.value || "").trim();
    const time = String(document.getElementById("dNextTime")?.value || "").trim();

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
      setNotice("Proxima acao salva com sucesso.");
      await refreshBoard({ preserveSelection: true });
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
    });
  }

  async function init() {
    if (!ROOT || !KPI_ROOT || !DETAILS_ROOT) return;
    bindEvents();
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
