/* ============================================================
   api.js — camada de comunicação com o backend
   Expõe o objeto global `API` com métodos para todos os endpoints.
   O BASE_URL é lido do localStorage (chave 'apiBaseUrl') ou do
   padrão http://localhost:3000.
   ============================================================ */

(function () {
  'use strict';

  const DEFAULT_BASE = 'http://localhost:3000';

  function getBase() {
    try { return (localStorage.getItem('apiBaseUrl') || DEFAULT_BASE).replace(/\/$/, ''); } catch { return DEFAULT_BASE; }
  }

  async function req(method, path, body) {
    const url = getBase() + path;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
    return data;
  }

  const API = {
    setBase(url) { try { localStorage.setItem('apiBaseUrl', url); } catch {} },
    getBase,

    // Health
    health: () => req('GET', '/health'),

    // Leads
    getLeads: (params = {}) => {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
      ).toString();
      return req('GET', '/leads' + (qs ? '?' + qs : ''));
    },
    getLead: (id) => req('GET', `/leads/${id}`),
    createLead: (body) => req('POST', '/leads', body),
    updateLead: (id, body) => req('PATCH', `/leads/${id}`, body),
    deleteLead: (id) => req('DELETE', `/leads/${id}`),
    bulkDelete: (ids) => req('POST', '/leads/bulk-delete', { ids }),
    scoreLead: (id) => req('POST', `/leads/${id}/score`, {}),
    scoreDiagnostics: (id) => req('GET', `/leads/${id}/score-diagnostics`),

    // Próxima Ação
    getNextAction: (id) => req('GET', `/leads/${id}/next-action`),
    saveNextAction: (id, body) => req('POST', `/leads/${id}/next-action`, body),
    clearNextAction: (id) => req('DELETE', `/leads/${id}/next-action`),

    // CRM Board
    getBoard: () => req('GET', '/crm/board'),
    moveCard: (lead_id, stage) => req('POST', '/crm/move', { lead_id, stage }),
    getEventRules: () => req('GET', '/crm/event-rules'),
    applyRule: (id, rule_code, metadata = {}) => req('POST', `/crm/leads/${id}/apply-rule`, { rule_code, metadata }),

    // Notes
    getNotes: (id) => req('GET', `/crm/leads/${id}/notes`),
    addNote: (id, note) => req('POST', `/crm/leads/${id}/notes`, { note }),

    // Matches
    getMatches: (id, limit = 8) => req('GET', `/crm/leads/${id}/matches?limit=${limit}`),

    // Managerial report
    getManagerialReport: (id) => req('GET', `/crm/leads/${id}/managerial-report`),

    // ML info
    getMlModelInfo: () => req('GET', '/ml/model-info'),

    // Output routes
    getOutputLeads: (params = {}) => {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
      ).toString();
      return req('GET', '/output/leads' + (qs ? '?' + qs : ''));
    },
    exportOutputCSV: (params = {}) => {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
      ).toString();
      const url = getBase() + '/output/leads/csv' + (qs ? '?' + qs : '');
      window.open(url, '_blank');
    },
  };

  // Checar status da API e atualizar indicador visual
  API.checkStatus = async function () {
    const el = document.getElementById('apiStatus');
    if (!el) return;
    try {
      await API.health();
      el.textContent = '🟢 API';
      el.className = 'api-indicator ok';
    } catch {
      el.textContent = '🔴 API';
      el.className = 'api-indicator err';
    }
  };

  window.API = API;
})();
