/* dashboard.js */
(async function () {
  'use strict';

  API.checkStatus();

  function statusClass(s) {
    return `badge-status ${(s || '').toUpperCase()}`;
  }

  try {
    const leads = await API.getLeads();

    // KPIs
    const total = leads.length;
    const qualificados = leads.filter(l => (l.status || '').toUpperCase() === 'QUALIFICADO').length;
    const enviados = leads.filter(l => (l.crm_stage || l.status || '').toUpperCase() === 'ENVIADO').length;
    const scores = leads.map(l => Number(l.score)).filter(n => Number.isFinite(n));
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const kpis = document.querySelectorAll('.kpi-card');
    const vals = [total, qualificados, avgScore, enviados];
    kpis.forEach((card, i) => {
      card.classList.remove('loading');
      card.querySelector('.kpi-value').textContent = vals[i];
    });

    // Stage bars
    const stageCount = { INBOX: 0, AQUECENDO: 0, QUALIFICADO: 0, ENVIADO: 0 };
    leads.forEach(l => {
      const s = (l.crm_stage || l.status || 'INBOX').toUpperCase();
      if (s in stageCount) stageCount[s]++;
      else stageCount.INBOX++;
    });
    const maxCount = Math.max(1, ...Object.values(stageCount));
    const stageLabels = { INBOX: 'Inbox', AQUECENDO: 'Aquecendo', QUALIFICADO: 'Qualificado', ENVIADO: 'Enviado' };
    const stageFills = { INBOX: 'fill-inbox', AQUECENDO: 'fill-aquecendo', QUALIFICADO: 'fill-qualificado', ENVIADO: 'fill-enviado' };

    const barsEl = document.getElementById('stageBars');
    barsEl.innerHTML = Object.keys(stageCount).map(s => `
      <div class="stage-bar-row">
        <span class="stage-bar-label">${stageLabels[s]}</span>
        <div class="stage-bar-track">
          <div class="stage-bar-fill ${stageFills[s]}" style="width:${(stageCount[s] / maxCount * 100).toFixed(1)}%"></div>
        </div>
        <span class="stage-bar-count">${stageCount[s]}</span>
      </div>
    `).join('');

    // Recent leads table
    const tbody = document.querySelector('#recentLeadsTable tbody');
    const recent = [...leads].slice(0, 15);
    tbody.innerHTML = recent.length ? recent.map(l => `
      <tr>
        <td>${l.nome || '—'}</td>
        <td>${l.uf || '—'}</td>
        <td>${l.segmento_interesse || '—'}</td>
        <td>${Number.isFinite(Number(l.score)) ? l.score : '—'}</td>
        <td><span class="${statusClass(l.status)}">${l.status || '—'}</span></td>
        <td>${l.crm_stage || l.status || '—'}</td>
      </tr>
    `).join('') : '<tr><td colspan="6">Nenhum lead encontrado.</td></tr>';

  } catch (e) {
    console.error(e);
    document.getElementById('kpiGrid').innerHTML = `<p style="color:red">Erro ao carregar: ${e.message}</p>`;
  }
})();
