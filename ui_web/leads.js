/* leads.js */
(function () {
  'use strict';

  let allLeads = [];
  let selectedIds = new Set();

  API.checkStatus();

  function statusClass(s) {
    return `badge-status ${(s || '').toUpperCase()}`;
  }

  function renderTable(leads) {
    const tbody = document.querySelector('#leadsTable tbody');
    if (!leads.length) {
      tbody.innerHTML = '<tr><td colspan="9">Nenhum lead encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = leads.map(l => `
      <tr data-id="${l.id}">
        <td><input type="checkbox" class="chk-lead" data-id="${l.id}" ${selectedIds.has(l.id) ? 'checked' : ''} /></td>
        <td>${l.nome || '—'}</td>
        <td>${l.whatsapp || '—'}</td>
        <td>${l.email || '—'}</td>
        <td>${l.uf || '—'}</td>
        <td>${l.segmento_interesse || '—'}</td>
        <td>${Number.isFinite(Number(l.score)) ? l.score : '—'}</td>
        <td><span class="${statusClass(l.status)}">${l.status || '—'}</span></td>
        <td>
          <button class="btn" data-action="score" data-id="${l.id}">Score</button>
          <button class="btn btn-danger" data-action="delete" data-id="${l.id}">Del</button>
        </td>
      </tr>
    `).join('');
  }

  async function loadLeads() {
    try {
      const status = document.getElementById('filterStatus').value;
      const uf = document.getElementById('filterUF').value;
      allLeads = await API.getLeads({ status, uf });

      const ufs = [...new Set(allLeads.map(l => l.uf).filter(Boolean))].sort();
      const filterUF = document.getElementById('filterUF');
      const currentUF = filterUF.value;
      filterUF.innerHTML = '<option value="">Todos os UFs</option>' + ufs.map(u => `<option value="${u}" ${u === currentUF ? 'selected' : ''}>${u}</option>`).join('');

      const name = document.getElementById('filterName').value.trim().toLowerCase();
      const filtered = name ? allLeads.filter(l => (l.nome || '').toLowerCase().includes(name)) : allLeads;
      renderTable(filtered);
    } catch (e) {
      document.querySelector('#leadsTable tbody').innerHTML = `<tr><td colspan="9" style="color:red">Erro: ${e.message}</td></tr>`;
    }
  }

  loadLeads();

  document.getElementById('btnFilter').addEventListener('click', loadLeads);

  document.getElementById('chkAll').addEventListener('change', function () {
    document.querySelectorAll('.chk-lead').forEach(c => {
      c.checked = this.checked;
      if (this.checked) selectedIds.add(c.dataset.id);
      else selectedIds.delete(c.dataset.id);
    });
    updateBulk();
  });

  document.querySelector('#leadsTable tbody').addEventListener('change', function (e) {
    if (!e.target.classList.contains('chk-lead')) return;
    if (e.target.checked) selectedIds.add(e.target.dataset.id);
    else selectedIds.delete(e.target.dataset.id);
    updateBulk();
  });

  function updateBulk() {
    document.getElementById('bulkActions').style.display = selectedIds.size ? '' : 'none';
  }

  document.getElementById('btnBulkDelete').addEventListener('click', async function () {
    if (!selectedIds.size) return;
    if (!confirm(`Excluir ${selectedIds.size} lead(s)?`)) return;
    try {
      await API.bulkDelete([...selectedIds]);
      selectedIds.clear();
      updateBulk();
      loadLeads();
    } catch (e) { alert('Erro: ' + e.message); }
  });

  document.querySelector('#leadsTable tbody').addEventListener('click', async function (e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'delete') {
      if (!confirm('Excluir este lead?')) return;
      try { await API.deleteLead(id); loadLeads(); } catch (e) { alert('Erro: ' + e.message); }
    }
    if (action === 'score') {
      try {
        btn.disabled = true;
        btn.textContent = '...';
        await API.scoreLead(id);
        loadLeads();
      } catch (e) { alert('Erro ao pontuar: ' + e.message); }
      finally { btn.disabled = false; btn.textContent = 'Score'; }
    }
  });

  document.getElementById('btnNewLead').addEventListener('click', () => {
    document.getElementById('modalLead').style.display = 'flex';
  });
  document.getElementById('btnCancelLead').addEventListener('click', () => {
    document.getElementById('modalLead').style.display = 'none';
  });
  document.getElementById('formLead').addEventListener('submit', async function (e) {
    e.preventDefault();
    const fd = new FormData(this);
    const body = Object.fromEntries(fd.entries());
    try {
      await API.createLead(body);
      document.getElementById('modalLead').style.display = 'none';
      this.reset();
      loadLeads();
    } catch (err) { alert('Erro ao criar lead: ' + err.message); }
  });
})();
