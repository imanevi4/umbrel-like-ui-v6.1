const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const SSL_ENABLED = String(process.env.SSL_ENABLED || 'false') === 'true';
const TRUST_PROXY = String(process.env.TRUST_PROXY || 'false') === 'true';
const SESSION_SECRET = process.env.SESSION_SECRET || 'CHANGE_ME';
const ADMIN_BOOTSTRAP_USERNAME = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
const ADMIN_BOOTSTRAP_PASSWORD_HASH = process.env.ADMIN_BOOTSTRAP_PASSWORD_HASH || '';
if (TRUST_PROXY) app.set('trust proxy', 1);

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const AUTH_LOG_FILE = path.join(DATA_DIR, 'auth-log.jsonl');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const AVATAR_DIR = path.join(DATA_DIR, 'uploads', 'avatars');
for (const dir of [DATA_DIR, SESSIONS_DIR, AVATAR_DIR]) fs.mkdirSync(dir, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));
app.use(session({
  store: new FileStore({ path: SESSIONS_DIR, retries: 0 }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: SSL_ENABLED, maxAge: 1000 * 60 * 60 * 24 * 14 }
}));
const avatarUpload = multer({
  dest: AVATAR_DIR,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)) return cb(new Error('Only jpg/jpeg/png allowed'));
    cb(null, true);
  }
});

const defaultSettings = {
  portalBadgeText: 'IAM Umbrel-like Control Portal',
  portalTitle: 'Привет!',
  portalSubtitle: 'Группы из серверов, сервисы на серверах внутри групп, пользователи, темы, docker autodiscovery и быстрый поиск и переход по сервисам.',
  footerText: '', statsMode: 'compact', densityMode: 'comfortable', actionButtonsStyle: 'icons-with-text', actionButtonsVisibility: 'always-visible',
  widgets: [
    { id: 'widget-disk', type: 'disk', enabled: true, order: 1, size: 'sm' },
    { id: 'widget-ram', type: 'ram', enabled: true, order: 2, size: 'sm' },
    { id: 'widget-auth-log', type: 'auth-log', enabled: true, order: 3, size: 'md' },
    { id: 'widget-online-users', type: 'online-users', enabled: true, order: 4, size: 'md' }
  ]
};
const safeJsonParse = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };
const readJson = (file, fallback) => { try { return fs.existsSync(file) ? safeJsonParse(fs.readFileSync(file, 'utf8'), fallback) : fallback; } catch { return fallback; } };
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const generateId = (prefix='id') => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
function ensureBootstrapAdmin() {
  let users = readJson(USERS_FILE, []);
  if (!Array.isArray(users)) users = [];
  if (!users.find(u => u.username === ADMIN_BOOTSTRAP_USERNAME) && ADMIN_BOOTSTRAP_PASSWORD_HASH) {
    users.push({ id: generateId('usr'), username: ADMIN_BOOTSTRAP_USERNAME, passwordHash: ADMIN_BOOTSTRAP_PASSWORD_HASH, role: 'admin', isActive: true, avatarUrl: '', createdAt: new Date().toISOString() });
  }
  if (!fs.existsSync(USERS_FILE) || ADMIN_BOOTSTRAP_PASSWORD_HASH) writeJson(USERS_FILE, users);
}
function normalizeState(input) {
  if (Array.isArray(input)) {
    return { servers: [{ id: 'srv-default', name: 'Default Server', ip: '11.22.33.44', baseUrl: 'https://example.com', description: 'Migrated from flat services list', expanded: true, order: 1, tags: [], iconUrl: '' }], services: input.map((svc, idx) => ({ id: svc.id || generateId('svc'), serverId: 'srv-default', name: svc.name || 'Untitled', url: svc.url || '', description: svc.description || '', category: svc.category || '', iconUrl: svc.iconUrl || '', healthUrl: svc.healthUrl || '', checkMethod: svc.checkMethod || 'auto', pinned: !!svc.pinned, order: idx + 1, credentials: [], links: [], notes: '' })), meta: { version: 6, updatedAt: new Date().toISOString() } };
  }
  const state = input || {};
  state.servers = Array.isArray(state.servers) ? state.servers : [];
  state.services = Array.isArray(state.services) ? state.services : [];
  state.meta = state.meta || { version: 6, updatedAt: new Date().toISOString() };
  state.servers = state.servers.map((s, idx) => ({ id: s.id || generateId('srv'), name: s.name || `Server ${idx + 1}`, ip: s.ip || '', baseUrl: s.baseUrl || '', description: s.description || '', expanded: s.expanded !== false, order: typeof s.order === 'number' ? s.order : idx + 1, tags: Array.isArray(s.tags) ? s.tags : [], iconUrl: s.iconUrl || '' }));
  state.services = state.services.map((svc, idx) => ({ id: svc.id || generateId('svc'), serverId: svc.serverId || state.servers[0]?.id || 'srv-default', name: svc.name || 'Untitled', url: svc.url || '', description: svc.description || '', category: svc.category || '', iconUrl: svc.iconUrl || '', healthUrl: svc.healthUrl || '', checkMethod: ['auto','http','ping','disabled'].includes(svc.checkMethod) ? svc.checkMethod : 'auto', pinned: !!svc.pinned, order: typeof svc.order === 'number' ? svc.order : idx + 1, credentials: Array.isArray(svc.credentials) ? svc.credentials : [], links: Array.isArray(svc.links) ? svc.links : [], notes: svc.notes || '' }));
  return state;
}
const loadState = () => normalizeState(readJson(STATE_FILE, { servers: [], services: [], meta: { version: 6, updatedAt: new Date().toISOString() } }));
const saveState = (state) => { state.meta = { version: 6, updatedAt: new Date().toISOString() }; writeJson(STATE_FILE, normalizeState(state)); };
const loadUsers = () => readJson(USERS_FILE, []);
const saveUsers = (users) => writeJson(USERS_FILE, users);
const loadSettings = () => ({ ...defaultSettings, ...readJson(SETTINGS_FILE, defaultSettings) });
const saveSettings = (settings) => writeJson(SETTINGS_FILE, { ...defaultSettings, ...settings });
function getClientIp(req) { const fwd = req.headers['x-forwarded-for']; if (TRUST_PROXY && fwd) return String(fwd).split(',')[0].trim(); return req.socket?.remoteAddress || ''; }
const appendAuthLog = (entry) => fs.appendFileSync(AUTH_LOG_FILE, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
const readAuthLogs = (limit = 50) => !fs.existsSync(AUTH_LOG_FILE) ? [] : fs.readFileSync(AUTH_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse().map(l => safeJsonParse(l, null)).filter(Boolean);
function requireAuth(req, res, next) { if (!req.session.user) return res.redirect('/login.html'); req.session.lastSeen = Date.now(); next(); }
function requireApiAuth(req, res, next) { if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' }); req.session.lastSeen = Date.now(); next(); }
function requireAdmin(req, res, next) { if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' }); next(); }
const publicUser = (user) => ({ id: user.id, username: user.username, role: user.role, isActive: user.isActive, avatarUrl: user.avatarUrl || '', createdAt: user.createdAt });
function getOnlineUsers() {
  const users = loadUsers();
  const now = Date.now();
  const files = fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR) : [];
  const activeByUser = new Map();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = safeJsonParse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'), null);
      if (!raw || !raw.user) continue;
      const lastSeen = raw.lastSeen || now;
      if (now - lastSeen > 1000 * 60 * 15) continue;
      activeByUser.set(raw.user.id, { id: raw.user.id, username: raw.user.username, role: raw.user.role, ip: raw.lastIp || '', lastSeen });
    } catch {}
  }
  return Array.from(activeByUser.values()).map(u => ({ ...u, avatarUrl: users.find(x => x.id === u.id)?.avatarUrl || '' }));
}
function getMetrics() {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const disk = { totalGb: null, usedGb: null, freeGb: null, percentUsed: null };
  try {
    const stat = fs.statfsSync('/');
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    const used = total - free;
    disk.totalGb = +(total / 1024 / 1024 / 1024).toFixed(2);
    disk.freeGb = +(free / 1024 / 1024 / 1024).toFixed(2);
    disk.usedGb = +(used / 1024 / 1024 / 1024).toFixed(2);
    disk.percentUsed = total ? +((used / total) * 100).toFixed(1) : 0;
  } catch {}
  return { memory: { totalGb: +(memTotal / 1024 / 1024 / 1024).toFixed(2), usedGb: +((memTotal - memFree) / 1024 / 1024 / 1024).toFixed(2), freeGb: +(memFree / 1024 / 1024 / 1024).toFixed(2), percentUsed: +(((memTotal - memFree) / memTotal) * 100).toFixed(1) }, disk };
}
const reorderByIds = (items, orderedIds) => items.map(item => ({ ...item, order: new Map(orderedIds.map((id, idx) => [id, idx + 1])).get(item.id) || item.order || 9999 })).sort((a, b) => a.order - b.order);
function dockerGet(pathname) { return new Promise((resolve, reject) => { const req = http.request({ socketPath: '/var/run/docker.sock', path: pathname, method: 'GET' }, res => { let data=''; res.on('data', c => data += c); res.on('end', () => res.statusCode >= 400 ? reject(new Error(data || `Docker API error ${res.statusCode}`)) : resolve(safeJsonParse(data, []))); }); req.on('error', reject); req.end(); }); }
const guessCategory = (name, image) => { const s = `${name} ${image}`.toLowerCase(); if (/postgres|mariadb|mysql|mongo|redis|valkey|weaviate/.test(s)) return 'Database'; if (/nginx|traefik|portainer/.test(s)) return 'Infra'; if (/ollama|openwebui|llm/.test(s)) return 'AI'; if (/n8n|workflow/.test(s)) return 'Automation'; if (/vpn|wg|wireguard/.test(s)) return 'Network'; return 'Service'; };
const guessUrl = (container) => { const ports = Array.isArray(container.Ports) ? container.Ports : []; const published = ports.find(p => p.PublicPort); return published ? `http://HOST:${published.PublicPort}` : ''; };
ensureBootstrapAdmin();
app.get('/login.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  const ip = getClientIp(req);
  if (!user || !user.isActive || !bcrypt.compareSync(password || '', user.passwordHash || '')) { appendAuthLog({ username: username || '', ip, event: 'login_failed' }); return res.status(401).json({ error: 'Invalid credentials' }); }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  req.session.lastSeen = Date.now(); req.session.lastIp = ip; appendAuthLog({ username: user.username, ip, event: 'login_success' }); res.json({ ok: true });
});
app.post('/api/logout', requireApiAuth, (req, res) => { appendAuthLog({ username: req.session.user.username, ip: getClientIp(req), event: 'logout' }); req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', requireApiAuth, (req, res) => { const user = loadUsers().find(u => u.id === req.session.user.id); res.json({ user: publicUser(user || req.session.user), settings: loadSettings() }); });
app.get('/api/users', requireApiAuth, requireAdmin, (_req, res) => res.json(loadUsers().map(publicUser)));
app.post('/api/users', requireApiAuth, requireAdmin, (req, res) => { const { username, password, role = 'viewer', isActive = true } = req.body || {}; if (!username || !password) return res.status(400).json({ error: 'username and password required' }); const users = loadUsers(); if (users.find(u => u.username === username)) return res.status(400).json({ error: 'username exists' }); const user = { id: generateId('usr'), username, passwordHash: bcrypt.hashSync(password, 12), role: role === 'admin' ? 'admin' : 'viewer', isActive: !!isActive, avatarUrl: '', createdAt: new Date().toISOString() }; users.push(user); saveUsers(users); res.json(publicUser(user)); });
app.put('/api/users/:id', requireApiAuth, requireAdmin, (req, res) => { const users = loadUsers(); const idx = users.findIndex(u => u.id === req.params.id); if (idx < 0) return res.status(404).json({ error: 'not found' }); users[idx] = { ...users[idx], username: req.body.username || users[idx].username, role: req.body.role === 'admin' ? 'admin' : 'viewer', isActive: req.body.isActive !== false }; saveUsers(users); res.json(publicUser(users[idx])); });
app.put('/api/users/:id/password', requireApiAuth, requireAdmin, (req, res) => { const { password } = req.body || {}; if (!password) return res.status(400).json({ error: 'password required' }); const users = loadUsers(); const idx = users.findIndex(u => u.id === req.params.id); if (idx < 0) return res.status(404).json({ error: 'not found' }); users[idx].passwordHash = bcrypt.hashSync(password, 12); saveUsers(users); res.json({ ok: true }); });
app.delete('/api/users/:id', requireApiAuth, requireAdmin, (req, res) => { if (req.session.user.id === req.params.id) return res.status(400).json({ error: 'cannot delete self' }); saveUsers(loadUsers().filter(u => u.id !== req.params.id)); res.json({ ok: true }); });
app.post('/api/users/:id/avatar', requireApiAuth, avatarUpload.single('avatar'), (req, res) => { if (req.session.user.role !== 'admin' && req.session.user.id !== req.params.id) return res.status(403).json({ error: 'forbidden' }); const users = loadUsers(); const idx = users.findIndex(u => u.id === req.params.id); if (idx < 0) return res.status(404).json({ error: 'not found' }); const ext = req.file.mimetype === 'image/png' ? '.png' : '.jpg'; const fileName = `${req.params.id}${ext}`; fs.renameSync(req.file.path, path.join(AVATAR_DIR, fileName)); users[idx].avatarUrl = `/uploads/avatars/${fileName}`; saveUsers(users); res.json({ avatarUrl: users[idx].avatarUrl }); });
app.get('/api/settings', requireApiAuth, (_req, res) => res.json(loadSettings()));
app.put('/api/settings', requireApiAuth, requireAdmin, (req, res) => { const next = { ...loadSettings(), ...req.body }; saveSettings(next); res.json(next); });
app.get('/api/state', requireApiAuth, (_req, res) => res.json(loadState()));
app.put('/api/state', requireApiAuth, requireAdmin, (req, res) => { const normalized = normalizeState(req.body); saveState(normalized); res.json(normalized); });
app.get('/api/export', requireApiAuth, (_req, res) => res.json(loadState()));
app.post('/api/import', requireApiAuth, requireAdmin, (req, res) => { const imported = normalizeState(req.body); saveState(imported); res.json(imported); });
app.post('/api/servers', requireApiAuth, requireAdmin, (req, res) => { const state = loadState(); const server = { id: generateId('srv'), name: req.body.name || 'Untitled Server', ip: req.body.ip || '', baseUrl: req.body.baseUrl || '', description: req.body.description || '', expanded: req.body.expanded !== false, order: state.servers.length + 1, tags: Array.isArray(req.body.tags) ? req.body.tags : [], iconUrl: req.body.iconUrl || '' }; state.servers.push(server); saveState(state); res.json(server); });
app.put('/api/servers/:id', requireApiAuth, requireAdmin, (req, res) => { const state = loadState(); const idx = state.servers.findIndex(s => s.id === req.params.id); if (idx < 0) return res.status(404).json({ error: 'not found' }); state.servers[idx] = { ...state.servers[idx], ...req.body, id: state.servers[idx].id }; saveState(state); res.json(state.servers[idx]); });
app.delete('/api/servers/:id', requireApiAuth, requireAdmin, (req, res) => { const cascade = String(req.query.cascade || 'false') === 'true'; const state = loadState(); const hasServices = state.services.some(s => s.serverId === req.params.id); if (hasServices && !cascade) return res.status(400).json({ error: 'server has services; use cascade=true' }); state.servers = state.servers.filter(s => s.id !== req.params.id); if (cascade) state.services = state.services.filter(s => s.serverId !== req.params.id); saveState(state); res.json({ ok: true }); });
app.post('/api/reorder/servers', requireApiAuth, requireAdmin, (req, res) => { const state = loadState(); state.servers = reorderByIds(state.servers, req.body.ids || []); saveState(state); res.json(state.servers); });
app.post('/api/services', requireApiAuth, requireAdmin, (req, res) => { const state = loadState(); if (!state.servers.find(s => s.id === req.body.serverId)) return res.status(400).json({ error: 'invalid serverId' }); const count = state.services.filter(s => s.serverId === req.body.serverId).length; const service = { id: generateId('svc'), serverId: req.body.serverId, name: req.body.name || 'Untitled Service', url: req.body.url || '', description: req.body.description || '', category: req.body.category || '', iconUrl: req.body.iconUrl || '', healthUrl: req.body.healthUrl || '', checkMethod: ['auto','http','ping','disabled'].includes(req.body.checkMethod) ? req.body.checkMethod : 'auto', pinned: !!req.body.pinned, order: count + 1, credentials: Array.isArray(req.body.credentials) ? req.body.credentials : [], links: Array.isArray(req.body.links) ? req.body.links : [], notes: req.body.notes || '' }; state.services.push(service); saveState(state); res.json(service); });
app.put('/api/services/:id', requireApiAuth, requireAdmin, (req, res) => { const state = loadState(); const idx = state.services.findIndex(s => s.id === req.params.id); if (idx < 0) return res.status(404).json({ error: 'not found' }); state.services[idx] = { ...state.services[idx], ...req.body, id: state.services[idx].id, credentials: Array.isArray(req.body.credentials) ? req.body.credentials : state.services[idx].credentials, links: Array.isArray(req.body.links) ? req.body.links : state.services[idx].links }; saveState(state); res.json(state.services[idx]); });
app.delete('/api/services/:id', requireApiAuth, requireAdmin, (req, res) => { const state = loadState(); state.services = state.services.filter(s => s.id !== req.params.id); saveState(state); res.json({ ok: true }); });
app.post('/api/reorder/services', requireApiAuth, requireAdmin, (req, res) => { const { serverId, ids } = req.body || {}; const state = loadState(); const group = state.services.filter(s => s.serverId === serverId); const other = state.services.filter(s => s.serverId !== serverId); state.services = [...other, ...reorderByIds(group, ids || [])]; saveState(state); res.json(state.services.filter(s => s.serverId === serverId)); });
app.get('/api/system/metrics', requireApiAuth, (_req, res) => res.json(getMetrics()));
app.get('/api/auth/logs', requireApiAuth, requireAdmin, (req, res) => res.json(readAuthLogs(parseInt(req.query.limit || '50', 10))));
app.get('/api/auth/online-users', requireApiAuth, (req, res) => res.json(getOnlineUsers()));
app.get('/api/discovery/docker', requireApiAuth, requireAdmin, async (_req, res) => { try { const containers = await dockerGet('/containers/json?all=1'); res.json(containers.map(c => ({ id: c.Id, name: (c.Names?.[0] || '').replace(/^\//,'') || c.Image, image: c.Image, url: guessUrl(c), category: guessCategory(c.Names?.[0] || '', c.Image || ''), status: c.State || '', ports: c.Ports || [] }))); } catch (e) { res.status(500).json({ error: `Docker autodiscovery unavailable: ${e.message}` }); } });
app.post('/api/discovery/import', requireApiAuth, requireAdmin, (req, res) => { const { serverId, items } = req.body || {}; const state = loadState(); if (!state.servers.find(s => s.id === serverId)) return res.status(400).json({ error: 'invalid serverId' }); let order = state.services.filter(s => s.serverId === serverId).length; for (const item of (items || [])) { order += 1; state.services.push({ id: generateId('svc'), serverId, name: item.name || item.image || 'Container', url: item.url || '', description: item.image ? `Docker image: ${item.image}` : '', category: item.category || 'Service', iconUrl: '', healthUrl: item.url || '', checkMethod: item.url ? 'auto' : 'disabled', pinned: false, order, credentials: [], links: [], notes: item.name ? `Docker: ${item.name}` : 'Docker autodiscovery import' }); } saveState(state); res.json(state); });
app.get('/health', (_req, res) => res.json({ ok: true, ssl: SSL_ENABLED, time: new Date().toISOString() }));
app.get('/', requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));
const serverFactory = () => { if (SSL_ENABLED) { const cert = path.join(__dirname, 'certs', 'fullchain.pem'); const key = path.join(__dirname, 'certs', 'privkey.pem'); if (!fs.existsSync(cert) || !fs.existsSync(key)) throw new Error('SSL_ENABLED=true but cert files are missing'); return https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, app); } return http.createServer(app); };
serverFactory().listen(PORT, '0.0.0.0', () => console.log(`Self-hosted portal listening on ${SSL_ENABLED ? 'https' : 'http'}://0.0.0.0:${PORT}`));
