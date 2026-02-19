/* output.js */
(function () {
  'use strict';

  API.checkStatus();

  let currentData = [];

  function showStatus(msg, type = 'info') {
    const el = document.getElementById('reportStatus');
    el.textContent = msg;
    el.className = 'alert ' + type;
    el.style.display = '';
    if (type !== 'error') setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  function renderTable(items) {
    const tbody = document.querySelector('#outputTable tbody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="9">Nenhum resultado encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((l, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${l.nome || '—'}</td>
        <td>${l.uf || '—'}</td>
        <td>${l.segmento_interesse || l.segmento || '—'}</td>
        <td>${Number.isFinite(Number(l.score)) ? l.score : '—'}</td>
        <td>${l.status || '—'}</td>
        <td>${l.crm_stage || '—'}</td>
        <td>${l.next_action_text || '—'}</td>
        <td>${l.next_action_date || '—'}</td>
      </tr>
    `).join('');
  }

  async function generate() {
    const stage = document.getElementById('filterStage').value;
    const segmento = document.getElementById('filterSegmento').value;
    showStatus('Carregando...', 'info');
    try {
      let data;
      try {
        data = await API.getOutputLeads({ stage, segmento });
        currentData = Array.isArray(data) ? data : (data.items || data.leads || []);
      } catch {
        const leads = await API.getLeads();
        currentData = leads.filter(l => {
          const s = (l.crm_stage || l.status || '').toUpperCase();
          const seg = (l.segmento_interesse || '').toUpperCase();
          return (!stage || s === stage) && (!segmento || seg === segmento);
        });
      }
      renderTable(currentData);
      showStatus(`${currentData.length} lead(s) carregado(s).`, 'success');
    } catch (e) {
      showStatus('Erro: ' + e.message, 'error');
    }
  }

  document.getElementById('btnGenerate').addEventListener('click', generate);

  document.getElementById('btnExportCSV').addEventListener('click', () => {
    if (!currentData.length) { alert('Gere o relatório primeiro.'); return; }
    const headers = ['nome', 'uf', 'cidade', 'segmento_interesse', 'score', 'status', 'crm_stage', 'next_action_text', 'next_action_date'];
    const rows = currentData.map(l => headers.map(h => JSON.stringify(l[h] ?? '')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'leads_output.csv'; a.click();
    URL.revokeObjectURL(url);
  });

  API.getMlModelInfo().then(info => {
    const el = document.getElementById('mlInfo');
    if (!info.available) {
      el.innerHTML = '<p class="ml-card">Relatório de modelo ML não encontrado.</p>';
      return;
    }
    el.innerHTML = `
      <div class="ml-card">
        <p>🏆 <strong>Modelo vencedor:</strong> <span class="model-name">${info.winner?.label || info.winner?.id || '—'}</span></p>
        <p>🥈 <strong>Runner-up:</strong> ${info.runner_up?.label || info.runner_up?.id || '—'}</p>
        ${info.fine_tuning?.summary ? `<p>⚙️ <strong>Fine-tuning:</strong> ${info.fine_tuning.summary}</p>` : ''}
        ${info.selection_reasons?.length ? `<p>📋 <strong>Motivos:</strong> ${info.selection_reasons.join(' · ')}</p>` : ''}
        <p style="color:#aaa;font-size:.78rem">Atualizado: ${info.report_updated_at ? new Date(info.report_updated_at).toLocaleString('pt-BR') : '—'}</p>
      </div>
    `;
  }).catch(() => {
    document.getElementById('mlInfo').innerHTML = '<p class="ml-card">Não foi possível carregar informações do modelo.</p>';
  });
})();
