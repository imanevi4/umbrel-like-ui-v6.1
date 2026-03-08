const state = {
  me: null,
  settings: null,
  portalState: { servers: [], services: [], meta: {} },
  metrics: null,
  authLogs: [],
  onlineUsers: [],
  users: [],
  discovery: [],
  search: '',
  localPrefs: loadLocalPrefs(),
  statsCollapsed: false,
};

function loadLocalPrefs() {
  const defaults = {
    themeMode: 'dark',
    accent: '#9f7aea',
    glass: true,
    glowTopColor: '#9f7aea',
    glowLeftColor: '#21c7b7',
    glowBottomColor: '#5d3891',
    glowTopStrength: 0.18,
    glowLeftStrength: 0.18,
    glowBottomStrength: 0.2,
  };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem('portal-ui-prefs') || '{}')) };
  } catch {
    return defaults;
  }
}
function saveLocalPrefs() { localStorage.setItem('portal-ui-prefs', JSON.stringify(state.localPrefs)); }
function hexToRgbString(hex) {
  const clean = (hex || '#000000').replace('#', '');
  const value = clean.length === 3 ? clean.split('').map(x => x + x).join('') : clean.padEnd(6, '0').slice(0, 6);
  const int = parseInt(value, 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}
function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }
function isAdmin() { return state.me?.role === 'admin'; }
function serverServices(serverId) { return state.portalState.services.filter(s => s.serverId === serverId).sort(byOrder); }
function visibleServers() {
  const q = state.search.trim().toLowerCase();
  const servers = [...state.portalState.servers].sort(byOrder);
  if (!q) return servers;
  return servers.filter(server => {
    const matchedServer = [server.name, server.ip, server.baseUrl, server.description, ...(server.tags || [])].join(' ').toLowerCase().includes(q);
    const matchedService = serverServices(server.id).some(service => serviceMatches(service, server, q));
    return matchedServer || matchedService;
  });
}
function visibleServicesForServer(server) {
  const q = state.search.trim().toLowerCase();
  const services = serverServices(server.id);
  if (!q) return services;
  return services.filter(service => serviceMatches(service, server, q));
}
function serviceMatches(service, server, q) {
  const blob = [
    service.name, service.url, service.description, service.category, service.notes,
    server?.name, server?.ip, server?.baseUrl,
    ...(service.credentials || []).map(x => `${x.label} ${x.value}`),
    ...(service.links || []).map(x => `${x.label} ${x.url}`),
  ].join(' ').toLowerCase();
  return blob.includes(q);
}
function api(path, options = {}) {
  return fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  }).then(async (res) => {
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
    if (!res.ok) throw new Error(body?.error || body || `HTTP ${res.status}`);
    return body;
  });
}
function apiForm(path, formData, options = {}) {
  return fetch(path, { method: 'POST', body: formData, ...options }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body;
  });
}
async function loadAll() {
  const meRes = await api('/api/me');
  state.me = meRes.user;
  state.settings = meRes.settings;
  applyTheme();
  const [portalState, metrics, authLogs, onlineUsers] = await Promise.all([
    api('/api/state'),
    api('/api/system/metrics'),
    isAdmin() ? api('/api/auth/logs?limit=12').catch(() => []) : Promise.resolve([]),
    api('/api/auth/online-users').catch(() => []),
  ]);
  state.portalState = portalState;
  state.metrics = metrics;
  state.authLogs = authLogs;
  state.onlineUsers = onlineUsers;
  if (isAdmin()) state.users = await api('/api/users').catch(() => []);
  render();
}
function applyTheme() {
  const body = document.body;
  const mode = state.localPrefs.themeMode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : state.localPrefs.themeMode;
  body.classList.toggle('theme-light', mode === 'light');
  body.classList.toggle('theme-dark', mode !== 'light');
  body.classList.remove('density-comfortable', 'density-compact', 'density-ultra-compact');
  body.classList.add(`density-${state.settings?.densityMode || 'comfortable'}`);
  document.documentElement.style.setProperty('--accent', state.localPrefs.accent);
  document.documentElement.style.setProperty('--glow-top-color', hexToRgbString(state.localPrefs.glowTopColor));
  document.documentElement.style.setProperty('--glow-left-color', hexToRgbString(state.localPrefs.glowLeftColor));
  document.documentElement.style.setProperty('--glow-bottom-color', hexToRgbString(state.localPrefs.glowBottomColor));
  document.documentElement.style.setProperty('--glow-top-strength', String(state.localPrefs.glowTopStrength));
  document.documentElement.style.setProperty('--glow-left-strength', String(state.localPrefs.glowLeftStrength));
  document.documentElement.style.setProperty('--glow-bottom-strength', String(state.localPrefs.glowBottomStrength));
}
function render() {
  applyHeader();
  renderStats();
  renderWidgets();
  renderServers();
}
function applyHeader() {
  document.getElementById('portalBadgeText').textContent = state.settings.portalBadgeText || 'Portal';
  document.getElementById('portalTitle').textContent = state.settings.portalTitle || 'Portal';
  document.getElementById('portalSubtitle').textContent = state.settings.portalSubtitle || '';
  document.getElementById('searchInput').value = state.search;
  const avatar = state.me?.avatarUrl ? `<img class="user-avatar" src="${escapeHtml(state.me.avatarUrl)}" alt="avatar" />` : `<span class="user-avatar" style="display:flex;align-items:center;justify-content:center">${escapeHtml((state.me?.username || '?').slice(0,1).toUpperCase())}</span>`;
  document.getElementById('userArea').innerHTML = `
    <button class="btn user-chip" id="userMenuBtn">${avatar}<span>${escapeHtml(state.me?.username || '')}</span><span class="muted">${escapeHtml(state.me?.role || '')}</span></button>
  `;
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin()));
}
function renderStats() {
  const wrap = document.getElementById('statsWrap');
  const mode = state.settings.statsMode || 'compact';
  if (mode === 'hidden') { wrap.classList.add('hidden'); return; }
  wrap.classList.toggle('hidden', state.statsCollapsed);
  if (state.statsCollapsed) return;
  const metrics = state.metrics || { memory: {}, disk: {} };
  const serviceCount = state.portalState.services.length;
  const serverCount = state.portalState.servers.length;
  const onlineCount = state.onlineUsers.length;
  const cards = [
    { label: 'Серверы', value: serverCount },
    { label: 'Сервисы', value: serviceCount },
    { label: 'RAM', value: `${metrics.memory.usedGb ?? '-'} / ${metrics.memory.totalGb ?? '-'} Gb` },
    { label: 'Disk', value: `${metrics.disk.usedGb ?? '-'} / ${metrics.disk.totalGb ?? '-'} Gb` },
  ];
  wrap.innerHTML = cards.map(card => `<div class="panel stat-card"><div class="label">${escapeHtml(card.label)}</div><div class="value">${escapeHtml(card.value)}</div><div class="muted" style="margin-top:6px">Онлайн: ${onlineCount}</div></div>`).join('');
}
function widgetEnabled(type) {
  return (state.settings.widgets || []).find(w => w.type === type && w.enabled);
}
function renderWidgets() {
  const wrap = document.getElementById('widgetsWrap');
  const grid = document.getElementById('widgetsGrid');
  const widgets = (state.settings.widgets || []).filter(w => w.enabled).sort(byOrder);
  if (!widgets.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  grid.innerHTML = widgets.map(w => renderWidget(w)).join('');
}
function renderWidget(widget) {
  if (widget.type === 'disk') {
    const d = state.metrics?.disk || {};
    return `<section class="panel widget-card"><h3>Диск</h3><div class="muted" style="margin-top:8px">Свободно ${d.freeGb ?? '-'} Gb</div><div class="value" style="font-size:24px;margin-top:6px">${d.usedGb ?? '-'} / ${d.totalGb ?? '-'} Gb</div><div class="muted" style="margin-top:6px">Использовано ${d.percentUsed ?? '-'}%</div></section>`;
  }
  if (widget.type === 'ram') {
    const m = state.metrics?.memory || {};
    return `<section class="panel widget-card"><h3>RAM</h3><div class="muted" style="margin-top:8px">Свободно ${m.freeGb ?? '-'} Gb</div><div class="value" style="font-size:24px;margin-top:6px">${m.usedGb ?? '-'} / ${m.totalGb ?? '-'} Gb</div><div class="muted" style="margin-top:6px">Использовано ${m.percentUsed ?? '-'}%</div></section>`;
  }
  if (widget.type === 'auth-log') {
    return `<section class="panel widget-card"><h3>Auth log</h3><div class="widget-list">${(state.authLogs || []).slice(0,8).map(item => `<div class="widget-row"><span>${escapeHtml(item.username || '-')}</span><span>${escapeHtml(item.event || '-')}</span><span>${escapeHtml(item.ip || '-')}</span></div>`).join('') || '<div class="muted">Нет событий</div>'}</div></section>`;
  }
  if (widget.type === 'online-users') {
    return `<section class="panel widget-card"><h3>Сейчас онлайн</h3><div class="widget-list">${(state.onlineUsers || []).map(item => `<div class="widget-row"><span>${escapeHtml(item.username)}</span><span>${escapeHtml(item.ip || '-')}</span><span>${new Date(item.lastSeen).toLocaleTimeString()}</span></div>`).join('') || '<div class="muted">Никого нет</div>'}</div></section>`;
  }
  return `<section class="panel widget-card"><h3>${escapeHtml(widget.type)}</h3></section>`;
}
function renderServers() {
  const root = document.getElementById('serversRoot');
  const servers = visibleServers();
  if (!servers.length) {
    root.innerHTML = `<section class="panel empty">Ничего не найдено. Измени поиск или добавь сервер/сервис.</section>`;
    return;
  }
  root.innerHTML = servers.map(renderServer).join('');
  attachServerHandlers();
}
function fallbackServerIcon(server) {
  return `<div class="server-icon">${escapeHtml((server.name || 'S').slice(0,1).toUpperCase())}</div>`;
}
function renderServer(server) {
  const services = visibleServicesForServer(server);
  const expanded = state.search ? true : server.expanded !== false;
  const onlineCount = services.length;
  const serverIcon = server.iconUrl ? `<img class="server-icon" src="${escapeHtml(server.iconUrl)}" alt="${escapeHtml(server.name)}" />` : fallbackServerIcon(server);
  return `
    <section class="panel server-card" data-server-id="${escapeHtml(server.id)}">
      <div class="server-head">
        <div class="server-title">
          ${serverIcon}
          <div>
            <h2>${escapeHtml(server.name)}</h2>
            <div class="server-meta">${escapeHtml(server.ip || '')} · ${escapeHtml(server.baseUrl || '')} · ${services.length} сервисов</div>
          </div>
        </div>
        <div class="server-actions">
          <span class="pill" style="padding:8px 12px">Онлайн: ${onlineCount}</span>
          ${isAdmin() ? `<button class="btn icon-only" data-action="edit-server" data-id="${escapeHtml(server.id)}" title="Редактировать">✎</button>` : ''}
          ${isAdmin() ? `<button class="btn icon-only danger" data-action="delete-server" data-id="${escapeHtml(server.id)}" title="Удалить сервер">🗑</button>` : ''}
          <button class="btn icon-only" data-action="toggle-server" data-id="${escapeHtml(server.id)}" title="Свернуть / развернуть"><span class="chevron ${expanded ? '' : 'collapsed'}">⌄</span></button>
        </div>
      </div>
      <div class="services-grid ${expanded ? '' : 'hidden'}">
        ${services.length ? services.map(renderServiceCard).join('') : `<div class="empty">В этом сервере пока нет сервисов.</div>`}
      </div>
    </section>
  `;
}
function renderServiceCard(service) {
  const icon = service.iconUrl ? `<img class="service-icon" src="${escapeHtml(service.iconUrl)}" alt="${escapeHtml(service.name)}" />` : `<div class="service-icon" style="display:flex;align-items:center;justify-content:center;font-weight:700">${escapeHtml((service.name || 'S').slice(0,1).toUpperCase())}</div>`;
  const creds = (service.credentials || []).slice(0, 2).map(c => `<div class="cred-row"><strong>${escapeHtml(c.label)}</strong><span>${c.secret ? '••••••••' : escapeHtml(c.value)}</span></div>`).join('');
  const links = (service.links || []).slice(0, 2).map(l => `<div class="link-row"><strong>${escapeHtml(l.label)}</strong><a href="${escapeHtml(l.url)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">Открыть</a></div>`).join('');
  const buttonsStyle = state.settings.actionButtonsStyle || 'icons-with-text';
  const btnClass = buttonsStyle === 'icons-only' ? 'mini-btn icon-only' : 'mini-btn';
  const labels = buttonsStyle === 'icons-only' ? { open: '↗', edit: '✎', delete: '🗑' } : { open: '↗ Открыть', edit: '✎ Изменить', delete: '🗑' };
  const visibilityClass = state.settings.actionButtonsVisibility === 'hover' ? 'service-actions-hover' : '';
  return `
    <article class="panel service-card ${visibilityClass}" data-service-id="${escapeHtml(service.id)}" data-open-url="${escapeHtml(service.url)}">
      <div class="service-top">
        <div class="service-title">${icon}<div><div class="service-name">${escapeHtml(service.name)}</div><div class="service-desc">${escapeHtml(service.description || 'Без описания')}</div></div></div>
        <div class="dot" title="Настроен"></div>
      </div>
      <div class="service-url">${escapeHtml(service.url || '')}</div>
      ${creds || links ? `<div class="hr"></div>${creds}${links}` : ''}
      <div class="service-footer">
        <span class="mini-pill" style="padding:6px 10px">${escapeHtml(service.category || 'Service')}</span>
        ${service.notes ? `<span class="mini-pill" style="padding:6px 10px">Notes</span>` : ''}
      </div>
      <div class="action-row">
        <button class="${btnClass}" data-action="open-service" data-id="${escapeHtml(service.id)}">${labels.open}</button>
        ${isAdmin() ? `<button class="${btnClass}" data-action="edit-service" data-id="${escapeHtml(service.id)}">${labels.edit}</button>` : ''}
        ${isAdmin() ? `<button class="${btnClass} delete" data-action="delete-service" data-id="${escapeHtml(service.id)}">${labels.delete}</button>` : ''}
      </div>
    </article>
  `;
}
function attachServerHandlers() {
  document.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = el.dataset.action;
      const id = el.dataset.id;
      if (action === 'toggle-server') return toggleServer(id);
      if (action === 'edit-server') return openServerModal(id);
      if (action === 'delete-server') return deleteServer(id);
      if (action === 'edit-service') return openServiceModal(id);
      if (action === 'delete-service') return deleteService(id);
      if (action === 'open-service') return openService(id);
    });
  });
  document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button,a,input,label')) return;
      const url = card.dataset.openUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    });
  });
}
async function toggleServer(serverId) {
  const server = state.portalState.servers.find(s => s.id === serverId);
  await api(`/api/servers/${serverId}`, { method: 'PUT', body: JSON.stringify({ expanded: !(server.expanded !== false) }) });
  await refreshState();
}
function openService(serviceId) {
  const service = state.portalState.services.find(s => s.id === serviceId);
  if (service?.url) window.open(service.url, '_blank', 'noopener,noreferrer');
}
async function deleteService(serviceId) {
  if (!confirm('Удалить сервис?')) return;
  await api(`/api/services/${serviceId}`, { method: 'DELETE' });
  await refreshState();
}
async function deleteServer(serverId) {
  if (!confirm('Удалить сервер вместе со всеми сервисами?')) return;
  await api(`/api/servers/${serverId}?cascade=true`, { method: 'DELETE' });
  await refreshState();
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function openModal(inner) {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="panel modal">${inner}<button class="btn icon-only modal-close" id="closeModalBtn">✕</button></div></div>`;
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });
}
function openServerModal(serverId = null) {
  const server = serverId ? state.portalState.servers.find(s => s.id === serverId) : { name: '', ip: '', baseUrl: '', description: '', iconUrl: '', tags: [] };
  openModal(`
    <h2>${serverId ? 'Редактировать сервер' : 'Добавить сервер'}</h2>
    <form id="serverForm" class="form-stack">
      <div class="form-grid">
        <label>Название<input class="input" name="name" value="${escapeHtml(server.name || '')}" required /></label>
        <label>IP<input class="input" name="ip" value="${escapeHtml(server.ip || '')}" /></label>
        <label>Base URL<input class="input" name="baseUrl" value="${escapeHtml(server.baseUrl || '')}" /></label>
        <label>Icon URL<input class="input" name="iconUrl" value="${escapeHtml(server.iconUrl || '')}" /></label>
      </div>
      <label>Описание<textarea name="description">${escapeHtml(server.description || '')}</textarea></label>
      <label>Tags (через запятую)<input class="input" name="tags" value="${escapeHtml((server.tags || []).join(', '))}" /></label>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="cancelServerBtn">Отмена</button><button class="btn primary">Сохранить</button></div>
    </form>
  `);
  document.getElementById('cancelServerBtn').onclick = closeModal;
  document.getElementById('serverForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form.entries());
    payload.tags = String(payload.tags || '').split(',').map(x => x.trim()).filter(Boolean);
    if (serverId) await api(`/api/servers/${serverId}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/servers', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    await refreshState();
  };
}
function credentialRowHtml(item = {}) {
  return `<div class="list-editor-row cred-item"><input class="input" name="credLabel" placeholder="Label" value="${escapeHtml(item.label || '')}" /><input class="input" name="credValue" placeholder="Value" value="${escapeHtml(item.value || '')}" /><label><input type="checkbox" name="credSecret" ${item.secret ? 'checked' : ''}/> Secret</label><label><input type="checkbox" name="credCopy" ${item.copyable !== false ? 'checked' : ''}/> Copyable</label><button type="button" class="btn icon-only remove-row">✕</button></div>`;
}
function linkRowHtml(item = {}) {
  return `<div class="list-editor-row links link-item"><input class="input" name="linkLabel" placeholder="Label" value="${escapeHtml(item.label || '')}" /><input class="input" name="linkUrl" placeholder="URL" value="${escapeHtml(item.url || '')}" /><button type="button" class="btn icon-only remove-row">✕</button></div>`;
}
function wireListEditor(root) {
  root.querySelectorAll('.remove-row').forEach(btn => btn.onclick = () => btn.parentElement.remove());
}
function collectCredentials(root) {
  return Array.from(root.querySelectorAll('.cred-item')).map((row, idx) => ({
    id: `cred-${idx + 1}-${Date.now()}`,
    label: row.querySelector('[name="credLabel"]').value.trim(),
    value: row.querySelector('[name="credValue"]').value,
    secret: row.querySelector('[name="credSecret"]').checked,
    copyable: row.querySelector('[name="credCopy"]').checked,
  })).filter(x => x.label || x.value);
}
function collectLinks(root) {
  return Array.from(root.querySelectorAll('.link-item')).map((row, idx) => ({
    id: `link-${idx + 1}-${Date.now()}`,
    label: row.querySelector('[name="linkLabel"]').value.trim(),
    url: row.querySelector('[name="linkUrl"]').value.trim(),
  })).filter(x => x.label || x.url);
}
function openServiceModal(serviceId = null) {
  const service = serviceId ? state.portalState.services.find(s => s.id === serviceId) : { serverId: state.portalState.servers[0]?.id || '', name: '', url: '', description: '', category: '', iconUrl: '', healthUrl: '', checkMethod: 'auto', pinned: false, credentials: [], links: [], notes: '' };
  openModal(`
    <h2>${serviceId ? 'Редактировать сервис' : 'Добавить сервис'}</h2>
    <div class="help" style="margin-bottom:12px">Credentials маскируются в UI, но не являются vault-хранилищем.</div>
    <form id="serviceForm" class="form-stack">
      <div class="form-grid">
        <label>Сервер<select class="select" name="serverId">${state.portalState.servers.sort(byOrder).map(s => `<option value="${escapeHtml(s.id)}" ${s.id === service.serverId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></label>
        <label>Название<input class="input" name="name" value="${escapeHtml(service.name || '')}" required /></label>
        <label>URL<input class="input" name="url" value="${escapeHtml(service.url || '')}" /></label>
        <label>Категория<input class="input" name="category" value="${escapeHtml(service.category || '')}" /></label>
        <label>Health URL<input class="input" name="healthUrl" value="${escapeHtml(service.healthUrl || '')}" /></label>
        <label>Icon URL<input class="input" name="iconUrl" value="${escapeHtml(service.iconUrl || '')}" /></label>
      </div>
      <label>Описание<textarea name="description">${escapeHtml(service.description || '')}</textarea></label>
      <div class="form-grid">
        <label>Check method<select class="select" name="checkMethod">${['auto','http','ping','disabled'].map(x => `<option value="${x}" ${x === service.checkMethod ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label><span>Закрепить</span><input type="checkbox" name="pinned" ${service.pinned ? 'checked' : ''} /></label>
      </div>
      <label>Notes<textarea name="notes">${escapeHtml(service.notes || '')}</textarea></label>
      <div class="hr"></div>
      <div class="section-head"><h3>Credentials</h3><button type="button" class="btn" id="addCredBtn">+ Добавить поле</button></div>
      <div class="list-editor" id="credentialsEditor">${(service.credentials || []).map(credentialRowHtml).join('')}</div>
      <div class="hr"></div>
      <div class="section-head"><h3>Links</h3><button type="button" class="btn" id="addLinkBtn">+ Добавить ссылку</button></div>
      <div class="list-editor" id="linksEditor">${(service.links || []).map(linkRowHtml).join('')}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="cancelServiceBtn">Отмена</button><button class="btn primary">Сохранить</button></div>
    </form>
  `);
  const credsRoot = document.getElementById('credentialsEditor');
  const linksRoot = document.getElementById('linksEditor');
  wireListEditor(document.getElementById('modalRoot'));
  document.getElementById('addCredBtn').onclick = () => { credsRoot.insertAdjacentHTML('beforeend', credentialRowHtml()); wireListEditor(document.getElementById('modalRoot')); };
  document.getElementById('addLinkBtn').onclick = () => { linksRoot.insertAdjacentHTML('beforeend', linkRowHtml()); wireListEditor(document.getElementById('modalRoot')); };
  document.getElementById('cancelServiceBtn').onclick = closeModal;
  document.getElementById('serviceForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form.entries());
    payload.pinned = !!form.get('pinned');
    payload.credentials = collectCredentials(credsRoot);
    payload.links = collectLinks(linksRoot);
    if (serviceId) await api(`/api/services/${serviceId}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/services', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    await refreshState();
  };
}
function openSettingsModal() {
  const lp = state.localPrefs;
  openModal(`
    <h2>Настройки</h2>
    <div class="form-stack">
      <div class="section-head"><h3>Внешний вид</h3></div>
      <div class="form-grid">
        <label>Theme mode<select class="select" id="themeMode">${['dark','light','system'].map(v => `<option value="${v}" ${lp.themeMode === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Accent color<input class="input" id="accentColor" type="color" value="${escapeHtml(lp.accent)}" /></label>
        <label>Top glow<input class="input" id="glowTopColor" type="color" value="${escapeHtml(lp.glowTopColor)}" /></label>
        <label>Top intensity<input class="input" id="glowTopStrength" type="range" min="0" max="0.5" step="0.01" value="${escapeHtml(lp.glowTopStrength)}" /></label>
        <label>Left glow<input class="input" id="glowLeftColor" type="color" value="${escapeHtml(lp.glowLeftColor)}" /></label>
        <label>Left intensity<input class="input" id="glowLeftStrength" type="range" min="0" max="0.5" step="0.01" value="${escapeHtml(lp.glowLeftStrength)}" /></label>
        <label>Bottom-right glow<input class="input" id="glowBottomColor" type="color" value="${escapeHtml(lp.glowBottomColor)}" /></label>
        <label>Bottom-right intensity<input class="input" id="glowBottomStrength" type="range" min="0" max="0.5" step="0.01" value="${escapeHtml(lp.glowBottomStrength)}" /></label>
      </div>
      <div class="hr"></div>
      <div class="section-head"><h3>Профиль</h3></div>
      <div class="form-grid">
        <label>Аватар<input class="input" id="avatarInput" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" /></label>
        <div class="help">Поддержка: jpg, jpeg, png. До 2 Mb.</div>
      </div>
      ${isAdmin() ? `
      <div class="hr"></div>
      <div class="section-head"><h3>Портал</h3></div>
      <div class="form-grid">
        <label>Badge text<input class="input" id="portalBadgeTextInput" value="${escapeHtml(state.settings.portalBadgeText || '')}" /></label>
        <label>Title<input class="input" id="portalTitleInput" value="${escapeHtml(state.settings.portalTitle || '')}" /></label>
        <label>Subtitle<textarea id="portalSubtitleInput">${escapeHtml(state.settings.portalSubtitle || '')}</textarea></label>
        <label>Footer text<input class="input" id="footerTextInput" value="${escapeHtml(state.settings.footerText || '')}" /></label>
        <label>Stats mode<select class="select" id="statsModeInput">${['expanded','compact','hidden'].map(v => `<option value="${v}" ${state.settings.statsMode === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Density<select class="select" id="densityModeInput">${['comfortable','compact','ultra-compact'].map(v => `<option value="${v}" ${state.settings.densityMode === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Action buttons<select class="select" id="actionButtonsStyleInput">${['icons-with-text','icons-only'].map(v => `<option value="${v}" ${state.settings.actionButtonsStyle === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Action visibility<select class="select" id="actionButtonsVisibilityInput">${['always-visible','hover'].map(v => `<option value="${v}" ${state.settings.actionButtonsVisibility === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="hr"></div>
      <div class="section-head"><h3>Виджеты</h3></div>
      <div class="form-grid">${(state.settings.widgets || []).map(w => `<label><span>${escapeHtml(w.type)}</span><input type="checkbox" class="widget-enabled" data-id="${escapeHtml(w.id)}" ${w.enabled ? 'checked' : ''} /></label>`).join('')}</div>
      <div class="hr"></div>
      <div class="section-head"><h3>Пользователи</h3><button class="btn" id="addUserBtn" type="button">+ Пользователь</button></div>
      <div>${state.users.map(user => `<div class="panel" style="padding:12px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><strong>${escapeHtml(user.username)}</strong><div class="muted">${escapeHtml(user.role)} · ${user.isActive ? 'active' : 'disabled'}</div></div><div style="display:flex;gap:8px"><button class="btn" type="button" data-user-action="toggle" data-id="${escapeHtml(user.id)}">${user.isActive ? 'Disable' : 'Enable'}</button><button class="btn" type="button" data-user-action="password" data-id="${escapeHtml(user.id)}">Пароль</button>${user.id !== state.me.id ? `<button class="btn danger" type="button" data-user-action="delete" data-id="${escapeHtml(user.id)}">Удалить</button>` : ''}</div></div></div>`).join('') || '<div class="empty">Пользователей нет</div>'}</div>
      ` : ''}
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="settingsCancelBtn">Отмена</button><button type="button" class="btn primary" id="settingsSaveBtn">Сохранить</button></div>
    </div>
  `);
  document.getElementById('settingsCancelBtn').onclick = closeModal;
  document.getElementById('settingsSaveBtn').onclick = async () => {
    state.localPrefs.themeMode = document.getElementById('themeMode').value;
    state.localPrefs.accent = document.getElementById('accentColor').value;
    state.localPrefs.glowTopColor = document.getElementById('glowTopColor').value;
    state.localPrefs.glowTopStrength = parseFloat(document.getElementById('glowTopStrength').value);
    state.localPrefs.glowLeftColor = document.getElementById('glowLeftColor').value;
    state.localPrefs.glowLeftStrength = parseFloat(document.getElementById('glowLeftStrength').value);
    state.localPrefs.glowBottomColor = document.getElementById('glowBottomColor').value;
    state.localPrefs.glowBottomStrength = parseFloat(document.getElementById('glowBottomStrength').value);
    saveLocalPrefs();
    if (isAdmin()) {
      const widgets = (state.settings.widgets || []).map(w => ({ ...w, enabled: document.querySelector(`.widget-enabled[data-id="${w.id}"]`)?.checked ?? w.enabled }));
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({
        portalBadgeText: document.getElementById('portalBadgeTextInput').value,
        portalTitle: document.getElementById('portalTitleInput').value,
        portalSubtitle: document.getElementById('portalSubtitleInput').value,
        footerText: document.getElementById('footerTextInput').value,
        statsMode: document.getElementById('statsModeInput').value,
        densityMode: document.getElementById('densityModeInput').value,
        actionButtonsStyle: document.getElementById('actionButtonsStyleInput').value,
        actionButtonsVisibility: document.getElementById('actionButtonsVisibilityInput').value,
        widgets,
      }) });
    }
    const avatarFile = document.getElementById('avatarInput').files[0];
    if (avatarFile) {
      const formData = new FormData();
      formData.append('avatar', avatarFile);
      await apiForm(`/api/users/${state.me.id}/avatar`, formData);
    }
    closeModal();
    await loadAll();
  };
  if (isAdmin()) {
    document.getElementById('addUserBtn').onclick = () => openAddUserModal();
    document.querySelectorAll('[data-user-action]').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.userAction;
      if (action === 'toggle') {
        const user = state.users.find(u => u.id === id);
        await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ username: user.username, role: user.role, isActive: !user.isActive }) });
        state.users = await api('/api/users');
        openSettingsModal();
      }
      if (action === 'password') {
        const password = prompt('Новый пароль:');
        if (!password) return;
        await api(`/api/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
        alert('Пароль обновлен');
      }
      if (action === 'delete') {
        if (!confirm('Удалить пользователя?')) return;
        await api(`/api/users/${id}`, { method: 'DELETE' });
        state.users = await api('/api/users');
        openSettingsModal();
      }
    });
  }
}
function openAddUserModal() {
  openModal(`
    <h2>Новый пользователь</h2>
    <form id="addUserForm" class="form-stack">
      <label>Username<input class="input" name="username" required /></label>
      <label>Password<input class="input" name="password" type="password" required /></label>
      <label>Role<select class="select" name="role"><option value="viewer">viewer</option><option value="admin">admin</option></select></label>
      <label><span>Active</span><input type="checkbox" name="isActive" checked /></label>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn" id="cancelAddUserBtn">Отмена</button><button class="btn primary">Создать</button></div>
    </form>
  `);
  document.getElementById('cancelAddUserBtn').onclick = openSettingsModal;
  document.getElementById('addUserForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password'), role: form.get('role'), isActive: !!form.get('isActive') }) });
    state.users = await api('/api/users');
    openSettingsModal();
  };
}
function typeIcon(type) {
  return ({ Database: '🗄', AI: '🧠', Automation: '⚙', Infra: '🧰', Network: '🌐', Service: '🔧' }[type] || '🔧');
}
async function openDiscoveryModal() {
  try { state.discovery = await api('/api/discovery/docker'); } catch (e) { alert(e.message); return; }
  openModal(`
    <h2>Docker autodiscovery</h2>
    <div class="help" style="margin-bottom:12px">Выбери контейнеры для импорта в выбранный сервер.</div>
    <div class="form-grid">
      <label>Поиск<input class="input" id="discoverySearch" placeholder="container / image / url / category" /></label>
      <label>Сервер<select class="select" id="discoveryServerId">${state.portalState.servers.sort(byOrder).map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')}</select></label>
    </div>
    <div id="discoveryList" style="margin-top:14px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px"><button type="button" class="btn" id="cancelDiscoveryBtn">Отмена</button><button type="button" class="btn primary" id="importDiscoveryBtn">Импортировать</button></div>
  `);
  const renderDiscovery = () => {
    const q = (document.getElementById('discoverySearch').value || '').toLowerCase().trim();
    const items = state.discovery.filter(item => [item.name, item.image, item.url, item.category].join(' ').toLowerCase().includes(q));
    document.getElementById('discoveryList').innerHTML = items.length ? items.map(item => `
      <label class="panel discovery-item">
        <input class="checkbox-big" type="checkbox" value="${escapeHtml(item.id)}" />
        <div>
          <div style="font-weight:800">${escapeHtml(item.name)}</div>
          <div class="muted">${escapeHtml(item.image || '')}</div>
          <div class="muted">${escapeHtml(item.url || 'URL не определен')}</div>
        </div>
        <div class="type-badge"><span>${typeIcon(item.category)}</span><span>${escapeHtml(item.category || 'Service')}</span></div>
      </label>
    `).join('') : '<div class="empty">Ничего не найдено для импорта</div>';
  };
  document.getElementById('cancelDiscoveryBtn').onclick = closeModal;
  document.getElementById('discoverySearch').oninput = renderDiscovery;
  document.getElementById('importDiscoveryBtn').onclick = async () => {
    const serverId = document.getElementById('discoveryServerId').value;
    const selectedIds = Array.from(document.querySelectorAll('#discoveryList input[type="checkbox"]:checked')).map(x => x.value);
    const items = state.discovery.filter(x => selectedIds.includes(x.id));
    if (!items.length) return alert('Ничего не выбрано');
    await api('/api/discovery/import', { method: 'POST', body: JSON.stringify({ serverId, items }) });
    closeModal();
    await refreshState();
  };
  renderDiscovery();
}
async function refreshState() {
  state.portalState = await api('/api/state');
  state.metrics = await api('/api/system/metrics').catch(() => state.metrics);
  state.onlineUsers = await api('/api/auth/online-users').catch(() => state.onlineUsers);
  if (isAdmin()) state.authLogs = await api('/api/auth/logs?limit=12').catch(() => state.authLogs);
  state.settings = await api('/api/settings').catch(() => state.settings);
  render();
}

function bindGlobalEvents() {
  document.getElementById('searchInput').addEventListener('input', (e) => { state.search = e.target.value; renderServers(); });
  document.getElementById('toggleStatsBtn').addEventListener('click', () => { state.statsCollapsed = !state.statsCollapsed; renderStats(); });
  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
  document.getElementById('discoveryBtn').addEventListener('click', openDiscoveryModal);
  document.getElementById('addServerBtn').addEventListener('click', () => openServerModal());
  document.getElementById('addServiceBtn').addEventListener('click', () => openServiceModal());
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const exported = await api('/api/export');
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'portal-state.json'; a.click(); URL.revokeObjectURL(url);
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
  document.getElementById('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const raw = await file.text();
    let parsed; try { parsed = JSON.parse(raw); } catch { return alert('Некорректный JSON'); }
    await api('/api/import', { method: 'POST', body: JSON.stringify(parsed) });
    await refreshState();
    e.target.value = '';
  });
  document.addEventListener('click', async (e) => {
    if (e.target.id === 'userMenuBtn' || e.target.closest('#userMenuBtn')) {
      openUserQuickMenu();
    }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.localPrefs.themeMode === 'system') applyTheme();
  });
}
function openUserQuickMenu() {
  openModal(`
    <h2>Пользователь</h2>
    <div class="form-stack">
      <div class="panel" style="padding:12px;display:flex;align-items:center;gap:12px">
        ${state.me.avatarUrl ? `<img class="user-avatar" src="${escapeHtml(state.me.avatarUrl)}" alt="avatar" style="width:48px;height:48px" />` : `<div class="user-avatar" style="width:48px;height:48px;display:flex;align-items:center;justify-content:center">${escapeHtml((state.me.username || '?').slice(0,1).toUpperCase())}</div>`}
        <div><strong>${escapeHtml(state.me.username)}</strong><div class="muted">${escapeHtml(state.me.role)}</div></div>
      </div>
      <button class="btn" id="profileSettingsBtn">Настройки</button>
      <button class="btn danger" id="logoutBtn">Выйти</button>
    </div>
  `);
  document.getElementById('profileSettingsBtn').onclick = openSettingsModal;
  document.getElementById('logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/login.html'; };
}

bindGlobalEvents();
loadAll().catch((e) => {
  console.error(e);
  alert(`Не удалось загрузить портал: ${e.message}`);
});
