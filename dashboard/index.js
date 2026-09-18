const express = require('express');
const path = require('path');
const fs = require('fs');
const QuestManager = require('../quests/manager'); // Import QuestManager
const app = express();

// Single active session — persisted to disk so restarts don't force re-login.
// Same IP OR same device (User-Agent) = allowed. Different IP + different UA = kicks old session.
const _SESSION_COOKIE = 'auth_token';
const _SESSION_VALUE = 'valid_session_proplus';
const _SESSION_FILE = require('path').join(__dirname, '..', 'data', 'session.json');

function _loadSession() {
    try {
        if (require('fs').existsSync(_SESSION_FILE)) return JSON.parse(require('fs').readFileSync(_SESSION_FILE, 'utf8'));
    } catch (_) {}
    return null;
}
function _saveSession(s) {
    try {
        const dir = require('path').dirname(_SESSION_FILE);
        if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
        require('fs').writeFileSync(_SESSION_FILE, JSON.stringify(s));
    } catch (_) {}
}
function _clearSession() {
    try { require('fs').unlinkSync(_SESSION_FILE); } catch (_) {}
}

let _activeSession = _loadSession(); // { ip, ua } — survives restarts

function _getIp(req) {
    return (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}
function _getUa(req) {
    return (req.headers['user-agent'] || '').slice(0, 200);
}
function _sessionMatch(req) {
    if (!_activeSession) return false;
    const ip = _getIp(req), ua = _getUa(req);
    // Allow if same IP OR same device (UA)
    return _activeSession.ip === ip || _activeSession.ua === ua;
}

// For custom file uploads (catbox.moe hosting) — fall back to Node globals
// (Node 18+ has FormData, Blob and fetch built in via undici)
let _undici = null;
try { _undici = require('undici'); } catch (_) { /* not installed, use globals */ }
const FormData = (_undici && _undici.FormData) || global.FormData;
const Blob = (_undici && _undici.Blob) || global.Blob;
const fetch = (_undici && _undici.fetch) || global.fetch;

const LOADING_PAGE = (label) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PRO+ Loading</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;height:100vh;background:#0b0b10;color:#fff;font-family:'Outfit',sans-serif}.card{display:flex;flex-direction:column;align-items:center;gap:20px;padding:40px 48px;background:rgba(255,255,255,0.03);border:1px solid rgba(138,43,226,0.2);border-radius:20px;backdrop-filter:blur(10px)}.spinner{width:64px;height:64px;border:5px solid rgba(138,43,226,0.15);border-top-color:#c084fc;border-radius:50%;animation:spin 0.9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.label{font-size:1.05rem;font-weight:700;letter-spacing:.3px}.bar-outer{width:240px;height:6px;background:rgba(255,255,255,0.07);border-radius:6px;overflow:hidden}.bar-inner{height:100%;width:0%;background:linear-gradient(90deg,#7c3aed,#c084fc);border-radius:6px;transition:width 0.6s ease}.pct-label{font-size:0.8rem;color:#666;align-self:flex-end;margin-top:-12px}.sub{color:#555;font-size:.82rem;text-align:center;line-height:1.5}.links{display:flex;flex-direction:column;gap:8px;width:100%;margin-top:4px}.link-row{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px 14px;font-size:.8rem}.link-row a{color:#8a2be2;text-decoration:none;font-weight:600}.link-row a:hover{text-decoration:underline}.link-label{color:#444}</style></head><body><div class="card"><div class="spinner"></div><div class="label" id="lbl">Loading ${label}...</div><div class="bar-outer"><div class="bar-inner" id="bar"></div></div><div class="pct-label" id="pct">0%</div><div class="sub" id="sub">Bot is connecting to Discord.</div><div class="links"><div class="link-row"><span class="link-label">Bugs after update?</span><a href="/commands/updater">Revert Now</a></div><div class="link-row"><span class="link-label">Tokens not loading?</span><a href="/accounts">Multi Account Manager</a></div></div></div><script>const bar=document.getElementById('bar');const pct=document.getElementById('pct');const sub=document.getElementById('sub');let displayed=0;const started=Date.now();function setBar(v){displayed=v;bar.style.width=v+'%';pct.textContent=Math.round(v)+'%';}(async function poll(){try{const r=await fetch('/api/bot-ready');const d=await r.json();if(d.total===0){return location.href='/accounts';}if(d.total>0){const real=Math.round((d.loaded/d.total)*100);if(real>displayed)setBar(real);sub.textContent='Loaded '+d.loaded+' / '+d.total+' token'+(d.total>1?'s':'')+'...';}if(d.ready){setBar(100);setTimeout(()=>location.href='/',300);return;}if(d.total>0&&d.loaded>=d.total&&Date.now()-started>8000){return location.href='/accounts';}if(Date.now()-started>60000){return location.href='/accounts';}setTimeout(poll,1500);}catch(e){setTimeout(poll,2000);}})();</script></body></html>`;

function errCode(e) {
    const msg = (e && (e.message || String(e))) || '';
    const code = (e && e.code) || '';
    if (code === 'TOKEN_INVALID' || msg.includes('TOKEN_INVALID')) return 'Err:0 Invalid token provided';
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) return 'Err:1 Cannot connect — network/host unreachable';
    if (msg.includes('Lavalink') || msg.includes('lavalink')) return 'Err:2 Lavalink error: ' + msg;
    if (msg.includes('quest') || msg.includes('Quest') || msg.includes('bounty')) return 'Err:3 Quest/Bounty error: ' + msg;
    if (msg.includes('DISALLOWED_INTENTS')) return 'Err:4 Disallowed intents';
    if (msg.includes('rate limit') || msg.includes('429')) return 'Err:5 Rate limited by Discord';
    return 'Err:99 ' + msg;
}

module.exports = (clientRef, clientsMap) => {
    // Support both direct client and clientRef object for hot-switching
    const getClient = () => (clientRef && clientRef.current) ? clientRef.current : clientRef;
    // Proxy: anywhere 'client' is used below, it reads the latest client via getClient()
    const client = new Proxy({}, { get: (_, prop) => getClient()[prop], set: (_, prop, val) => { getClient()[prop] = val; return true; } });
    const port = process.env.PORT || 3000;

    // Quest managers isolated per account token
    const questManagers = new Map();
    function getQuestManager() {
        const token = getClient().token || process.env.TOKEN;
        if (!questManagers.has(token)) questManagers.set(token, new QuestManager(token));
        return questManagers.get(token);
    }

    // Set view engine
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // Static files
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json()); // Add JSON body parser for AJAX
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());

    // --- LOGIN SYSTEM START ---
    const failedLoginAttempts = new Map();

    // Bot-ready probe — public, no auth needed
    app.get('/api/bot-ready', (req, res) => {
        const accountManager = require('../accountManager');
        const { accounts } = accountManager.getAccounts();
        const total = accounts.length;
        if (total === 0) return res.json({ ready: false, loaded: 0, total: 0 });
        const loaded = clientsMap ? clientsMap.size : (getClient().user ? 1 : 0);
        // Auto-switch to any ready client if active one is invalid
        if (!getClient().user && clientsMap) {
            for (const [idx, c] of clientsMap) {
                if (c.user) { accountManager.switchAccount(idx); clientRef.current = c; break; }
            }
        }
        const ready = !!getClient().user;
        res.json({ ready, loaded, total });
    });

    // Login Page
    app.get('/login', (req, res) => {
        // Already have a valid session for this device — skip login regardless of bot state
        if (_activeSession && req.cookies[_SESSION_COOKIE] === _SESSION_VALUE && _sessionMatch(req)) {
            if (!getClient().user) return res.send(LOADING_PAGE('Bot'));
            return res.redirect('/');
        }
        const accountManager = require('../accountManager');
        const { accounts } = accountManager.getAccounts();
        if (accounts.length === 0) return res.redirect('/accounts');
        // Bot still loading — show loading screen before showing login form
        if (!getClient().user) return res.send(LOADING_PAGE('Bot'));
        res.render('login', { query: req.query });
    });

    // Login API
    app.post('/api/login', async (req, res) => {
        const { username, password } = req.body;
        const ip = _getIp(req);

        // Rate limit
        const record = failedLoginAttempts.get(ip);
        if (record && record.blockedUntil > Date.now()) {
            const remaining = Math.ceil((record.blockedUntil - Date.now()) / 1000 / 60);
            return res.json({ success: false, error: `Too many attempts. Blocked for ${remaining} mins.` });
        }

        const envUser = process.env.APP_USER;
        const envPass = process.env.APP_PASS;
        if (!envUser || !envPass) return res.json({ success: false, error: 'Login setup missing in .env (APP_USER/APP_PASS).' });

        if (username !== envUser || password !== envPass) {
            const r = record || { count: 0, blockedUntil: 0 };
            r.count++;
            if (r.count >= 3) { r.blockedUntil = Date.now() + 5 * 60 * 1000; r.count = 0; }
            failedLoginAttempts.set(ip, r);
            return res.json({ success: false, error: 'Invalid Credentials.' });
        }

        // Success — save session with IP + UA, persisted to disk
        failedLoginAttempts.delete(ip);
        const ua = _getUa(req);
        // If an existing session has the same device (UA), update IP instead of creating a new session
        if (_activeSession && _activeSession.ua === ua) {
            _activeSession.ip = ip;
        } else {
            _activeSession = { ip, ua };
        }
        _saveSession(_activeSession);
        res.cookie(_SESSION_COOKIE, _SESSION_VALUE, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });
        res.json({ success: true });
    });

    // Auth Middleware
    app.use((req, res, next) => {
        if (req.path === '/login' || req.path === '/api/login' || req.path === '/api/bot-ready'
            || req.path === '/accounts' || req.path === '/api/accounts/add'
            || req.path === '/commands/updater' || req.path.startsWith('/api/updater')
            || req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images') || req.path.startsWith('/favicon') || req.path.startsWith('/rpcassets')) {
            return next();
        }
        if (req.cookies[_SESSION_COOKIE] === _SESSION_VALUE && _activeSession) {
            if (_sessionMatch(req)) {
                // Update IP in session if device matches but IP changed
                const ip = _getIp(req), ua = _getUa(req);
                if (_activeSession.ua === ua && _activeSession.ip !== ip) {
                    _activeSession.ip = ip;
                    _saveSession(_activeSession);
                }
                return next();
            }
            // Different IP AND different device — kick
            res.clearCookie(_SESSION_COOKIE);
            return res.redirect('/login?reason=other_device');
        }
        res.clearCookie(_SESSION_COOKIE);
        res.redirect('/login');
    });
    // --- LOGIN SYSTEM END ---

    // --- NO TOKEN GUARD ---
    // Only runs after auth — so user must be logged in first.
    // If no accounts exist, redirect to /accounts to add one.
    const accountManager = require('../accountManager');
    app.use((req, res, next) => {
        const allowed = [
            '/accounts', '/api/accounts/add', '/api/accounts/list',
            '/api/accounts/delete', '/logout',
            '/commands/updater', '/login', '/api/login'
        ];
        const isAllowed = allowed.includes(req.path) ||
            req.path.startsWith('/css') || req.path.startsWith('/js') ||
            req.path.startsWith('/images') || req.path.startsWith('/favicon') ||
            req.path.startsWith('/api/updater');
        if (isAllowed) return next();
        const { accounts } = accountManager.getAccounts();
        if (accounts.length === 0) return res.redirect('/accounts');
        next();
    });
    // --- NO TOKEN GUARD END ---

    app.get('/logout', (req, res) => {
        _activeSession = null;
        _clearSession();
        res.clearCookie(_SESSION_COOKIE);
        res.redirect('/login');
    });

    app.get('/', (req, res) => {
        if (!client.user) return res.send(LOADING_PAGE('Dashboard'));

        // Calculate initial uptime in seconds
        const uptimeSeconds = Math.floor(client.uptime / 1000);

        // Load persisted status data
        const statusManager = require('../commands/statusManager');
        const statusData = statusManager.loadData(getClient().accountIndex);

        // Use persisted data, falling back to defaults if necessary
        const status = statusData.status || 'online';
        const currentActivity = statusData.custom_status || '';
        const currentEmoji = statusData.emoji || '';

        res.render('index', {
            user: client.user,
            uptimeSeconds,
            status: status,
            currentActivity,
            currentEmoji,
            page: 'home'
        });
    });

    app.post('/update-status', async (req, res) => {
        try {
            const { status, custom_status, emoji } = req.body;

            const statusManager = require('../commands/statusManager');
            statusManager.saveData({
                status: status,
                custom_status: custom_status,
                emoji: emoji
            }, getClient().accountIndex);

            // Trigger update via RPC Manager (which merges RPC + Status)
            const rpcManager = require('../commands/rpcManager');
            await rpcManager.setPresence(client, rpcManager.loadData(getClient().accountIndex));

            if (req.xhr || req.headers.accept && req.headers.accept.indexOf('json') > -1) {
                return res.json({ success: true, message: 'Status updated!' });
            }

            res.redirect('/');
        } catch (error) {
            console.error(error);
            res.redirect('/?error=' + encodeURIComponent(error.message));
        }
    });

    // --- API & Routes ---

    // Live Logs Endpoint
    app.get('/api/logs', (req, res) => {
        const logPath = path.join(__dirname, '..', 'data', 'afklog.json');
        if (fs.existsSync(logPath)) {
            const logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
            res.json(logs);
        } else {
            res.json([]);
        }
    });

    // --- QUEST ROUTES ---

    app.get('/quest', (req, res) => {
        if (!client.user) return res.send(LOADING_PAGE('Quest'));
        res.render('quest', {
            user: client.user,
            page: 'quest'
        });
    });

    app.get('/api/friends', async (req, res) => {
        try {
            const token = getClient().token;
            if (!token) return res.json([]);
            const r = await fetch('https://discord.com/api/v9/users/@me/relationships', {
                headers: { Authorization: token }
            });
            if (!r.ok) return res.json([]);
            const list = await r.json();
            const friends = list
                .filter(rel => rel.type === 1)
                .map(rel => ({
                    id: rel.user.id,
                    username: rel.user.global_name || rel.user.username,
                    avatar: rel.user.avatar
                        ? `https://cdn.discordapp.com/avatars/${rel.user.id}/${rel.user.avatar}.png?size=64`
                        : `https://cdn.discordapp.com/embed/avatars/${parseInt(rel.user.discriminator || 0) % 5}.png`
                }));
            res.json(friends);
        } catch (e) { res.json([]); }
    });

    app.get('/spammer', (req, res) => {
        if (!client.user) return res.send(LOADING_PAGE('Spammer'));
        res.render('spammer', {
            user: client.user,
            page: 'spammer'
        });
    });

    app.post('/quest/start-all', (req, res) => {
        getQuestManager().startAll();
        res.json({ success: true, message: 'Starting process...' });
    });

    app.post('/quest/stop-all', (req, res) => {
        getQuestManager().stopAll();
        res.json({ success: true, message: 'All quests stopped.' });
    });

    app.post('/quest/clear-logs', (req, res) => {
        const qm = getQuestManager();
        if (qm.clearLogs) qm.clearLogs();
        res.json({ success: true });
    });

    app.post('/quest/start-bounties', (req, res) => {
        const qm = getQuestManager();
        qm.log('system', 'Starting BOUNTIES protocol — completing quests AND bounties...');
        qm.startAll();
        res.json({ success: true, message: 'Starting bounties + quests completion...' });
    });

    app.get('/api/quests', (req, res) => {
        const qm = getQuestManager();
        res.json({ logs: qm.globalLogs, isRunning: qm.isRunning });
    });

    // --- AFK Routes ---

    app.get('/afk', (req, res) => {
        if (!client.user) return res.send(LOADING_PAGE('AFK'));

        const afkPath = path.join(__dirname, '..', 'data', 'afk.json');
        const logPath = path.join(__dirname, '..', 'data', 'afklog.json');

        let afkData = { isOn: false, reason: '' };
        let logs = [];

        if (fs.existsSync(afkPath)) afkData = JSON.parse(fs.readFileSync(afkPath, 'utf8'));
        if (fs.existsSync(logPath)) logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));

        res.render('afk', {
            user: client.user,
            afkData,
            logs,
            page: 'afk'
        });
    });

    app.post('/afk/save', (req, res) => {
        let { isOn, reason, logsEnabled } = req.body;
        const afkPath = path.join(__dirname, '..', 'data', 'afk.json');

        const checkBoolean = (val) => {
            if (Array.isArray(val)) return val.includes('on');
            return val === 'on';
        };

        const isAfkOn = checkBoolean(isOn);
        const isLogsOn = checkBoolean(logsEnabled);

        let existingData = {};
        if (fs.existsSync(afkPath)) existingData = JSON.parse(fs.readFileSync(afkPath, 'utf8'));

        const newData = {
            ...existingData,
            isOn: isAfkOn,
            reason: reason || existingData.reason || 'I am currently AFK.',
            logsEnabled: isLogsOn,
            startTime: isAfkOn ? Date.now() : (existingData.startTime || 0)
        };

        fs.writeFileSync(afkPath, JSON.stringify(newData, null, 2));

        if (req.xhr || req.headers.accept && req.headers.accept.indexOf('json') > -1) {
            return res.json({ success: true, message: 'Settings saved!' });
        }

        res.redirect('/afk');
    });

    app.post('/afk/clear-logs', (req, res) => {
        const { logId, clearAll } = req.body;
        const logPath = path.join(__dirname, '..', 'data', 'afklog.json');

        if (clearAll) {
            fs.writeFileSync(logPath, JSON.stringify([], null, 2));
        } else if (logId) {
            let logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
            logs = logs.filter(l => l.id !== logId);
            fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
        }

        res.redirect('/afk');
    });

    // --- COMMANDS Routes ---
    app.get('/commands', (req, res) => {
        if (!client.user) return res.send(LOADING_PAGE('Commands'));
        res.render('commands', {
            user: client.user,
            page: 'commands'
        });
    });

    app.get('/commands/updater', (req, res) => {
        res.render('cmd_updater', { user: client.user || null, page: 'commands' });
    });

    // Updater API — all public (accessible before login)
    const updater = require('../updater');
    let updaterLogs = [];

    app.get('/api/updater/check', async (req, res) => {
        try { res.json(await updater.checkForUpdates()); }
        catch(e) { res.json({ error: e.message, updates: [], hasUpdate: false }); }
    });

    app.get('/api/updater/logs', (req, res) => res.json({ logs: updaterLogs }));

    // Dot status — lightweight, no GitHub API call, reads local state only
    app.get('/api/updater/dot-status', (req, res) => {
        try {
            const state = updater.loadState();
            const dotStatus = updater.getDotStatus();
            res.json({
                dotStatus,
                installedVersion: state.installedVersion || updater.CURRENT_VERSION,
                installedChannel: state.installedChannel || updater.CURRENT_CHANNEL,
                lastSha: state.lastSha,
                lastCheckTime: state.lastCheckTime,
                lastUpdateFailed: !!state.lastUpdateFailed,
            });
        } catch(e) { res.json({ dotStatus: 'yellow', error: e.message }); }
    });

    app.post('/api/updater/apply', async (req, res) => {
        const { sha } = req.body;
        if (!sha) return res.json({ success: false, error: 'No SHA provided' });
        updaterLogs = [];
        try {
            const result = await updater.applyUpdate(sha, updaterLogs);
            res.json({ success: true, ...result });
        } catch(e) { updaterLogs.push('Fatal: ' + e.message); res.json({ success: false, error: e.message }); }
    });

    app.post('/api/updater/revert', async (req, res) => {
        updaterLogs = [];
        try {
            const result = await updater.revertUpdate(updaterLogs);
            res.json({ success: true, ...result });
        } catch(e) { updaterLogs.push('Fatal: ' + e.message); res.json({ success: false, error: e.message }); }
    });

    app.post('/api/updater/dismiss', (req, res) => {
        const { sha } = req.body;
        if (!sha) return res.json({ success: false });
        updater.dismissUpdate(sha);
        res.json({ success: true });
    });

    app.post('/api/updater/undismiss', (req, res) => {
        const { sha } = req.body;
        if (!sha) return res.json({ success: false });
        updater.undismissUpdate(sha);
        res.json({ success: true });
    });

    app.post('/api/updater/delete', (req, res) => {
        const { sha } = req.body;
        if (!sha) return res.json({ success: false });
        updater.deleteUpdate(sha);
        res.json({ success: true });
    });

    app.get('/commands/rpc', (req, res) => {
        res.render('cmd_rpc', { user: client.user, page: 'commands' });
    });

    // Status rotator is now embedded in the dashboard home page

    app.get('/commands/extra-features', (req, res) => {
        if (!client.user) return res.send(LOADING_PAGE('Extra Features'));
        res.render('cmd_extra_features', { user: client.user, page: 'commands' });
    });

    // Status Rotator APIs
    app.post('/api/status-rotator/set', async (req, res) => {
        const { text } = req.body;
        try {
            const statusManager = require('../commands/statusManager');
            statusManager.saveData({ custom_status: text || '' }, client.accountIndex);
            const rpcManager = require('../commands/rpcManager');
            await rpcManager.setPresence(client, rpcManager.loadData(client.accountIndex));
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });
    app.post('/api/status-rotator/emoji', async (req, res) => {
        const { emoji } = req.body;
        try {
            const statusManager = require('../commands/statusManager');
            statusManager.saveData({ emoji: emoji || '' }, client.accountIndex);
            const rpcManager = require('../commands/rpcManager');
            await rpcManager.setPresence(client, rpcManager.loadData(client.accountIndex));
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });
    app.post('/api/status-rotator/stream', async (req, res) => {
        const { name } = req.body;
        try {
            await client.user.setPresence({ activities: [{ type: 'STREAMING', name, url: 'https://twitch.tv/discord' }] });
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });
    app.post('/api/status-rotator/stream-stop', async (req, res) => {
        try { await client.user.setPresence({ activities: [] }); res.json({ success: true }); } catch (e) { res.json({ success: false }); }
    });
    app.post('/api/status-rotator/online-status', async (req, res) => {
        const { status } = req.body;
        try { await client.user.setStatus(status); res.json({ success: true }); } catch (e) { res.json({ success: false, error: e.message }); }
    });


    app.get('/api/status-rotator', (req, res) => {
        const statusManager = require('../commands/statusManager');
        const data = statusManager.loadRotator(getClient().accountIndex);
        res.json({ ...data, running: statusManager.isRotatorRunning(getClient().accountIndex) });
    });

    app.post('/api/status-rotator', (req, res) => {
        const statusManager = require('../commands/statusManager');
        const data = req.body;
        statusManager.saveRotator(data, getClient().accountIndex);
        if (data.enabled) {
            statusManager.startRotator(client, getClient().accountIndex);
        } else {
            statusManager.stopRotator(getClient().accountIndex);
        }
        res.json({ success: true, running: statusManager.isRotatorRunning(getClient().accountIndex) });
    });

    app.post('/api/status-rotator/stop', (req, res) => {
        const statusManager = require('../commands/statusManager');
        statusManager.stopRotator(getClient().accountIndex);
        const data = statusManager.loadRotator(getClient().accountIndex);
        data.enabled = false;
        statusManager.saveRotator(data, getClient().accountIndex);
        res.json({ success: true });
    });

    // RPC API
    // RPC Catalog (games + apps lists for picker UI)
    app.get('/api/rpc/catalog', (req, res) => {
        delete require.cache[require.resolve('../commands/rpcGames')];
        res.json({ games: require('../commands/rpcGames') });
    });

    app.get('/api/rpc', (req, res) => {
        const rpcManager = require('../commands/rpcManager');
        res.json(rpcManager.loadData(getClient().accountIndex));
    });

    app.post('/api/rpc', async (req, res) => {
        const rpcManager = require('../commands/rpcManager');
        const data = req.body;
        rpcManager.saveData(data, getClient().accountIndex);
        await rpcManager.setPresence(client, data);
        res.json({ success: true });
    });

    // RPC Presets
    app.get('/api/rpc/presets', (req, res) => {
        res.json(require('../commands/rpcPresets').list());
    });
    app.post('/api/rpc/presets/save', (req, res) => {
        const { name, config } = req.body;
        if (!name) return res.json({ success: false, error: 'Name required' });
        const r = require('../commands/rpcPresets').upsert(name, config);
        res.json(r && r.error ? { success: false, error: r.error } : { success: true });
    });
    app.post('/api/rpc/presets/delete', (req, res) => {
        require('../commands/rpcPresets').delete(req.body.name);
        res.json({ success: true });
    });
    app.post('/api/rpc/presets/load', (req, res) => {
        const p = require('../commands/rpcPresets').list().find(x => x.name === req.body.name);
        if (!p) return res.json({ success: false, error: 'Not found' });
        res.json({ success: true, config: p.config });
    });

    // Auto Reaction API
    app.get('/api/reaction', (req, res) => {
        const reactionManager = require('../commands/reactionManager');
        const data = reactionManager.loadData();

        // Enrich Servers
        const enrichedServers = (data.enabledServers || []).map(id => {
            const g = client.guilds.cache.get(id);
            return {
                id,
                name: g ? g.name : `Unknown Server`,
                icon: g ? g.iconURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png'
            };
        });

        // Enrich Channels
        const enrichedChannels = (data.enabledChannels || []).map(id => {
            const c = client.channels.cache.get(id);
            return {
                id,
                name: c ? c.name : `Unknown Channel`,
                guildName: c?.guild ? c.guild.name : 'Unknown Server',
                guildIcon: c?.guild ? c.guild.iconURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png'
            };
        });

        res.json({ ...data, enrichedServers, enrichedChannels });
    });

    app.post('/api/reaction', (req, res) => {
        const reactionManager = require('../commands/reactionManager');
        reactionManager.saveData(req.body);
        res.json({ success: true });
    });

    // Validation APIs
    app.post('/api/validate/guild', async (req, res) => {
        const { id } = req.body;
        try {
            const guild = client.guilds.cache.get(id);
            if (!guild) return res.status(404).json({ error: 'Server not found (Bot must be in it)' });
            res.json({
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png'
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/validate/channel', async (req, res) => {
        const { id } = req.body;
        try {
            const channel = client.channels.cache.get(id);
            if (!channel) return res.status(404).json({ error: 'Channel not found' });
            res.json({
                id: channel.id,
                name: channel.name,
                guildId: channel.guild?.id,
                guildName: channel.guild?.name || 'Direct Message',
                guildIcon: channel.guild?.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png'
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // --- AI Chat Routes ---
    app.get('/ai', (req, res) => {
        res.render('cmd_ai', { user: client.user, page: 'ai' }); // page 'ai' for highlighting if added to menu
    });

    app.get('/api/ai', (req, res) => {
        const aiManager = require('../commands/aiManager');
        const data = aiManager.loadData();

        // Enrich Data for UI (Server/Channel/User names)
        // Similar to Reaction, we want to show nice lists

        const enrichedServers = (data.enabledServers || []).map(id => {
            const g = client.guilds.cache.get(id);
            return { id, name: g ? g.name : 'Unknown Server', icon: g ? g.iconURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png' };
        });
        const enrichedChannels = (data.enabledChannels || []).map(id => {
            const c = client.channels.cache.get(id);
            return { id, name: c ? c.name : 'Unknown Channel', guildName: c?.guild?.name || 'Unknown', guildIcon: c?.guild?.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png' };
        });
        const enrichedGroupsAlways = (data.enabledGroups || []).map(id => {
            const c = client.channels.cache.get(id);
            let name = c ? c.name : 'Unknown Channel/Group';
            if (c && !name && c.recipients) name = c.recipients.map(u => u.username).join(', ');
            return { id, name, mode: 'always' };
        });
        const enrichedGroupsMention = (data.enabledGroupsMention || []).map(id => {
            const c = client.channels.cache.get(id);
            let name = c ? c.name : 'Unknown Channel/Group';
            if (c && !name && c.recipients) name = c.recipients.map(u => u.username).join(', ');
            return { id, name, mode: 'mention' };
        });
        const enrichedGroups = [...enrichedGroupsAlways, ...enrichedGroupsMention];

        const enrichedFreeWill = (data.freeWillChannels || []).map(item => {
            const id = typeof item === 'object' ? item.id : item;
            const delay = typeof item === 'object' ? item.delay : 0;
            const c = client.channels.cache.get(id);
            return { id, delay, name: c ? c.name : 'Unknown Channel', guildName: c?.guild?.name || 'Unknown', guildIcon: c?.guild?.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png' };
        });
        const enrichedUsers = (data.dmUsers || []).map(id => {
            const u = client.users.cache.get(id); // Users might not be cached if not seen?
            // Selfbots usually have large cache if they are in servers.
            return { id, username: u ? u.username : 'Unknown User', avatar: u ? u.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png' };
        });

        const enrichedBlockedUsers = (data.blockedUsers || []).map(id => {
            const u = client.users.cache.get(id);
            return { id, username: u ? u.username : 'Unknown User', avatar: u ? u.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png' };
        });

        res.json({ ...data, enrichedServers, enrichedChannels, enrichedGroups, enrichedFreeWill, enrichedUsers, enrichedBlockedUsers });
    });

    app.post('/api/ai', (req, res) => {
        const aiManager = require('../commands/aiManager');
        aiManager.saveData(req.body);
        res.json({ success: true });
    });

    app.post('/api/validate/user', async (req, res) => {
        const { id } = req.body;
        try {
            const user = await client.users.fetch(id).catch(() => null);
            if (!user) return res.status(404).json({ error: 'User not found' });
            res.json({
                id: user.id,
                username: user.username,
                avatar: user.displayAvatarURL({ dynamic: true })
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Validate Channel OR User (Mixed) for Auto Msg
    app.post('/api/validate/mixed', async (req, res) => {
        const { id } = req.body;
        try {
            // Check Channel First
            const channel = await client.channels.fetch(id).catch(() => null);
            if (channel) {
                // Must be text-based to send messages
                if (!channel.isText()) return res.status(400).json({ error: 'Channel is not a text channel' });
                return res.json({
                    type: 'channel',
                    id: channel.id,
                    name: channel.name,
                    guildName: channel.guild?.name || 'DM',
                    icon: channel.guild?.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png'
                });
            }

            // Check User Second
            const user = await client.users.fetch(id).catch(() => null);
            if (user) {
                return res.json({
                    type: 'user',
                    id: user.id,
                    name: user.username,
                    guildName: 'Direct Message', // Display context as DM for clarity
                    icon: user.displayAvatarURL({ dynamic: true })
                });
            }

            res.status(404).json({ error: 'ID not found (Must be Channel or User)' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/commands/reaction', (req, res) => {
        res.render('cmd_reaction', { user: client.user, page: 'commands' });
    });
    app.get('/commands/mirror', (req, res) => {
        res.render('cmd_mirror', { user: client.user, page: 'commands' });
    });
    app.get('/commands/clipboard', (req, res) => {
        res.render('cmd_clipboard', { user: client.user, page: 'commands' });
    });

    // --- Auto Msg Routes ---
    app.get('/commands/auto-msg', (req, res) => {
        res.render('cmd_auto_msg', { user: client.user, page: 'commands' });
    });

    app.get('/api/auto-msg', (req, res) => {
        const autoMsg = require('../commands/autoMsg');
        res.json(autoMsg.getList());
    });

    app.post('/api/auto-msg', async (req, res) => {
        const autoMsg = require('../commands/autoMsg');
        const { action, channelId, message, interval, unit } = req.body;

        try {
            if (action === 'add') {
                // Validate permissions one last time logic?
                // The frontend checks, but backend should too ideally.
                // startTimer throws if invalid.
                await autoMsg.startTimer(client, channelId, message, interval, unit);
                autoMsg.addAutoMsg(channelId, message, interval, unit); // Save if start success
            } else if (action === 'remove') {
                autoMsg.removeAutoMsg(channelId);
            }
            res.json({ success: true });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // --- Timed Msg Routes ---
    app.get('/commands/timed-msg', (req, res) => {
        res.render('cmd_timed_msg', { user: client.user, page: 'commands' });
    });

    app.get('/api/timed-msg', (req, res) => {
        const timedMsg = require('../commands/timedMsg');
        res.json(timedMsg.getList());
    });

    app.post('/api/timed-msg', async (req, res) => {
        const timedMsg = require('../commands/timedMsg');
        const { action, id, channelId, message, timestamp, timezone } = req.body;

        try {
            if (action === 'add') {
                const item = timedMsg.addTimedMsg(client, channelId, message, timestamp, timezone);
                res.json({ success: true, item });
            } else if (action === 'remove') {
                timedMsg.removeTimedMsg(id);
                res.json({ success: true });
            } else {
                res.status(400).json({ error: 'Invalid action' });
            }
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.get('/api/clipboard', (req, res) => {
        const clipboardManager = require('../commands/clipboardManager');
        res.json(clipboardManager.loadData());
    });

    app.post('/api/clipboard', (req, res) => {
        const clipboardManager = require('../commands/clipboardManager');
        const { action, trigger, response } = req.body;

        if (action === 'add') {
            clipboardManager.addTrigger(trigger, response);
        } else if (action === 'remove') {
            clipboardManager.removeTrigger(trigger);
        }
        res.json({ success: true });
    });

    app.get('/commands/allowed', (req, res) => {
        res.render('cmd_allowed', { user: client.user, page: 'commands' });
    });

    // --- Allowed ID Routes ---
    app.get('/api/allowed', async (req, res) => {
        const allowedManager = require('../commands/allowedManager');
        const { active } = require('../accountManager').getAccounts();
        const data = allowedManager.loadData(active);

        // Enrich user data
        const enrichedUsers = await Promise.all(data.allowedUsers.map(async (id) => {
            const u = await getClient().users.fetch(id).catch(() => null);
            const isSelf = getClient().user && id === getClient().user.id;
            return {
                id,
                username: u ? u.username : 'Unknown User',
                avatar: u ? u.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png',
                isSelf
            };
        }));

        res.json({ allowedUsers: enrichedUsers, enabled: data.enabled !== false });
    });

    app.post('/api/allowed', (req, res) => {
        const { action, id } = req.body;
        const allowedManager = require('../commands/allowedManager');
        const { active } = require('../accountManager').getAccounts();

        if (action === 'add') {
            allowedManager.addAllowedUser(id, active);
        } else if (action === 'remove') {
            // Prevent removing self
            if (getClient().user && id === getClient().user.id)
                return res.json({ success: false, error: 'Cannot remove the logged-in account from its own allowed list.' });
            allowedManager.removeAllowedUser(id, active);
        } else if (action === 'enable') {
            allowedManager.setEnabled(true, active);
        } else if (action === 'disable') {
            allowedManager.setEnabled(false, active);
        }
        res.json({ success: true });
    });

    // --- Mirror Routes ---
    app.get('/api/mirror', (req, res) => {
        const mirrorManager = require('../commands/mirrorManager');
        const list = mirrorManager.getActiveMirrors() || [];
        const enriched = list.map(m => {
            const s = client.channels.cache.get(m.sourceId);
            const t = client.channels.cache.get(m.targetId);
            return {
                ...m,
                sourceName: s ? `#${s.name} (${s.guild?.name || 'DM'})` : m.sourceId,
                targetName: t ? `#${t.name} (${t.guild?.name || 'DM'})` : m.targetId,
                sourceIcon: s?.guild?.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png',
                targetIcon: t?.guild?.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png'
            };
        });
        res.json(enriched);
    });

    app.post('/api/mirror', async (req, res) => {
        const { sourceId, targetId, mode } = req.body;
        const mirrorManager = require('../commands/mirrorManager');
        try {
            await mirrorManager.startMirror(client, sourceId, targetId, mode);
            res.json({ success: true });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.delete('/api/mirror', async (req, res) => {
        const { sourceId } = req.body;
        const mirrorManager = require('../commands/mirrorManager');
        await mirrorManager.stopMirror(sourceId);
        res.json({ success: true });
    });

    app.post('/api/validate/mirror-channel', async (req, res) => {
        const { id, checkWebhook } = req.body;
        try {
            const channel = await client.channels.fetch(id).catch(() => null);
            if (!channel) return res.status(404).json({ error: 'Channel not found/Not Visible' });

            if (!channel.isText()) return res.status(400).json({ error: 'Not a text channel' });

            // Selfbots have full user perms, just check if we can view/send
            // But channel.permissionsFor works if in guild.
            if (channel.guild) {
                const permissions = channel.permissionsFor(client.user);

                // If checking Target, ensure we can SEND
                const { type } = req.body;
                if (type === 'target') {
                    if (!permissions.has('SEND_MESSAGES')) return res.status(403).json({ error: 'Missing SEND_MESSAGES permission' });
                } else {
                    // Source: just need to view
                    if (!permissions.has('VIEW_CHANNEL')) return res.status(403).json({ error: 'Missing VIEW_CHANNEL permission' });
                }

                if (checkWebhook) {
                    if (!permissions.has('MANAGE_WEBHOOKS')) return res.status(403).json({ error: 'Missing MANAGE_WEBHOOKS permission (Required for Clone)' });
                }
            } else {
                // DM - always can send if friend?
                // Webhooks don't work in DMs.
                if (checkWebhook) return res.status(400).json({ error: 'Clone Mode (Webhooks) not supported in DMs' });
            }

            res.json({
                success: true,
                name: channel.name || 'DM',
                guildName: channel.guild?.name || 'Direct Message',
                icon: channel.guild?.iconURL({ dynamic: true }) || channel.recipient?.displayAvatarURL({ dynamic: true })
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/commands/welcomer', (req, res) => {
        res.render('cmd_welcomer', { user: client.user, page: 'commands' });
    });

    app.get('/api/welcomer', async (req, res) => {
        const welcomerManager = require('../commands/welcomerManager');
        const data = welcomerManager.loadData();
        const setups = data.welcomeSetups || {};

        // Enrich server info
        const enrichedList = [];
        for (const [guildId, val] of Object.entries(setups)) {
            const guild = client.guilds.cache.get(guildId);
            let channelName = "Unknown Channel";
            if (guild) {
                const c = guild.channels.cache.get(val.channelId);
                if (c) channelName = c.name;
            }

            enrichedList.push({
                guildId,
                guildName: guild ? guild.name : `Server ${guildId}`,
                icon: guild && guild.iconURL() ? guild.iconURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png',
                channelId: val.channelId,
                channelName: channelName,
                template: val.template,
                background: val.background,
                textcolor: val.textcolor,
                welcomeType: val.welcomeType || 'card',
                textMessage: val.textMessage || 'hey {user} welcome to the {server} you are {count} member',
                cardMessage: val.cardMessage || 'WELCOME TO {server}\n{user}\nMember #{count}'
            });
        }
        const config = data.config || { textcolor: 'white', welcomeType: 'card', textMessage: 'hey {user} welcome to the {server} you are {count} member', cardMessage: 'WELCOME TO {server}\n{user}\nMember #{count}' };
        res.json({ setups: enrichedList, config });
    });

    app.post('/api/welcomer', (req, res) => {
        const welcomerManager = require('../commands/welcomerManager');
        const { action, guildId, channelId, template, background, textcolor, welcomeType, textMessage, cardMessage } = req.body;

        try {
            if (action === 'add') {
                welcomerManager.addSetup(guildId, channelId, template, background, textcolor, welcomeType, textMessage, cardMessage);
            } else if (action === 'remove') {
                welcomerManager.removeSetup(guildId);
            } else if (action === 'saveConfig') {
                const data = welcomerManager.loadData();
                data.config = { textcolor, welcomeType, textMessage, cardMessage, enabled: data.config?.enabled !== false };
                
                // Update all existing setups automatically
                if (!data.welcomeSetups) data.welcomeSetups = {};
                for (let gid of Object.keys(data.welcomeSetups)) {
                    data.welcomeSetups[gid].textcolor = textcolor;
                    data.welcomeSetups[gid].welcomeType = welcomeType;
                    data.welcomeSetups[gid].textMessage = textMessage;
                    data.welcomeSetups[gid].cardMessage = cardMessage;
                }
                welcomerManager.saveData(data);
            } else if (action === 'toggleGlobal') {
                const data = welcomerManager.loadData();
                if (!data.config) data.config = {};
                data.config.enabled = req.body.enabled;
                welcomerManager.saveData(data);
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/commands/:category', (req, res) => {
        const category = req.params.category;
        res.render('commands_sub', {
            user: client.user,
            page: 'commands',
            category: category.charAt(0).toUpperCase() + category.slice(1)
        });
    });

    // --- ACCOUNTS Routes ---
    // (accountManager already required above for no-token guard)

    app.get('/accounts', (req, res) => {
        const { accounts, active } = accountManager.getAccounts();
        const setupMode = accounts.length === 0;
        // Allow access even without a live client in setup mode
        const user = getClient().user || null;
        res.render('accounts', { user, page: 'accounts', accounts, active, setupMode });
    });

    // Returns enriched account list with Discord username/avatar fetched from token
    app.get('/api/accounts/list', async (req, res) => {
        const { accounts, active } = accountManager.getAccounts();
        const statusManager = require('../commands/statusManager');

        const enriched = await Promise.all(accounts.map(async (acc) => {
            // Active account — use live client data
            if (acc.index === active && getClient().user) {
                const u = getClient().user;
                const presence = getClient().user.presence;
                const liveStatus = presence ? presence.status : statusManager.loadData().status || 'online';
                return {
                    index: acc.index,
                    username: u.username,
                    discriminator: u.discriminator,
                    avatar: u.displayAvatarURL({ format: 'png', size: 128 }),
                    status: liveStatus,
                    active: true
                };
            }
            // Inactive account — fetch from Discord API using token
            try {
                const apiRes = await fetch('https://discord.com/api/v10/users/@me', {
                    headers: { Authorization: acc.token }
                });
                if (!apiRes.ok) throw new Error('fetch failed');
                const data = await apiRes.json();
                const avatarUrl = data.avatar
                    ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128`
                    : `https://cdn.discordapp.com/embed/avatars/${parseInt(data.discriminator || 0) % 5}.png`;
                // Read saved status for this account's data dir
                const fs = require('fs');
                const path = require('path');
                const statusFile = path.join(__dirname, '..', 'data', `account_${acc.index}`, 'status.json');
                let savedStatus = 'online';
                if (fs.existsSync(statusFile)) {
                    try { savedStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8')).status || 'online'; } catch (e) {}
                }
                return {
                    index: acc.index,
                    username: data.username,
                    discriminator: data.discriminator,
                    avatar: avatarUrl,
                    status: savedStatus,
                    active: false
                };
            } catch (e) {
                return {
                    index: acc.index,
                    username: 'Unknown',
                    discriminator: '0000',
                    avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
                    status: 'offline',
                    active: false
                };
            }
        }));
        res.json({ accounts: enriched, active });
    });

    app.post('/api/accounts/add', async (req, res) => {
        const { token } = req.body;
        if (!token || token.trim().length < 20) return res.json({ success: false, message: 'Invalid token' });
        const { accounts: before } = accountManager.getAccounts();
        const isFirst = before.length === 0;
        const result = accountManager.addAccount(token.trim());
        if (result && result.duplicate) {
            return res.json({ success: false, message: `Token already exists at ${result.key}` });
        }
        const index = result;
        if (isFirst && global.bootClient) {
            global.bootClient(token.trim(), index).catch(e => console.error('[Accounts] Auto-boot failed:', e.message));
        }
        res.json({ success: true, index, isFirst });
    });

    app.post('/api/accounts/delete', (req, res) => {
        const { index } = req.body;
        const ok = accountManager.deleteAccount(parseInt(index));
        res.json(ok ? { success: true } : { success: false, message: 'Account not found' });
    });

    app.post('/api/accounts/switch', async (req, res) => {
        const { index } = req.body;
        const ok = accountManager.switchAccount(parseInt(index));
        if (!ok) return res.json({ success: false, message: 'Account not found' });
        try {
            await global.switchBotAccount(parseInt(index));
            res.json({ success: true });
        } catch (e) {
            console.error('[Account Switch Error]', errCode(e));
            res.json({ success: false, message: errCode(e) });
        }
    });

    // --- MUSIC Routes ---

    app.get('/music', (req, res) => {
        if (!client.user) return res.send(LOADING_PAGE('Music'));
        res.render('music', {
            user: client.user,
            page: 'music'
        });
    });

    app.get('/api/music/status', (req, res) => {
        const queues = client.queueManager ? client.queueManager.getAll() : new Map();

        const getCover = (info) => {
            if (info.sourceName === 'youtube' || info.uri.includes('youtube')) {
                return `https://img.youtube.com/vi/${info.identifier}/maxresdefault.jpg`;
            } else if (info.artworkUrl) {
                return info.artworkUrl;
            }
            return 'https://i.imgur.com/2ce2t5e.png';
        };

        let musicData = {
            connected: !!client.lavalink,
            isPlaying: false,
            guildName: 'No Guild',
            guildIcon: null,
            channelName: '',
            nowPlaying: null,
            position: 0,
            duration: 0,
            volume: 100,
            loop: 'none',
            repeatMode: 'once',
            repeatCount: 1,
            currentRepeat: 0,
            autoplay: false,
            queue: [],
            queueCount: 0
        };

        // Get first active queue
        for (const [guildId, queue] of queues) {
            if (queue.nowPlaying) {
                const guild = client.guilds.cache.get(guildId);
                const voiceState = client.lavalinkVoiceStates ? client.lavalinkVoiceStates[guildId] : null; // Custom voiceStates storage
                // OR check client.guilds.cache.get(guildId).me.voice.channel

                musicData.activeGuildId = guildId;
                musicData.isPlaying = true;
                musicData.guildName = guild ? guild.name : `Guild ${guildId}`;
                musicData.guildIcon = guild ? guild.iconURL({ dynamic: true, size: 128 }) : null;
                musicData.volume = queue.volume !== undefined ? queue.volume : 100;
                musicData.loop = queue.loop || 'none';
                musicData.repeatMode = queue.repeatMode || 'once';
                musicData.repeatCount = queue.repeatCount || 1;
                musicData.currentRepeat = queue.currentRepeat || 0;
                musicData.autoplay = queue.autoplay || false;
                musicData.paused = queue.paused || false;

                // Try to find channel name
                // queue doesn't store channelId? Lavalink might. 
                // We'll leave channelName generic or try to find where bot is
                if (guild && guild.me && guild.me.voice && guild.me.voice.channel) {
                    musicData.channelName = guild.me.voice.channel.name;
                }

                const info = queue.nowPlaying.info;
                let cover = 'https://i.imgur.com/2ce2t5e.png'; // Fallback

                if (info.sourceName === 'youtube' || info.uri.includes('youtube')) {
                    cover = `https://img.youtube.com/vi/${info.identifier}/maxresdefault.jpg`;
                } else if (info.artworkUrl) {
                    cover = info.artworkUrl;
                }

                musicData.nowPlaying = {
                    title: info.title,
                    author: info.author,
                    cover: cover,
                    url: info.uri
                };

                musicData.duration = info.length;
                musicData.position = queue.position || 0;

                // Adjust position estimate (only advance if not paused)
                if (queue.lastUpdate && !queue.paused) {
                    const diff = Date.now() - queue.lastUpdate;
                    musicData.position += diff;
                    if (musicData.position > musicData.duration) musicData.position = musicData.duration;
                }

                musicData.queue = queue.songs.map(song => ({
                    title: song.info.title,
                    author: song.info.author,
                    uri: song.info.uri,
                    cover: getCover(song.info)
                }));
                musicData.queueCount = queue.songs.length;
                break;
            }
        }

        if (!musicData.isPlaying) {
            for (const [id, guild] of client.guilds.cache) {
                if (guild.me && guild.me.voice && guild.me.voice.channelId) {
                    musicData.activeGuildId = id;
                    musicData.isConnectedToVoice = true;
                    musicData.guildName = guild.name;
                    musicData.guildIcon = guild.iconURL ? guild.iconURL({ dynamic: true, size: 128 }) : null;
                    if (guild.me.voice.channel) musicData.channelName = guild.me.voice.channel.name;
                    break;
                }
            }
        }

        res.json(musicData);
    });

    app.post('/api/music/stop', async (req, res) => {
        try {
            const queues = client.queueManager ? client.queueManager.getAll() : new Map();
            let stopped = false;

            for (const [guildId, queue] of queues) {
                if (queue.nowPlaying) {
                    if (client.lavalink) {
                        await client.lavalink.destroyPlayer(guildId);
                    }
                    client.queueManager.delete(guildId);

                    // Try to disconnect from voice
                    const { getVoiceConnection } = require('@discordjs/voice');
                    const connection = getVoiceConnection(guildId);
                    if (connection) {
                        connection.destroy();
                    }

                    stopped = true;
                }
            }

            if (stopped) {
                res.json({ success: true, message: 'Music stopped' });
            } else {
                res.json({ success: false, message: 'No music is playing' });
            }
        } catch (error) {
            console.error('Error stopping music:', error);
            res.json({ success: false, message: error.message });
        }
    });

    app.post('/api/music/skip', async (req, res) => {
        try {
            const queues = client.queueManager ? client.queueManager.getAll() : new Map();
            for (const [guildId, queue] of queues) {
                if (queue.nowPlaying) {
                    if (queue.autoplay && queue.songs.length < 5) await client.queueManager.fillAutoplayQueue(client, guildId);
                    const nextSong = client.queueManager.getNext(guildId);

                    if (!nextSong) {
                        if (client.lavalink) await client.lavalink.destroyPlayer(guildId);
                        client.queueManager.delete(guildId);
                    } else {
                        if (queue.nowPlaying) queue.history.push(queue.nowPlaying);
                        queue.nowPlaying = nextSong;
                        queue.position = 0;
                        queue.lastUpdate = Date.now();
                        await client.lavalink.updatePlayer(guildId, nextSong, client.lavalinkVoiceStates[guildId] || {});
                    }
                    return res.json({ success: true });
                }
            }
            res.json({ success: false, message: 'No music playing' });
        } catch (e) { console.error(e); res.json({ success: false }); }
    });

    app.post('/api/music/previous', async (req, res) => {
        try {
            const queues = client.queueManager ? client.queueManager.getAll() : new Map();
            for (const [guildId, queue] of queues) {
                if (queue.nowPlaying && queue.history.length > 0) {
                    const prev = queue.history.pop();
                    queue.songs.unshift(queue.nowPlaying);
                    queue.nowPlaying = prev;
                    queue.position = 0;
                    queue.lastUpdate = Date.now();
                    await client.lavalink.updatePlayer(guildId, prev, client.lavalinkVoiceStates[guildId] || {});
                    return res.json({ success: true });
                }
            }
            res.json({ success: false, message: 'No previous song' });
        } catch (e) { console.error(e); res.json({ success: false }); }
    });

    app.post('/api/music/volume', async (req, res) => {
        const { guildId, volume } = req.body;
        try {
            const queue = client.queueManager ? client.queueManager.get(guildId) : null;
            if (queue && client.lavalink) {
                const vol = parseInt(volume);
                // Extended volume range: 0 - 5000% (5x louder than before)
                if (!isNaN(vol) && vol >= 0 && vol <= 5000) {
                    queue.volume = vol;
                    await client.lavalink.updatePlayerProperties(guildId, { volume: vol });
                    return res.json({ success: true, volume: vol });
                }
            }
            res.json({ success: false, message: 'No active player or invalid volume (0-5000)' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Pause / Resume endpoint — supports Manual playback mode for custom file player
    app.post('/api/music/pause', async (req, res) => {
        const { guildId, pause } = req.body;
        try {
            const queue = client.queueManager ? client.queueManager.get(guildId) : null;
            if (queue && client.lavalink) {
                const shouldPause = pause === true || pause === 'true';
                queue.paused = shouldPause;
                await client.lavalink.updatePlayerProperties(guildId, { paused: shouldPause });
                if (shouldPause) {
                    queue.lastUpdate = Date.now(); // Freeze position
                } else {
                    queue.lastUpdate = Date.now(); // Resume position counter
                }
                return res.json({ success: true, paused: shouldPause });
            }
            res.json({ success: false, message: 'No active player' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/music/loop', async (req, res) => {
        const { guildId, mode, count } = req.body;
        try {
            const queue = client.queueManager ? client.queueManager.get(guildId) : null;
            if (queue && client.lavalink) {
                // New explicit mode argument
                if (mode && ['once', 'loop', 'queue', 'repeatN'].includes(mode)) {
                    queue.repeatMode = mode;
                    // Also sync legacy loop field for compatibility
                    if (mode === 'loop') queue.loop = 'track';
                    else if (mode === 'queue') queue.loop = 'queue';
                    else queue.loop = 'none';

                    if (mode === 'repeatN') {
                        const n = parseInt(count);
                        queue.repeatCount = (!isNaN(n) && n >= 1 && n <= 100) ? n : 1;
                        queue.currentRepeat = 0; // reset counter when mode changes
                    } else {
                        queue.repeatCount = 1;
                        queue.currentRepeat = 0;
                    }
                } else {
                    // Legacy behavior: cycle none -> track -> queue -> none
                    if (queue.repeatMode === 'once' || !queue.repeatMode) {
                        queue.repeatMode = 'loop';
                        queue.loop = 'track';
                    } else if (queue.repeatMode === 'loop') {
                        queue.repeatMode = 'queue';
                        queue.loop = 'queue';
                    } else if (queue.repeatMode === 'queue') {
                        queue.repeatMode = 'once';
                        queue.loop = 'none';
                    } else {
                        queue.repeatMode = 'once';
                        queue.loop = 'none';
                    }
                    queue.currentRepeat = 0;
                }
                return res.json({
                    success: true,
                    repeatMode: queue.repeatMode,
                    repeatCount: queue.repeatCount,
                    currentRepeat: queue.currentRepeat,
                    loop: queue.loop
                });
            }
            res.json({ success: false, message: 'No active player' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/music/autoplay', async (req, res) => {
        const { guildId } = req.body;
        try {
            const queue = client.queueManager ? client.queueManager.get(guildId) : null;
            if (queue && client.lavalink) {
                queue.autoplay = !queue.autoplay;
                if (queue.autoplay) {
                    await client.queueManager.fillAutoplayQueue(client, guildId);
                }
                return res.json({ success: true, autoplay: queue.autoplay });
            }
            res.json({ success: false, message: 'No active player' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/music/seek', async (req, res) => {
        const { guildId, amount } = req.body;
        try {
            const queue = client.queueManager ? client.queueManager.get(guildId) : null;
            if (queue && client.lavalink && queue.nowPlaying) {
                let newPosition = queue.position + amount;

                if (newPosition < 0) newPosition = 0;
                if (newPosition > queue.nowPlaying.info.length) {
                    newPosition = queue.nowPlaying.info.length - 1000;
                    if (newPosition < 0) newPosition = 0;
                }

                await client.lavalink.updatePlayerProperties(guildId, { position: newPosition });
                queue.position = newPosition;
                queue.lastUpdate = Date.now();
                return res.json({ success: true, position: newPosition });
            }
            res.json({ success: false, message: 'No active player' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // fs and path already required at the top

    app.get('/api/music/playlists', (req, res) => {
        try {
            const pltPath = path.join(__dirname, '../data/playlists.json');
            if (fs.existsSync(pltPath)) {
                const data = JSON.parse(fs.readFileSync(pltPath, 'utf8'));
                res.json({ success: true, playlists: Object.keys(data) });
            } else {
                res.json({ success: true, playlists: [] });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    app.post('/api/music/playlist/load', async (req, res) => {
        const { guildId, name } = req.body;
        try {
            const pltPath = path.join(__dirname, '../data/playlists.json');
            if (!fs.existsSync(pltPath)) return res.json({ success: false, message: 'No playlists found' });

            const data = JSON.parse(fs.readFileSync(pltPath, 'utf8'));
            const playlist = data[name];
            if (!playlist || playlist.length === 0) return res.json({ success: false, message: 'Playlist not found or empty' });

            const voiceState = client.lavalinkVoiceStates ? client.lavalinkVoiceStates[guildId] : null;
            if (!voiceState || !voiceState.token) {
                return res.json({ success: false, message: 'Bot not connected to voice in this server' });
            }

            let queue = client.queueManager ? client.queueManager.get(guildId) : null;
            if (!queue) {
                queue = client.queueManager.create(guildId);
            }

            let added = 0;
            for (const song of playlist) {
                try {
                    const lRes = await client.lavalink.loadTracks(song.uri);
                    let trackToLoad;

                    if (lRes.loadType === 'track') trackToLoad = lRes.data;
                    else if (lRes.loadType === 'playlist') trackToLoad = lRes.data.tracks[0];
                    else if (lRes.loadType === 'search') trackToLoad = lRes.data[0];

                    if (trackToLoad) {
                        client.queueManager.addSong(guildId, trackToLoad);
                        added++;
                    }
                } catch (e) {
                    console.error('Error loading fav track:', e);
                }
            }

            if (added > 0 && !queue.nowPlaying && client.queueManager) {
                const nextSong = client.queueManager.getNext(guildId);
                if (nextSong) {
                    queue.nowPlaying = nextSong;
                    await client.lavalink.updatePlayer(guildId, nextSong, voiceState, {
                        volume: queue.volume,
                        filters: queue.filters
                    });
                }
            }

            if (queue && queue.autoplay && queue.songs.length < 5) {
                await client.queueManager.fillAutoplayQueue(client, guildId);
            }

            res.json({ success: true, added });
        } catch (e) {
            console.error('Playlist load API error:', e);
            res.json({ success: false, message: e.message });
        }
    });




    app.get('/api/discord/guilds', (req, res) => {
        try {
            const guilds = client.guilds.cache.map(g => ({ id: g.id, name: g.name, icon: g.iconURL() }));
            res.json(guilds);
        } catch (e) { res.json([]); }
    });

    app.get('/api/discord/channels/:guildId', (req, res) => {
        try {
            const guild = client.guilds.cache.get(req.params.guildId);
            if (!guild) return res.json([]);
            const channels = guild.channels.cache
                .filter(c => c.type === 'GUILD_VOICE' || c.type === 'GUILD_STAGE_VOICE')
                .map(c => ({ id: c.id, name: c.name }));
            res.json(channels);
        } catch (e) { res.json([]); }
    });

    // --- VC MESSAGING ---
    app.post('/api/music/vc-message', async (req, res) => {
        const { guildId, message } = req.body;
        if (!guildId || !message) return res.json({ success: false, message: 'Missing args' });
        try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild || !guild.me || !guild.me.voice || !guild.me.voice.channelId)
                return res.json({ success: false, message: 'Not in a voice channel' });
            const channel = guild.channels.cache.get(guild.me.voice.channelId);
            if (!channel) return res.json({ success: false, message: 'Channel not found' });
            await channel.send(message);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, message: e.message }); }
    });

    app.get('/api/music/soundboard/:guildId', async (req, res) => {
        try {
            const guild = client.guilds.cache.get(req.params.guildId);
            if (!guild) return res.json({ sounds: [] });
            const token = getClient().token;
            const r = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/soundboard-sounds`, {
                headers: { Authorization: token }
            });
            if (!r.ok) return res.json({ sounds: [] });
            const data = await r.json();
            const list = (data.items || data || []).map(s => ({ id: s.sound_id, name: s.name, emoji: s.emoji_name || null }));
            res.json({ sounds: list });
        } catch (e) { res.json({ sounds: [] }); }
    });

    app.post('/api/music/soundboard/play', async (req, res) => {
        const { guildId, soundId } = req.body;
        if (!guildId || !soundId) return res.json({ success: false, message: 'Missing args' });
        try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild || !guild.me || !guild.me.voice || !guild.me.voice.channelId)
                return res.json({ success: false, message: 'Not in a voice channel' });
            await client.rest.post(`/channels/${guild.me.voice.channelId}/send-soundboard-sound`, {
                body: { sound_id: soundId, source_guild_id: guildId }
            });
            res.json({ success: true });
        } catch (e) { res.json({ success: false, message: e.message }); }
    });

    app.post('/api/music/join', async (req, res) => {
        const { guildId, channelId } = req.body;
        try {
            const payload = { op: 4, d: { guild_id: guildId, channel_id: channelId, self_mute: false, self_deaf: false } };
            if (client.ws && client.ws.shards) client.ws.shards.get(0).send(payload);
            else client.ws.broadcast(payload);
            res.json({ success: true });
        } catch (e) { console.error(e); res.json({ success: false }); }
    });

    app.post('/api/music/voice-state', async (req, res) => {
        const { guildId, mute, deaf } = req.body;
        try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild || !guild.me || !guild.me.voice || !guild.me.voice.channelId)
                return res.json({ success: false, message: 'Not in a voice channel' });
            const channelId = guild.me.voice.channelId;
            const selfMute = !!mute || !!deaf; // Discord requires mute=true when deafened
            const payload = { op: 4, d: { guild_id: guildId, channel_id: channelId, self_mute: selfMute, self_deaf: !!deaf } };
            if (client.ws && client.ws.shards) client.ws.shards.get(0).send(payload);
            else client.ws.broadcast(payload);
            res.json({ success: true, mute: !!mute, deaf: !!deaf });
        } catch (e) { console.error(e); res.json({ success: false, message: e.message }); }
    });

    app.post('/api/music/leave', async (req, res) => {
        const { guildId } = req.body;
        try {
            client.queueManager.delete(guildId);
            if (client.lavalink) await client.lavalink.destroyPlayer(guildId);

            const payload = { op: 4, d: { guild_id: guildId, channel_id: null } };
            if (client.ws && client.ws.shards) client.ws.shards.get(0).send(payload);
            else client.ws.broadcast(payload);

            res.json({ success: true });
        } catch (e) { console.error(e); res.json({ success: false }); }
    });

    app.post('/api/music/play', async (req, res) => {
        const { guildId, query } = req.body;
        if (!guildId || !query) return res.json({ success: false, message: 'Missing args' });

        try {
            const { playLogic } = require('../commands/play');
            const result = await playLogic(client, guildId, query);
            res.json(result);
        } catch (e) { console.error(e); res.json({ success: false, message: e.message }); }
    });

    // --- CUSTOM FILE UPLOAD (Voice) ---
    // Uploads an MP3/MP4 file to a public host so the remote Lavalink server
    // can stream it. Tries catbox.moe first (permanent), falls back to
    // tmpfiles.org (1-hour expiry, but reliable).
    app.post('/api/voice/upload', express.raw({ type: '*/*', limit: '220mb' }), async (req, res) => {
        try {
            if (!req.body || !req.body.length) {
                return res.json({ success: false, message: 'No file received' });
            }

            const filename = req.headers['x-filename']
                ? decodeURIComponent(req.headers['x-filename'])
                : 'upload.mp3';
            const contentType = req.headers['content-type'] || 'application/octet-stream';

            console.log(`[Voice Upload] Received file: ${filename} (${(req.body.length / 1024 / 1024).toFixed(2)} MB, type: ${contentType})`);

            // --- Strategy 1: catbox.moe (permanent, but may reject some IPs) ---
            try {
                const formData = new FormData();
                formData.append('reqtype', 'fileupload');
                formData.append('fileToUpload', new Blob([req.body], { type: contentType }), filename);

                const catRes = await fetch('https://catbox.moe/user/api.php', {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'User-Agent': 'PROPlus/1.0 (https://github.com/proplus)'
                    }
                });

                if (catRes.ok) {
                    const responseText = (await catRes.text()).trim();
                    if (responseText.startsWith('https://')) {
                        console.log('[Voice Upload] catbox.moe success:', responseText);
                        return res.json({ success: true, url: responseText, host: 'catbox' });
                    }
                    console.log('[Voice Upload] catbox.moe responded non-URL:', responseText, '— falling back to tmpfiles');
                } else {
                    console.log('[Voice Upload] catbox.moe HTTP', catRes.status, '— falling back to tmpfiles');
                }
            } catch (catErr) {
                console.log('[Voice Upload] catbox.moe error:', catErr.message, '— falling back to tmpfiles');
            }

            // --- Strategy 2: tmpfiles.org (1-hour expiry, very reliable) ---
            const formData = new FormData();
            formData.append('file', new Blob([req.body], { type: contentType }), filename);

            const tmpRes = await fetch('https://tmpfiles.org/api/v1/upload', {
                method: 'POST',
                body: formData,
                headers: {
                    'User-Agent': 'PROPlus/1.0 (https://github.com/proplus)'
                }
            });

            if (!tmpRes.ok) {
                const errText = await tmpRes.text();
                console.error('[Voice Upload] tmpfiles.org error:', tmpRes.status, errText);
                return res.json({ success: false, message: `Both file hosts failed. Last error: tmpfiles ${tmpRes.status} ${errText}` });
            }

            const tmpData = await tmpRes.json();
            if (tmpData.status !== 'success' || !tmpData.data || !tmpData.data.url) {
                return res.json({ success: false, message: 'tmpfiles.org did not return a URL' });
            }

            // tmpfiles.org returns a viewer URL like https://tmpfiles.org/<id>/<filename>
            // We need to fetch that page and extract the actual direct download URL
            // from the <a class="download" href="..."> tag.
            const viewerUrl = tmpData.data.url;
            console.log('[Voice Upload] tmpfiles.org viewer URL:', viewerUrl);

            const viewerRes = await fetch(viewerUrl, {
                headers: { 'User-Agent': 'PROPlus/1.0 (https://github.com/proplus)' }
            });
            const html = await viewerRes.text();

            // Extract direct download URL
            const match = html.match(/<a[^>]*class="download"[^>]*href="([^"]+)"/i);
            if (match && match[1]) {
                const directUrl = match[1];
                console.log('[Voice Upload] tmpfiles.org direct URL:', directUrl);
                return res.json({ success: true, url: directUrl, host: 'tmpfiles', expires: '1 hour' });
            }

            // Fallback: try the simple /dl/<id>/<filename> pattern (won't be a direct file
            // but at least accessible). Lavalink might still be able to follow it.
            const simpleDirect = viewerUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
            console.log('[Voice Upload] Could not extract direct URL, returning simple pattern:', simpleDirect);
            return res.json({ success: true, url: simpleDirect, host: 'tmpfiles', expires: '1 hour', warning: 'Direct URL extraction failed' });
        } catch (e) {
            console.error('[Voice Upload] Error:', e);
            return res.json({ success: false, message: e.message });
        }
    });

    // --- SERVER CLONER ROUTES ---

    // In-memory state for Cloner
    const clonerState = {
        instance: null,
        isRunning: false,
        logs: [],
        sourceId: '',
        targetId: '',
        stats: {}
    };

    app.get('/server-cloner', (req, res) => {
        if (!client.user) return res.send(LOADING_PAGE('Server Cloner'));
        res.render('server-cloner', {
            user: client.user,
            page: 'cloner'
        });
    });

    app.get('/api/cloner/status', (req, res) => {
        res.json({
            isRunning: clonerState.isRunning,
            logs: clonerState.logs,
            stats: clonerState.stats
        });
    });

    app.post('/api/cloner/fetch', async (req, res) => {
        const { guildId } = req.body;
        try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return res.json({ success: false, message: 'Guild not found (Bot must be a member)' });

            const member = await guild.members.fetch(client.user.id).catch(() => null);
            const isAdmin = member ? member.permissions.has('ADMINISTRATOR') : false;

            res.json({
                success: true,
                name: guild.name,
                icon: guild.iconURL({ dynamic: true, size: 128 }),
                isAdmin: isAdmin,
                isOwner: guild.ownerId === client.user.id
            });
        } catch (e) { res.json({ success: false, message: e.message }); }
    });

    app.post('/api/cloner/start', async (req, res) => {
        if (clonerState.isRunning) return res.json({ success: false, message: 'Already running' });

        const { sourceId, targetId, options } = req.body;

        clonerState.isRunning = true;
        clonerState.logs = [];
        clonerState.stats = {};
        clonerState.sourceId = sourceId;
        clonerState.targetId = targetId;

        clonerState.logs.push(`[${new Date().toLocaleTimeString()}] Request received. Initializing...`);

        const ServerCloner = require('../cloner/ServerCloner');
        const cloner = new ServerCloner(client, (msg) => {
            clonerState.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
            if (clonerState.logs.length > 500) clonerState.logs.shift();
        });

        clonerState.instance = cloner;

        // Run in background
        cloner.cloneServer(sourceId, targetId, options)
            .then(stats => {
                clonerState.stats = stats;
                clonerState.isRunning = false;
                clonerState.instance = null;
                clonerState.logs.push(`[${new Date().toLocaleTimeString()}] Process completed successfully.`);
            })
            .catch(err => {
                clonerState.isRunning = false;
                clonerState.instance = null;
                // If stopped manually, we might have already logged "stopped by user" in cloner, but let's be safe
                if (err.message !== 'Cloning stopped by user.') { // Assuming standard error if any
                    clonerState.logs.push(`[${new Date().toLocaleTimeString()}] Error: ${err.message}`);
                }
            });

        res.json({ success: true });
    });

    app.post('/api/cloner/stop', (req, res) => {
        if (clonerState.instance) {
            clonerState.instance.stop();
            // Logging is handled inside Cloner stop() -> log()
            res.json({ success: true, message: 'Stop signal sent.' });
        } else {
            res.json({ success: false, message: 'No active process' });
        }
    });

    // ============================
    // --- SPAMMER & DM PURGE ---
    // ============================
    // In-memory state for Spammer
    const spammerState = {
        isRunning: false,
        mode: null,        // 'message' or 'call'
        victimId: null,
        count: 0,
        completed: 0,
        failed: 0,
        delayMs: 0,
        startedAt: 0,
        message: '',
        intervalId: null,
        logs: [],
        stopRequested: false
    };

    function logSpammer(msg) {
        const time = new Date().toLocaleTimeString();
        const line = `[${time}] ${msg}`;
        spammerState.logs.push(line);
        if (spammerState.logs.length > 500) spammerState.logs.shift();
        console.log(`[Spammer] ${msg}`);
    }

    function resetSpammerState() {
        if (spammerState.intervalId) {
            clearInterval(spammerState.intervalId);
            spammerState.intervalId = null;
        }
        spammerState.isRunning = false;
        spammerState.mode = null;
        spammerState.victimId = null;
        spammerState.count = 0;
        spammerState.completed = 0;
        spammerState.failed = 0;
        spammerState.delayMs = 0;
        spammerState.startedAt = 0;
        spammerState.message = '';
        spammerState.intervalId = null;
        spammerState.stopRequested = false;
    }

    app.get('/api/spammer/status', (req, res) => {
        res.json({
            isRunning: spammerState.isRunning,
            mode: spammerState.mode,
            victimId: spammerState.victimId,
            count: spammerState.count,
            completed: spammerState.completed,
            failed: spammerState.failed,
            delayMs: spammerState.delayMs,
            startedAt: spammerState.startedAt,
            message: spammerState.message,
            stopRequested: spammerState.stopRequested,
            logs: spammerState.logs
        });
    });

    app.post('/api/spammer/start', async (req, res) => {
        const { mode, victimId, count, ms, sec, message } = req.body;

        // Validate inputs
        if (!mode || !['message', 'call', 'videocall'].includes(mode)) {
            return res.json({ success: false, message: 'Mode must be "message", "call", or "videocall"' });
        }
        if (!victimId || !/^\d{17,20}$/.test(String(victimId))) {
            return res.json({ success: false, message: 'Invalid victim user ID' });
        }
        const totalMs = (parseInt(ms) || 0) + (parseInt(sec) || 0) * 1000;
        if (totalMs < 0) {
            return res.json({ success: false, message: 'Time cannot be negative' });
        }
        const total = parseInt(count);
        if (isNaN(total) || total < 1) {
            return res.json({ success: false, message: 'Count must be a positive number' });
        }

        if (spammerState.isRunning) {
            return res.json({ success: false, message: 'Spammer is already running. Stop it first.' });
        }

        // Reset state and start
        resetSpammerState();
        spammerState.isRunning = true;
        spammerState.mode = mode;
        spammerState.victimId = String(victimId);
        spammerState.count = total;
        spammerState.delayMs = totalMs;
        spammerState.startedAt = Date.now();
        spammerState.message = (message || '').toString();

        logSpammer(`Started ${mode.toUpperCase()} spam — victim=${victimId}, count=${total}, delay=${totalMs}ms`);

        res.json({ success: true, message: 'Spammer started' });

        // Fetch victim once (for DM channel creation)
        let dmChannel = null;
        try {
            const user = await client.users.fetch(spammerState.victimId).catch(() => null);
            if (!user) {
                logSpammer(`Error: Cannot fetch victim user ${spammerState.victimId}`);
                resetSpammerState();
                return;
            }
            dmChannel = await user.createDM().catch(() => null);
            if (!dmChannel) {
                logSpammer(`Error: Cannot create DM channel with victim ${spammerState.victimId}`);
                resetSpammerState();
                return;
            }
        } catch (e) {
            logSpammer(`Init error: ${e.message}`);
            resetSpammerState();
            return;
        }

        let processed = 0;

        // Run a tight loop — for very small delays (e.g. 1ms), setInterval
        // is the most reliable approach. We let Discord rate-limit naturally
        // via the selfbot lib's internal queue.
        const tick = async () => {
            if (!spammerState.isRunning || spammerState.stopRequested) {
                if (spammerState.intervalId) {
                    clearInterval(spammerState.intervalId);
                    spammerState.intervalId = null;
                }
                logSpammer(`Stopped. Completed ${spammerState.completed}/${spammerState.count}, failed ${spammerState.failed}.`);
                resetSpammerState();
                return;
            }

            if (processed >= spammerState.count) {
                if (spammerState.intervalId) {
                    clearInterval(spammerState.intervalId);
                    spammerState.intervalId = null;
                }
                logSpammer(`Done. Completed ${spammerState.completed}/${spammerState.count}, failed ${spammerState.failed}.`);
                resetSpammerState();
                return;
            }

            processed++;
            try {
                if (spammerState.mode === 'message') {
                    // Send DM message
                    const content = spammerState.message || `Spam #${processed}`;
                    await dmChannel.send(content);
                    spammerState.completed++;
                    if (processed <= 5 || processed % 10 === 0) {
                        logSpammer(`Message ${processed}/${spammerState.count} sent`);
                    }
                } else if (spammerState.mode === 'call' || spammerState.mode === 'videocall') {
                    const isVideo = spammerState.mode === 'videocall';
                    const token = getClient().token;
                    const headers = {
                        Authorization: token,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
                    };
                    try {
                        // Ring the victim — POST to the DM channel's call endpoint
                        const ringRes = await fetch(`https://discord.com/api/v9/channels/${dmChannel.id}/call`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ recipients: [spammerState.victimId], video: isVideo })
                        });
                        // Immediately stop ringing — DELETE ends/cancels the call
                        await fetch(`https://discord.com/api/v9/channels/${dmChannel.id}/call`, {
                            method: 'DELETE',
                            headers
                        });
                        if (ringRes.ok || ringRes.status === 200 || ringRes.status === 204) {
                            spammerState.completed++;
                        } else {
                            const errBody = await ringRes.text().catch(() => '');
                            spammerState.failed++;
                            if (processed <= 3) logSpammer(`Call HTTP ${ringRes.status}: ${errBody.slice(0, 120)}`);
                        }
                        if (processed <= 5 || processed % 10 === 0) {
                            logSpammer(`${isVideo ? 'Video' : 'Voice'} call ${processed}/${spammerState.count}`);
                        }
                    } catch (callErr) {
                        spammerState.failed++;
                        if (processed <= 3) logSpammer(`Call error: ${callErr.message}`);
                    }
                }
            } catch (err) {
                spammerState.failed++;
                if (processed <= 3 || processed % 20 === 0) {
                    logSpammer(`Error on #${processed}: ${err.message}`);
                }
            }
        };

        // For 0ms or 1ms delays, use setInterval with delay 0 (which is ~4ms in practice).
        // For larger delays, use the actual delay.
        const intervalMs = Math.max(0, spammerState.delayMs);
        spammerState.intervalId = setInterval(tick, intervalMs);

        // Safety: also run immediately for first iteration when delay is very small
        if (intervalMs <= 5) {
            tick();
        }
    });

    app.post('/api/spammer/stop', (req, res) => {
        if (!spammerState.isRunning) {
            return res.json({ success: false, message: 'Spammer is not running' });
        }
        spammerState.stopRequested = true;
        logSpammer('Stop requested by user.');
        res.json({ success: true, message: 'Stop requested.' });
    });

    app.post('/api/spammer/clear-logs', (req, res) => {
        spammerState.logs = [];
        res.json({ success: true });
    });

    // ============================
    // --- DM PURGE ---
    // ============================
    // Deletes YOUR OWN messages in the DM channel with a victim user.
    // count = -1 means "infinity" → deletes ALL your messages in that DM.
    const dmPurgeState = {
        isRunning: false,
        victimId: null,
        count: 0,
        deleted: 0,
        failed: 0,
        logs: [],
        stopRequested: false,
        mode: 'count'  // 'count' or 'all'
    };

    function logPurge(msg) {
        const time = new Date().toLocaleTimeString();
        const line = `[${time}] ${msg}`;
        dmPurgeState.logs.push(line);
        if (dmPurgeState.logs.length > 500) dmPurgeState.logs.shift();
        console.log(`[DM Purge] ${msg}`);
    }

    app.get('/api/spammer/purge/status', (req, res) => {
        res.json({
            isRunning: dmPurgeState.isRunning,
            victimId: dmPurgeState.victimId,
            count: dmPurgeState.count,
            deleted: dmPurgeState.deleted,
            failed: dmPurgeState.failed,
            mode: dmPurgeState.mode,
            stopRequested: dmPurgeState.stopRequested,
            logs: dmPurgeState.logs
        });
    });

    app.post('/api/spammer/purge/start', async (req, res) => {
        const { victimId, count } = req.body;

        if (!victimId || !/^\d{17,20}$/.test(String(victimId))) {
            return res.json({ success: false, message: 'Invalid victim user ID' });
        }

        const countNum = parseInt(count);
        if (isNaN(countNum)) {
            return res.json({ success: false, message: 'Count must be a number (-1 for infinity, or positive integer)' });
        }
        if (countNum === 0) {
            return res.json({ success: false, message: 'Count 0 does nothing. Use -1 for all messages or a positive number.' });
        }
        if (countNum < -1) {
            return res.json({ success: false, message: 'Count must be -1 (infinity) or a positive number' });
        }

        if (dmPurgeState.isRunning) {
            return res.json({ success: false, message: 'A DM purge is already running. Stop it first.' });
        }

        // Reset
        dmPurgeState.isRunning = true;
        dmPurgeState.victimId = String(victimId);
        dmPurgeState.count = countNum;
        dmPurgeState.deleted = 0;
        dmPurgeState.failed = 0;
        dmPurgeState.stopRequested = false;
        dmPurgeState.mode = countNum === -1 ? 'all' : 'count';
        dmPurgeState.logs = [];

        const targetLabel = countNum === -1 ? 'ALL messages (infinity)' : `${countNum} messages`;
        logPurge(`Starting DM purge — victim=${victimId}, target=${targetLabel}`);

        res.json({ success: true, message: 'DM purge started' });

        // Run in background
        (async () => {
            try {
                const user = await client.users.fetch(dmPurgeState.victimId).catch(() => null);
                if (!user) {
                    logPurge(`Error: Cannot fetch victim user ${dmPurgeState.victimId}`);
                    dmPurgeState.isRunning = false;
                    return;
                }
                const dmCh = await user.createDM().catch(() => null);
                if (!dmCh) {
                    logPurge(`Error: Cannot open DM channel with ${dmPurgeState.victimId}`);
                    dmPurgeState.isRunning = false;
                    return;
                }

                const targetCount = dmPurgeState.count;
                const isInfinite = targetCount === -1;
                let totalToDelete = isInfinite ? Infinity : targetCount;
                let lastMessageId = null;
                let consecutiveEmpty = 0;

                while (dmPurgeState.isRunning && !dmPurgeState.stopRequested && dmPurgeState.deleted < totalToDelete) {
                    try {
                        const fetchOpts = { limit: 100 };
                        if (lastMessageId) fetchOpts.before = lastMessageId;
                        const messages = await dmCh.messages.fetch(fetchOpts);

                        if (messages.size === 0) {
                            consecutiveEmpty++;
                            if (consecutiveEmpty >= 2 || isInfinite) {
                                logPurge('No more messages to fetch.');
                                break;
                            }
                            continue;
                        }
                        consecutiveEmpty = 0;

                        // Filter to messages authored by us
                        const myMessages = messages.filter(m => m.author && m.author.id === client.user.id);

                        if (myMessages.size === 0) {
                            // No own messages in this batch — keep paginating
                            lastMessageId = messages.last().id;
                            continue;
                        }

                        for (const [, msg] of myMessages) {
                            if (dmPurgeState.stopRequested) break;
                            if (!isInfinite && dmPurgeState.deleted >= targetCount) break;

                            try {
                                await msg.delete();
                                dmPurgeState.deleted++;
                                if (dmPurgeState.deleted <= 5 || dmPurgeState.deleted % 25 === 0) {
                                    logPurge(`Deleted ${dmPurgeState.deleted}${isInfinite ? '' : '/' + targetCount}`);
                                }
                                // Discord rate limit safety — 600ms between deletes
                                await new Promise(r => setTimeout(r, 600));
                            } catch (delErr) {
                                dmPurgeState.failed++;
                                if (dmPurgeState.failed <= 3) logPurge(`Delete error: ${delErr.message}`);
                                await new Promise(r => setTimeout(r, 1000));
                            }
                        }

                        // Update lastMessageId for pagination
                        lastMessageId = messages.last().id;

                        // If not infinite and we hit target, break
                        if (!isInfinite && dmPurgeState.deleted >= targetCount) break;
                    } catch (fetchErr) {
                        logPurge(`Fetch error: ${fetchErr.message}`);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                logPurge(`Purge complete. Deleted ${dmPurgeState.deleted}, failed ${dmPurgeState.failed}.`);
            } catch (e) {
                logPurge(`Fatal error: ${e.message}`);
            } finally {
                dmPurgeState.isRunning = false;
            }
        })();
    });

    app.post('/api/spammer/purge/stop', (req, res) => {
        if (!dmPurgeState.isRunning) {
            return res.json({ success: false, message: 'No DM purge running' });
        }
        dmPurgeState.stopRequested = true;
        logPurge('Stop requested by user.');
        res.json({ success: true, message: 'Stop requested.' });
    });

    app.post('/api/spammer/purge/clear-logs', (req, res) => {
        dmPurgeState.logs = [];
        res.json({ success: true });
    });

    // --- EXTRA FEATURES API ---
    const EF_FILE = path.join(__dirname, '..', 'data', 'extra_features.json');
    function loadEF() { try { if (fs.existsSync(EF_FILE)) return JSON.parse(fs.readFileSync(EF_FILE, 'utf8')); } catch {} return {}; }
    function saveEF(d) { try { fs.writeFileSync(EF_FILE, JSON.stringify(d, null, 2)); } catch {} }

    app.get('/api/extra-features', (req, res) => res.json(loadEF()));


    app.post('/api/extra-features/stfu', (req, res) => {
        const { userId, action } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            action === 'on' ? big5.autodeleUsers.add(userId) : big5.autodeleUsers.delete(userId);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/arr', (req, res) => {
        const { userId, action } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            // arr uses channelId scope — dashboard enables globally by userId key
            const key = `${userId}-global`;
            action === 'on' ? big5.arrTasks.set(key, true) : big5.arrTasks.delete(key);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/mimic', (req, res) => {
        const { userId, action } = req.body;
        try {
            const big5 = require('../commands/big5');
            const cid = getClient().user?.id;
            if (!cid) return res.json({ success: false, error: 'Bot not ready' });
            action === 'on' ? big5.mimicUser.set(cid, userId) : big5.mimicUser.delete(cid);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/profile', async (req, res) => {
        const { type, value } = req.body;
        if (!value) return res.json({ success: false, error: 'value required' });
        const token = getClient().token;
        if (!token) return res.json({ success: false, error: 'Bot not ready' });
        const headers = { Authorization: token, 'Content-Type': 'application/json' };
        try {
            let body, endpoint = '/users/@me';
            if (type === 'pfp') {
                const r = await fetch(value); const buf = await r.arrayBuffer();
                const ct = r.headers.get('content-type') || 'image/png';
                body = { avatar: `data:${ct};base64,${Buffer.from(buf).toString('base64')}` };
            } else if (type === 'banner') {
                const r = await fetch(value); const buf = await r.arrayBuffer();
                const ct = r.headers.get('content-type') || 'image/png';
                body = { banner: `data:${ct};base64,${Buffer.from(buf).toString('base64')}` };
            } else if (type === 'name') {
                body = { global_name: value };
            } else if (type === 'bio') {
                endpoint = '/users/@me/profile'; body = { bio: value };
            } else return res.json({ success: false, error: 'Unknown type' });
            const r = await fetch(`https://discord.com/api/v9${endpoint}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
            res.json(r.ok ? { success: true } : { success: false, error: `Discord returned ${r.status}` });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/hypesquad', async (req, res) => {
        const { house } = req.body;
        const token = getClient().token;
        if (!token) return res.json({ success: false, error: 'Bot not ready' });
        const headers = { Authorization: token, 'Content-Type': 'application/json' };
        const houses = { bravery: 1, brilliance: 2, balance: 3 };
        try {
            if (house === 'off') {
                const r = await fetch('https://discord.com/api/v9/hypesquad/online', { method: 'DELETE', headers });
                return res.json(r.ok ? { success: true } : { success: false, error: `Discord returned ${r.status}` });
            }
            const id = houses[house];
            if (!id) return res.json({ success: false, error: 'Invalid house' });
            const r = await fetch('https://discord.com/api/v9/hypesquad/online', { method: 'POST', headers, body: JSON.stringify({ house_id: id }) });
            res.json(r.ok ? { success: true } : { success: false, error: `Discord returned ${r.status}` });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    // --- EXTRA FEATURES — EXTENDED BIG5 APIS ---

    // Toggle extended toggles: murder, kill, multilast, blackify, autobump, triggertyping, antiafk, pinginsult, pingreact, autoedit
    app.post('/api/extra-features/toggle', (req, res) => {
        const { key, value } = req.body;
        const allowed = ['agct','silentantigc','alw','snipe','pinginsult','pingreact','blackify','antiafk','triggertyping','autobump','autoedit'];
        if (!allowed.includes(key)) return res.json({ success: false, error: 'Unknown key' });
        const d = loadEF(); d[key] = !!value; saveEF(d);
        try {
            const big5 = require('../commands/big5');
            const cid = getClient().user?.id;
            if (cid) {
                if (key === 'agct') value ? big5.agctOn.add(cid) : big5.agctOn.delete(cid);
                if (key === 'silentantigc') value ? big5.silentAgctOn.add(cid) : big5.silentAgctOn.delete(cid);
                if (key === 'alw') value ? big5.alwOn.add(cid) : big5.alwOn.delete(cid);
                if (key === 'pinginsult') value ? big5.insultEnabled.add(cid) : big5.insultEnabled.delete(cid);
            }
        } catch {}
        res.json({ success: true });
    });

    app.post('/api/extra-features/ghostping', async (req, res) => {
        const { userId, count } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            res.json({ success: true, message: `Ghost ping queued for ${userId} x${count||1} — use .ghostping in Discord` });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/murder', (req, res) => {
        const { userId, action } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            const cid = getClient().user?.id;
            if (!cid) return res.json({ success: false, error: 'Bot not ready' });
            if (action === 'on') big5.murderRunning.set(cid, true);
            else big5.murderRunning.set(cid, false);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/kill', (req, res) => {
        const { action } = req.body;
        try {
            const big5 = require('../commands/big5');
            const cid = getClient().user?.id;
            if (!cid) return res.json({ success: false, error: 'Bot not ready' });
            if (action === 'on') big5.killLoops.set(cid, true);
            else big5.killLoops.set(cid, false);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/multilast', (req, res) => {
        const { action } = req.body;
        try {
            const big5 = require('../commands/big5');
            const cid = getClient().user?.id;
            if (!cid) return res.json({ success: false, error: 'Bot not ready' });
            if (action === 'on') big5.outlastRunning.set(cid, true);
            else big5.outlastRunning.set(cid, false);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/autoflood', (req, res) => {
        const { userId, message: msg, action } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            const key = `${userId}-global`;
            if (action === 'on' && msg) big5.autoFloodUsers.set(key, msg);
            else big5.autoFloodUsers.delete(key);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/dreact', (req, res) => {
        const { userId, emojis, action } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            if (action === 'on' && emojis) {
                const list = emojis.split(',').map(e => e.trim()).filter(Boolean);
                big5.dreactUsers.set(userId, { emojis: list, idx: 0 });
            } else big5.dreactUsers.delete(userId);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/autoreact', (req, res) => {
        const { userId, emoji, action } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            if (action === 'on' && emoji) big5.autoreactUsers.set(userId, emoji);
            else big5.autoreactUsers.delete(userId);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/blackify', (req, res) => {
        const { userId, action } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            big5.blackifyTasks.set(userId, action === 'on');
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/autonick', (req, res) => {
        const { userId, nick, action } = req.body;
        if (!userId) return res.json({ success: false, error: 'userId required' });
        try {
            const big5 = require('../commands/big5');
            if (action === 'on' && nick) big5.forcedNicks.set(userId, nick);
            else big5.forcedNicks.delete(userId);
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/status-rotator', (req, res) => {
        const { statuses, delay, action } = req.body;
        try {
            const big5 = require('../commands/big5');
            const cid = getClient().user?.id;
            if (!cid) return res.json({ success: false, error: 'Bot not ready' });
            if (action === 'off') {
                const sr = big5.statusRotators.get(cid);
                if (sr) { clearInterval(sr.timer); big5.statusRotators.delete(cid); }
                return res.json({ success: true });
            }
            if (!statuses) return res.json({ success: false, error: 'statuses required' });
            const list = statuses.split(',').map(s => s.trim()).filter(Boolean);
            if (!list.length) return res.json({ success: false, error: 'No statuses' });
            const token = getClient().token;
            if (big5.statusRotators.has(cid)) { clearInterval(big5.statusRotators.get(cid).timer); }
            let idx = 0;
            const tick = async () => {
                const text = list[idx % list.length]; idx++;
                try { await fetch('https://discord.com/api/v9/users/@me/settings', { method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_status: { text } }) }); } catch {}
            };
            tick();
            const timer = setInterval(tick, (delay || 8) * 1000);
            big5.statusRotators.set(cid, { timer, list, idx });
            res.json({ success: true });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/setstatus', async (req, res) => {
        const { status } = req.body;
        const token = getClient().token;
        if (!token) return res.json({ success: false, error: 'Bot not ready' });
        try {
            const r = await fetch('https://discord.com/api/v9/users/@me/settings', { method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
            res.json(r.ok ? { success: true } : { success: false, error: `Discord returned ${r.status}` });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/stealpfp', async (req, res) => {
        const { userId } = req.body;
        const token = getClient().token;
        if (!token || !userId) return res.json({ success: false, error: 'Missing params' });
        try {
            const userR = await fetch(`https://discord.com/api/v9/users/${userId}`, { headers: { Authorization: token } });
            const user = await userR.json();
            if (!user.avatar) return res.json({ success: false, error: 'No avatar' });
            const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=512`;
            const imgR = await fetch(avatarUrl);
            const buf = await imgR.arrayBuffer();
            const ct = imgR.headers.get('content-type') || 'image/png';
            const r = await fetch('https://discord.com/api/v9/users/@me', { method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: `data:${ct};base64,${Buffer.from(buf).toString('base64')}` }) });
            res.json(r.ok ? { success: true } : { success: false, error: `Discord returned ${r.status}` });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/pronouns', async (req, res) => {
        const { pronouns } = req.body;
        const token = getClient().token;
        if (!token) return res.json({ success: false, error: 'Bot not ready' });
        try {
            const r = await fetch('https://discord.com/api/v9/users/@me/profile', { method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ pronouns: pronouns || '' }) });
            res.json(r.ok ? { success: true } : { success: false, error: `Discord returned ${r.status}` });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/friend', async (req, res) => {
        const { userId, action } = req.body;
        const token = getClient().token;
        if (!token || !userId) return res.json({ success: false, error: 'Missing params' });
        try {
            let r;
            if (action === 'add') r = await fetch(`https://discord.com/api/v9/users/@me/relationships/${userId}`, { method: 'PUT', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            else r = await fetch(`https://discord.com/api/v9/users/@me/relationships/${userId}`, { method: 'DELETE', headers: { Authorization: token } });
            res.json(r.ok ? { success: true } : { success: false, error: `Discord returned ${r.status}` });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/block', async (req, res) => {
        const { userId, action } = req.body;
        const token = getClient().token;
        if (!token || !userId) return res.json({ success: false, error: 'Missing params' });
        try {
            let r;
            if (action === 'block') r = await fetch(`https://discord.com/api/v9/users/@me/relationships/${userId}`, { method: 'PUT', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 2 }) });
            else r = await fetch(`https://discord.com/api/v9/users/@me/relationships/${userId}`, { method: 'DELETE', headers: { Authorization: token } });
            res.json(r.ok ? { success: true } : { success: false, error: `Discord returned ${r.status}` });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    app.post('/api/extra-features/tokuser', async (req, res) => {
        const { token: tok } = req.body;
        if (!tok) return res.json({ success: false, error: 'token required' });
        try {
            const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: tok } });
            if (!r.ok) return res.json({ success: false, error: 'Invalid token' });
            const d = await r.json();
            res.json({ success: true, user: { username: d.username, id: d.id, email: d.email || 'N/A', nitro: d.premium_type ? 'Yes' : 'No', mfa: d.mfa_enabled ? 'Yes' : 'No', phone: d.phone || 'N/A', verified: d.verified ? 'Yes' : 'No' } });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    // ── Environment Change API ─────────────────────────────────────────────────
    app.post('/api/env/set', (req, res) => {
        const { key, value } = req.body;
        if (!key || value === undefined || value === null)
            return res.json({ success: false, error: 'key and value required' });

        // Whitelist of allowed env keys for safety
        const allowed = [
            'PREFIX','LAVALINK_WS','LAVALINK_REST','LAVALINK_PASSWORD',
            'CLIENT_NAME','AI_API','APP_USER','APP_PASS','PORT','PUBLIC_URL'
        ];
        if (!allowed.includes(key))
            return res.json({ success: false, error: `Key '${key}' is not allowed` });

        try {
            const envPath = path.join(__dirname, '..', '.env');
            let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
            const lines = content.split('\n');
            let found = false;
            const updated = lines.map(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith(key + '=') || trimmed === key) {
                    found = true;
                    return `${key}=${value}`;
                }
                return line;
            });
            if (!found) updated.push(`${key}=${value}`);
            fs.writeFileSync(envPath, updated.join('\n'));
            // Also update process.env so it takes partial effect without restart
            process.env[key] = value;
            res.json({ success: true, message: `${key} updated. Restart bot for full effect.` });
        } catch(e) {
            res.json({ success: false, error: e.message });
        }
    });

    app.listen(port, () => {
        console.log(`[Anti-Crash] Bot is ready on http://localhost:${port}/`);
    });
};
