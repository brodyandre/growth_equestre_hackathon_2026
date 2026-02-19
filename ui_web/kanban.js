/* kanban.js */
(function () {
  'use strict';

  API.checkStatus();

  let currentLeadId = null;
  let rules = [];

  const STAGES = ['INBOX', 'AQUECENDO', 'QUALIFICADO', 'ENVIADO'];

  function stageClass(s) {
    return 'stage-' + (s || 'inbox').toLowerCase();
  }

  function scoreColor(score) {
    const s = Number(score);
    if (s >= 70) return '#22c55e';
    if (s >= 40) return '#f97316';
    return '#94a3b8';
  }

  function buildCard(lead) {
    const stage = (lead.crm_stage || lead.status || 'INBOX').toUpperCase();
    const div = document.createElement('div');
    div.className = `kanban-card ${stageClass(stage)}`;
    div.dataset.id = lead.id;
    const na = lead.next_action_text
      ? `<div class="card-na">📌 ${lead.next_action_text}${lead.next_action_date ? ' · ' + lead.next_action_date : ''}</div>`
      : '';
    div.innerHTML = `
      <div class="card-name">${lead.nome || '—'}</div>
      <div class="card-meta">
        <span>${lead.uf || '—'}</span>
        <span>${lead.segmento_interesse || '—'}</span>
        <span class="card-score" style="color:${scoreColor(lead.score)}">${Number.isFinite(Number(lead.score)) ? lead.score : '—'}</span>
      </div>
      ${na}
    `;
    div.addEventListener('click', () => openCard(lead));
    return div;
  }

  async function loadBoard() {
    try {
      const data = await API.getBoard();
      const items = data.items || [];

      STAGES.forEach(s => {
        const body = document.querySelector(`.kanban-col-body[data-stage="${s}"]`);
        body.innerHTML = '';
        document.getElementById('badge-' + s).textContent = 0;
      });

      const counts = { INBOX: 0, AQUECENDO: 0, QUALIFICADO: 0, ENVIADO: 0 };
      items.forEach(lead => {
        const stage = (lead.crm_stage || lead.status || 'INBOX').toUpperCase();
        const col = stage in counts ? stage : 'INBOX';
        counts[col]++;
        const body = document.querySelector(`.kanban-col-body[data-stage="${col}"]`);
        if (body) body.appendChild(buildCard(lead));
      });
      STAGES.forEach(s => { document.getElementById('badge-' + s).textContent = counts[s]; });
    } catch (e) {
      console.error(e);
    }
  }

  async function loadRules() {
    try {
      const data = await API.getEventRules();
      rules = data.items || [];
      const sel = document.getElementById('ruleSelect');
      sel.innerHTML = '<option value="">Escolha uma regra…</option>' +
        rules.map(r => `<option value="${r.code}">${r.label} (${r.delta > 0 ? '+' : ''}${r.delta})</option>`).join('');
    } catch (e) { console.error(e); }
  }

  function openCard(lead) {
    currentLeadId = lead.id;
    document.getElementById('cardName').textContent = lead.nome || '—';
    document.getElementById('cardStage').textContent = lead.crm_stage || lead.status || '—';
    document.getElementById('cardUF').textContent = lead.uf || '—';
    document.getElementById('cardCidade').textContent = lead.cidade || '—';
    document.getElementById('cardSegmento').textContent = lead.segmento_interesse || '—';
    document.getElementById('cardWhats').textContent = lead.whatsapp || '—';
    document.getElementById('cardScore').textContent = lead.score ?? '—';
    document.getElementById('cardStatus').textContent = lead.status || '—';
    document.getElementById('naText').value = lead.next_action_text || '';
    document.getElementById('naDate').value = lead.next_action_date || '';
    document.getElementById('naTime').value = lead.next_action_time || '';
    document.getElementById('btnReport').href = `output.html#report-${lead.id}`;
    loadNotes(lead.id);
    document.getElementById('modalCard').style.display = 'flex';
  }

  async function loadNotes(id) {
    try {
      const data = await API.getNotes(id);
      const notes = data.notes || [];
      const list = document.getElementById('notesList');
      list.innerHTML = notes.length
        ? notes.map(n => `<div class="note-item"><strong>${n.type}</strong> · ${n.text.slice(0, 80)}</div>`).join('')
        : '<em>Sem notas.</em>';
    } catch { document.getElementById('notesList').innerHTML = '<em>Erro ao carregar notas.</em>'; }
  }

  document.getElementById('btnCloseCard').addEventListener('click', () => {
    document.getElementById('modalCard').style.display = 'none';
    currentLeadId = null;
  });

  document.getElementById('btnSaveNA').addEventListener('click', async () => {
    if (!currentLeadId) return;
    const text = document.getElementById('naText').value.trim();
    const date = document.getElementById('naDate').value;
    const time = document.getElementById('naTime').value;
    try {
      await API.saveNextAction(currentLeadId, { next_action_text: text, next_action_date: date, next_action_time: time });
      alert('Próxima ação salva!');
      loadBoard();
    } catch (e) { alert('Erro: ' + e.message); }
  });

  document.getElementById('btnClearNA').addEventListener('click', async () => {
    if (!currentLeadId) return;
    try { await API.clearNextAction(currentLeadId); alert('Próxima ação removida.'); loadBoard(); }
    catch (e) { alert('Erro: ' + e.message); }
  });

  document.getElementById('btnApplyRule').addEventListener('click', async () => {
    if (!currentLeadId) return;
    const code = document.getElementById('ruleSelect').value;
    if (!code) { alert('Selecione uma regra.'); return; }
    try {
      const r = await API.applyRule(currentLeadId, code);
      alert(`Regra aplicada! Score: ${r.lead?.score} → Estágio: ${r.lead?.crm_stage}`);
      document.getElementById('cardScore').textContent = r.lead?.score ?? '—';
      document.getElementById('cardStage').textContent = r.lead?.crm_stage || '—';
      loadBoard();
    } catch (e) { alert('Erro: ' + e.message); }
  });

  document.querySelectorAll('.stage-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentLeadId) return;
      const stage = btn.dataset.stage;
      try {
        await API.moveCard(currentLeadId, stage);
        document.getElementById('cardStage').textContent = stage;
        loadBoard();
      } catch (e) { alert('Erro: ' + e.message); }
    });
  });

  document.getElementById('btnAddNote').addEventListener('click', async () => {
    if (!currentLeadId) return;
    const note = document.getElementById('noteInput').value.trim();
    if (!note) { alert('Nota vazia.'); return; }
    try {
      await API.addNote(currentLeadId, note);
      document.getElementById('noteInput').value = '';
      loadNotes(currentLeadId);
    } catch (e) { alert('Erro: ' + e.message); }
  });

  document.getElementById('btnRefresh').addEventListener('click', loadBoard);

  loadBoard();
  loadRules();
})();
