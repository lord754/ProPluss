const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'lord754/ProPluss';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const STATE_FILE = path.join(__dirname, 'data', 'updater.json');

// ─── VERSION ─────────────────────────────────────────────────────────────────
// Format: d.s.a.b
//   d = Dev     (position 0) — major dev builds
//   s = Stable  (position 1) — major stable releases
//   a = Alpha   (position 2) — minor; YOU choose which commits are alpha
//   b = Beta    (position 3) — minor; auto-detected from commit message / I choose
//
// Suffix letter appended to display version: 1.1s, 1.0.1a, 2.0b, 1.0.0.1d
// d is ONLY set when explicitly instructed — never auto-assigned
// s = auto-detected (stable commits, no special keyword)
// b = auto-detected (commit contains beta/preview/rc keywords)
// a = manually assigned (you tell me which commits are alpha)
const CURRENT_VERSION = '1.2.1a';
const CURRENT_CHANNEL = 'alpha'; // stable | alpha | beta | dev

// Channel letter → full name
const CHANNEL_NAMES  = { d: 'dev', s: 'stable', a: 'alpha', b: 'beta' };
const CHANNEL_LETTER = { dev: 'd', stable: 's', alpha: 'a', beta: 'b' };

// Parse a version string like "1.1s", "1.0.1a", "2.0b", "1.0.0.1d"
function parseVersion(raw) {
    if (!raw) return null;
    const str = String(raw).trim().toLowerCase();
    // Split trailing channel letter from numeric core
    const m = str.match(/^([\d.]+)([dsab])$/);
    let channel = 'stable', core = str;
    if (m) { core = m[1]; channel = CHANNEL_NAMES[m[2]] || 'stable'; }
    core = core.replace(/\.+$/, '');
    const parts = core.split('.').map(n => parseInt(n, 10) || 0);
    while (parts.length < 4) parts.push(0);
    // positions: [0]=d, [1]=s, [2]=a, [3]=b
    const [pd, ps, pa, pb] = parts;
    // Major = d or s position changed; Minor = a or b position changed
    const isMajor = pa === 0 && pb === 0;
    return { raw: String(raw), core, parts: parts.slice(0, 4), pd, ps, pa, pb, channel, isMajor };
}

// Auto-detect channel from commit message (never assigns 'd' — that's explicit only)
function autoDetectChannel(message) {
    const m = (message || '').toLowerCase();
    if (/\b(beta|preview|rc\d*|release candidate)\b/.test(m)) return 'beta';
    // alpha is never auto-detected — user assigns
    return 'stable';
}
// Compare two parsed versions: >0 means a is newer
function versionCompare(a, b) {
    if (!a || !b) return 0;
    for (let i = 0; i < 4; i++) {
        if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
    }
    // Channel order: dev > alpha > beta > stable (dev is cutting-edge)
    const order = { dev: 4, alpha: 3, beta: 2, stable: 1 };
    return (order[a.channel] || 1) - (order[b.channel] || 1);
}

function formatVersionDisplay(parsed) {
    if (!parsed) return CURRENT_VERSION;
    let s = parsed.parts.filter((v, i) => i === 0 || v > 0 || i < 2).join('.');
    s = s.replace(/(?:\.0)+$/, '') || '0';
    // Append single channel letter
    s += (CHANNEL_LETTER[parsed.channel] || 's');
    return s;
}

const CHANNEL_COLORS = { stable: '#2ecc71', beta: '#3498db', alpha: '#f39c12', dev: '#e74c3c' };
const CHANNEL_LABELS = { stable: 'Stable', beta: 'Beta', alpha: 'Alpha', dev: 'Dev' };

function extractVersionFromCommit(message) {
    if (!message) return null;
    // Look for patterns like v1.0, v1.0.1alpha, version:1.0, [1.0beta], (1.0.0.1dev)
    const patterns = [
        /\bv?(\d+\.\d+(?:\.\d+){0,2}(?:[a-z]+)?)\b/i,
        /version[:\s]+([^\s,\])\n]+)/i,
        /\[v?([^\]]+)\]/i,
    ];
    for (const p of patterns) {
        const m = message.match(p);
        if (m && m[1]) {
            const parsed = parseVersion(m[1]);
            if (parsed && parsed.parts[0] > 0) return parsed;
        }
    }
    return null;
}

function extractFeaturesFromCommit(message) {
    if (!message) return [];
    const features = [];
    const lines = message.split('\n');
    for (const line of lines.slice(1)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*') || trimmed.startsWith('+')) {
            features.push(trimmed.replace(/^[-•*+]\s*/, ''));
        }
    }
    return features.slice(0, 8);
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const PROTECTED = ['.env', 'tokens.env', 'data/', 'data\\'];

function isProtected(filePath) {
    const norm = filePath.replace(/\\/g, '/');
    return PROTECTED.some(p => norm === p || norm.startsWith(p.replace(/\\/g, '/')));
}

function loadState() {
    try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    return {
        lastSha: null,
        installedVersion: CURRENT_VERSION,
        installedChannel: CURRENT_CHANNEL,
        history: [],
        dismissed: [],
        deleted: [],
        restartCount: 0,
        revertSha: null,
        revertFiles: null,
        lastCheckTime: null,
        repoError: null
    };
}

function saveState(s) {
    try {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
    } catch {}
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
function get(url) {
    return new Promise((resolve, reject) => {
        const opts = { headers: { 'User-Agent': 'ProPlusUpdater/1.0', 'Accept': 'application/vnd.github.v3+json' } };
        https.get(url, opts, res => {
            if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location).then(resolve).catch(reject);
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, body: buf, text: buf.toString() }); });
        }).on('error', reject);
    });
}

async function getJson(url) {
    const r = await get(url);
    if (r.status !== 200) throw new Error(`GitHub API ${r.status}: ${r.text.slice(0, 200)}`);
    return JSON.parse(r.text);
}

// ─── STATUS DOT LOGIC ────────────────────────────────────────────────────────
// Returns: 'green' | 'red' | 'yellow'
// green  = up to date
// red    = update required OR revert required (damaged install)
// yellow = not checked in 24h OR repo issues OR other errors
function computeDotStatus(state, checkResult) {
    // Red: last update had failures — revert required
    if (state.lastUpdateFailed) return 'red';
    // Red: revert available (update was applied, revert window open)
    if (state.revertSha) return 'red';
    // If never checked, yellow
    if (!state.lastCheckTime) return 'yellow';
    // If last check was more than 24h ago, yellow
    const hoursSinceCheck = (Date.now() - state.lastCheckTime) / (1000 * 60 * 60);
    if (hoursSinceCheck > 24) return 'yellow';
    // If there was a repo error, yellow
    if (state.repoError) return 'yellow';
    if (!checkResult) return 'yellow';
    if (checkResult.error) return 'yellow';
    // Green: up to date
    if (checkResult.isUpToDate && !checkResult.hasUpdate) return 'green';
    // Red: updates available
    if (checkResult.hasUpdate) return 'red';
    // All dismissed → yellow
    if (!checkResult.isUpToDate && !checkResult.hasUpdate) return 'yellow';
    return 'yellow';
}

// ─── CHECK ────────────────────────────────────────────────────────────────────
async function checkForUpdates() {
    const state = loadState();
    const deleted = state.deleted || [];
    const dismissed = state.dismissed || [];

    let commits;
    try {
        commits = await getJson(`${API}/repos/${REPO}/commits?per_page=20`);
        state.repoError = null;
    } catch (e) {
        state.repoError = e.message;
        state.lastCheckTime = Date.now();
        saveState(state);
        throw e;
    }

    state.lastCheckTime = Date.now();
    saveState(state);

    const installedIdx = state.lastSha ? commits.findIndex(c => c.sha === state.lastSha) : -1;
    const newCommits = installedIdx === -1 ? commits : commits.slice(0, installedIdx);
    const available = newCommits.filter(c => !deleted.includes(c.sha));

    const updates = available.slice(0, 4).map((c, i) => {
        const msg = c.commit.message;
        const versionParsed = extractVersionFromCommit(msg);
        const features = extractFeaturesFromCommit(msg);
        // Use version's channel if parsed, else auto-detect from commit message
        const channel = (versionParsed && versionParsed.channel) || autoDetectChannel(msg);
        const updateType = versionParsed ? (versionParsed.isMajor ? 'Major' : 'Minor') : 'Patch';
        return {
            sha: c.sha,
            shortSha: c.sha.slice(0, 7),
            message: msg.split('\n')[0],
            fullMessage: msg,
            author: c.commit.author.name,
            date: c.commit.author.date,
            isDismissed: dismissed.includes(c.sha),
            isLatest: i === 0,
            version: versionParsed ? formatVersionDisplay(versionParsed) : null,
            channel,
            channelLabel: CHANNEL_LABELS[channel] || channel,
            channelColor: CHANNEL_COLORS[channel] || '#2ecc71',
            updateType,
            features,
            isMajor: versionParsed ? versionParsed.isMajor : false,
        };
    });

    const dismissedItems = available.filter(c => dismissed.includes(c.sha)).map(c => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date
    }));

    const hasUpdate = updates.some(u => !u.isDismissed);
    const isUpToDate = newCommits.length === 0;

    // Compute display version
    const installedVersion = state.installedVersion || CURRENT_VERSION;
    const installedChannel = state.installedChannel || CURRENT_CHANNEL;
    const installedVersionLabel = state.lastSha
        ? `${state.lastSha.slice(0, 7)} + ${installedVersion}`
        : installedVersion;

    const dotStatus = computeDotStatus(state, { hasUpdate, isUpToDate, error: null });

    return {
        updates,
        dismissedItems,
        hasUpdate,
        isUpToDate,
        lastSha: state.lastSha,
        installedShortSha: state.lastSha ? state.lastSha.slice(0, 7) : null,
        installedVersion,
        installedChannel,
        installedVersionLabel,
        history: state.history || [],
        canRevert: !!state.revertSha,
        dotStatus,
        lastCheckTime: state.lastCheckTime,
    };
}

// ─── APPLY ───────────────────────────────────────────────────────────────────
function backupFiles(files) {
    try {
        const backed = {};
        for (const f of files) {
            const src = path.join(__dirname, f);
            if (fs.existsSync(src)) backed[f] = fs.readFileSync(src).toString('base64');
        }
        return backed;
    } catch { return {}; }
}

async function applyUpdate(sha, logs) {
    const log = msg => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    log(`Fetching commit ${sha.slice(0, 7)}...`);

    const commit = await getJson(`${API}/repos/${REPO}/commits/${sha}`);
    let files = commit.files || [];
    log(`${files.length} file(s) in commit diff.`);

    // Merge commits often return 0 or limited files via the single-commit endpoint.
    // If we get 0 files, try fetching via the compare endpoint (parent..sha).
    if (files.length === 0 && commit.parents && commit.parents.length >= 1) {
        const parentSha = commit.parents[0].sha;
        log(`Merge commit detected — comparing ${parentSha.slice(0,7)}...${sha.slice(0,7)}`);
        try {
            const cmp = await getJson(`${API}/repos/${REPO}/compare/${parentSha}...${sha}`);
            files = cmp.files || [];
            log(`Compare returned ${files.length} file(s).`);
        } catch(e) {
            log(`Compare failed: ${e.message}`);
        }
    }

    // NEW: For apply old versions, get ALL files from the tree
    // This ensures missing files are downloaded
    let allTreeFiles = [];
    try {
        const tree = await getJson(`${API}/repos/${REPO}/git/trees/${sha}?recursive=1`);
        allTreeFiles = (tree.tree || [])
            .filter(item => item.type === 'blob' && !isProtected(item.path))
            .map(item => ({ filename: item.path, sha: item.sha, size: item.size }));
        log(`Commit tree contains ${allTreeFiles.length} files total.`);
    } catch (e) {
        log(`Could not fetch full tree: ${e.message}`);
    }

    // Merge diff files with missing files from tree
    const fileMap = new Map();
    files.forEach(f => fileMap.set(f.filename, f));
    allTreeFiles.forEach(f => {
        if (!fileMap.has(f.filename)) {
            const localPath = path.join(__dirname, f.filename);
            if (!fs.existsSync(localPath)) {
                fileMap.set(f.filename, { filename: f.filename, status: 'missing', sha: f.sha });
            }
        }
    });
    files = Array.from(fileMap.values());
    log(`Total files to process (diff + missing): ${files.length}`);

    if (files.length === 0) {
        log('No files to update in this commit.');
        // Still record state so it shows as installed
        const state = loadState();
        const commitMsg = commit.commit.message;
        const versionParsed = extractVersionFromCommit(commitMsg);
        const newVersion = versionParsed ? formatVersionDisplay(versionParsed).split(' ')[0] : (state.installedVersion || CURRENT_VERSION);
        const newChannel = versionParsed ? versionParsed.channel : (state.installedChannel || CURRENT_CHANNEL);
        state.lastSha = sha;
        state.installedVersion = newVersion;
        state.installedChannel = newChannel;
        state.dismissed = (state.dismissed || []).filter(s => s !== sha);
        state.deleted = (state.deleted || []).filter(s => s !== sha);
        state.history = [{ sha: sha.slice(0,7), fullSha: sha, message: commitMsg.split('\n')[0], date: commit.commit.author.date, version: newVersion, channel: newChannel, updated: 0, skipped: 0, failed: 0 }, ...(state.history || [])].slice(0, 10);
        saveState(state);
        return { updated: 0, skipped: 0, failed: 0, history: state.history };
    }

    const filesToChange = files.filter(f => !isProtected(f.filename) && f.status !== 'removed').map(f => f.filename);
    const backup = backupFiles(filesToChange);

    let updated = 0, skipped = 0, failed = 0;
    for (const file of files) {
        if (isProtected(file.filename)) { log(`SKIP (protected — ${file.filename}): this file is never overwritten`); skipped++; continue; }
        if (file.status === 'removed') { log(`SKIP (deleted in commit): ${file.filename}`); skipped++; continue; }
        try {
            const r = await get(`${RAW}/${REPO}/${sha}/${file.filename}`);
            if (r.status !== 200) throw new Error(`HTTP ${r.status} — file not found at commit ${sha.slice(0,7)}`);
            const dest = path.join(__dirname, file.filename);
            if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, r.body);
            log(`OK: ${file.filename}`);
            updated++;
        } catch (e) { log(`FAIL: ${file.filename} — ${e.message}`); failed++; }
        await new Promise(r => setTimeout(r, 80));
    }

    log(`Done. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);

    const state = loadState();
    const prevSha = state.lastSha;

    // Extract version from this commit
    const commitMsg = commit.commit.message;
    const versionParsed = extractVersionFromCommit(commitMsg);
    const newVersion = versionParsed ? formatVersionDisplay(versionParsed).split(' ')[0] : (state.installedVersion || CURRENT_VERSION);
    const newChannel = versionParsed ? versionParsed.channel : (state.installedChannel || CURRENT_CHANNEL);

    state.lastSha = sha;
    state.installedVersion = newVersion;
    state.installedChannel = newChannel;
    state.restartCount = 0;
    state.revertSha = prevSha;
    state.revertFiles = backup;
    // If failed > 0, mark as potentially damaged for red dot
    state.lastUpdateFailed = failed > 0;
    state.dismissed = (state.dismissed || []).filter(s => s !== sha);
    state.deleted = (state.deleted || []).filter(s => s !== sha);
    state.history = [
        {
            sha: sha.slice(0, 7),
            fullSha: sha,
            message: commitMsg.split('\n')[0],
            date: commit.commit.author.date,
            version: newVersion,
            channel: newChannel,
            updated,
            skipped,
            failed
        },
        ...(state.history || [])
    ].slice(0, 10);
    saveState(state);
    return { updated, skipped, failed, history: state.history };
}

// ─── REVERT ───────────────────────────────────────────────────────────────────
async function revertUpdate(logs) {
    const log = msg => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    const state = loadState();
    if (!state.revertFiles || Object.keys(state.revertFiles).length === 0) throw new Error('No backup available to revert');
    log('Reverting to previous version...');
    let restored = 0, failed = 0;
    for (const [filePath, b64] of Object.entries(state.revertFiles)) {
        try {
            fs.writeFileSync(path.join(__dirname, filePath), Buffer.from(b64, 'base64'));
            log(`Restored: ${filePath}`); restored++;
        } catch (e) { log(`FAIL: ${filePath} — ${e.message}`); failed++; }
    }
    log(`Revert done. Restored: ${restored}, Failed: ${failed}`);
    state.lastSha = state.revertSha;
    state.revertSha = null;
    state.revertFiles = null;
    state.restartCount = 0;
    state.lastUpdateFailed = false;
    saveState(state);
    return { restored, failed };
}

// ─── DISMISS / DELETE ────────────────────────────────────────────────────────
function dismissUpdate(sha) {
    const state = loadState();
    const dismissed = state.dismissed || [];
    if (!dismissed.includes(sha)) {
        state.dismissed = [...dismissed, sha];
        state.dismissedAt = state.dismissedAt || {};
        state.dismissedAt[sha] = Date.now();
        saveState(state);
    }
}

function undismissUpdate(sha) {
    const state = loadState();
    state.dismissed = (state.dismissed || []).filter(s => s !== sha);
    if (state.dismissedAt) delete state.dismissedAt[sha];
    saveState(state);
}

function deleteUpdate(sha) {
    const state = loadState();
    state.dismissed = (state.dismissed || []).filter(s => s !== sha);
    if (state.dismissedAt) delete state.dismissedAt[sha];
    state.deleted = [...new Set([...(state.deleted || []), sha])];
    saveState(state);
}

// ─── RESTART TRACKER ─────────────────────────────────────────────────────────
function trackRestart() {
    const state = loadState();
    const now = Date.now();

    if (state.revertSha) {
        state.restartCount = (state.restartCount || 0) + 1;
        if (state.restartCount >= 2) {
            state.revertSha = null;
            state.revertFiles = null;
            state.restartCount = 0;
            state.lastUpdateFailed = false;
        }
    }

    state.dismissedRestarts = state.dismissedRestarts || {};
    const toClean = [];
    for (const sha of (state.dismissed || [])) {
        const dismissedAt = (state.dismissedAt || {})[sha] || 0;
        const restarts = (state.dismissedRestarts[sha] || 0) + 1;
        state.dismissedRestarts[sha] = restarts;
        if (now - dismissedAt > 24 * 60 * 60 * 1000 || restarts >= 2) toClean.push(sha);
    }
    for (const sha of toClean) {
        state.dismissed = (state.dismissed || []).filter(s => s !== sha);
        if (state.dismissedAt) delete state.dismissedAt[sha];
        if (state.dismissedRestarts) delete state.dismissedRestarts[sha];
        state.deleted = [...new Set([...(state.deleted || []), sha])];
    }

    if ((state.deleted || []).length > 50) state.deleted = state.deleted.slice(-50);
    saveState(state);
}

// ─── DOT STATUS (for external polling) ───────────────────────────────────────
function getDotStatus() {
    const state = loadState();
    return computeDotStatus(state, null);
}

module.exports = {
    checkForUpdates,
    applyUpdate,
    revertUpdate,
    dismissUpdate,
    undismissUpdate,
    deleteUpdate,
    trackRestart,
    loadState,
    getDotStatus,
    parseVersion,
    formatVersionDisplay,
    CURRENT_VERSION,
    CURRENT_CHANNEL,
    CHANNEL_COLORS,
    CHANNEL_LABELS,
};
