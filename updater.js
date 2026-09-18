const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const REPO = 'lord754/ProPluss';
const REPO_URL = `https://github.com/${REPO}.git`;
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const STATE_FILE = path.join(__dirname, 'data', 'updater.json');
const TEMP_DIR = path.join(__dirname, '.temp');

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
const CURRENT_VERSION = '2.1s';
const CURRENT_CHANNEL = 'stable'; // stable | alpha | beta | dev

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
        commits = await getJson(`${API}/repos/${REPO}/commits?per_page=50`);
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

// ─── BACKUP (for revert support) ─────────────────────────────────────────────
function backupFiles(files) {
    try {
        const backed = {};
        const ALWAYS_BACKUP = ['index.js', 'updater.js', 'package.json', 'accountManager.js'];
        const allFiles = new Set([...files, ...ALWAYS_BACKUP]);
        for (const f of allFiles) {
            const src = path.join(__dirname, f);
            if (fs.existsSync(src) && !isProtected(f)) {
                backed[f] = fs.readFileSync(src).toString('base64');
            }
        }
        return backed;
    } catch { return {}; }
}

// ─── APPLY (full .temp clone strategy) ───────────────────────────────────────
// 1. git clone the repo into .temp at the target SHA
// 2. Walk every file in .temp (except protected): add/overwrite in main dir
// 3. Walk every local file not in .temp (except protected): delete it
// 4. Remove .temp
function cleanTemp() {
    try {
        if (fs.existsSync(TEMP_DIR)) {
            // Recursive delete — works on Node 14.14+
            fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        }
    } catch (e) { /* best-effort */ }
}

function walkDir(dir, base) {
    // Returns all file paths relative to base
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) {
            results.push(...walkDir(path.join(dir, e.name), rel));
        } else {
            results.push(rel);
        }
    }
    return results;
}

async function applyUpdate(sha, logs) {
    const log = msg => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    log(`Starting full-repo sync to commit ${sha.slice(0, 7)}...`);

    // ── 1. Clean any leftover .temp ───────────────────────────────────────────
    cleanTemp();
    log('Cloning repo into .temp (this may take a moment)...');

    // ── 2. Clone at the target commit ─────────────────────────────────────────
    try {
        // Shallow clone of the full repo then checkout the target sha
        execSync(`git clone --depth=1 --no-tags "${REPO_URL}" "${TEMP_DIR}"`, { timeout: 120000 });
        // If the target sha isn't HEAD, fetch it specifically and checkout
        try {
            execSync(`git -C "${TEMP_DIR}" fetch --depth=1 origin ${sha}`, { timeout: 60000 });
            execSync(`git -C "${TEMP_DIR}" checkout ${sha}`, { timeout: 30000 });
        } catch {
            // If fetch/checkout fails (sha is already HEAD or not reachable), proceed with cloned HEAD
        }
        log('Clone successful.');
    } catch (e) {
        cleanTemp();
        throw new Error(`Git clone failed: ${e.message}`);
    }

    // ── 3. Get actual HEAD sha from the cloned repo ───────────────────────────
    let actualSha = sha;
    try {
        actualSha = execSync(`git -C "${TEMP_DIR}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
        log(`Syncing to: ${actualSha.slice(0, 7)}`);
    } catch { /* use the provided sha */ }

    // ── 4. Walk .temp — collect all files to add/update ───────────────────────
    const SKIP_IN_TEMP = ['.git'];
    const tempFiles = walkDir(TEMP_DIR, '').filter(f => {
        const top = f.split('/')[0];
        return !SKIP_IN_TEMP.includes(top) && !isProtected(f);
    });
    log(`Remote tree: ${tempFiles.length} file(s) to sync.`);

    // ── 5. Build backup of files that will be touched ─────────────────────────
    const filesToChange = tempFiles.filter(f => !isProtected(f));
    const backup = backupFiles(filesToChange);

    // ── 6. Copy .temp → main (add + overwrite) ────────────────────────────────
    let updated = 0, skipped = 0, failed = 0;
    const total = tempFiles.length;
    let processed = 0;

    for (const relPath of tempFiles) {
        processed++;
        if (isProtected(relPath)) { log(`SKIP (protected): ${relPath}`); skipped++; }
        else {
            try {
                const src = path.join(TEMP_DIR, relPath);
                const dest = path.join(__dirname, relPath);
                const destDir = path.dirname(dest);
                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                fs.copyFileSync(src, dest);
                updated++;
            } catch (e) { log(`FAIL: ${relPath} — ${e.message}`); failed++; }
        }
        if (total > 0) {
            const pct = Math.round((processed / total) * 60); // first 60% = copy phase
            log(`[PROGRESS: ${pct}%]`);
        }
    }
    log(`Copy phase done. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);

    // ── 7. Delete local files NOT in .temp (i.e. deleted from repo) ──────────
    // Walk local dir, excluding .temp itself and data/ and protected files
    const LOCAL_SKIP = ['.temp', '.git', 'data', 'node_modules', '.npm', '.kiro'];
    const localFiles = walkDir(__dirname, '').filter(f => {
        const top = f.split('/')[0];
        return !LOCAL_SKIP.includes(top) && !isProtected(f);
    });
    const tempSet = new Set(tempFiles);
    let deleted = 0;
    const delTotal = localFiles.length;
    let delProcessed = 0;
    for (const relPath of localFiles) {
        delProcessed++;
        if (!tempSet.has(relPath) && !isProtected(relPath)) {
            try {
                fs.unlinkSync(path.join(__dirname, relPath));
                log(`DELETED: ${relPath}`);
                deleted++;
            } catch { /* file already gone */ }
        }
        if (delTotal > 0) {
            const pct = 60 + Math.round((delProcessed / delTotal) * 35); // 60-95%
            log(`[PROGRESS: ${pct}%]`);
        }
    }
    if (deleted > 0) log(`Cleanup: removed ${deleted} file(s) no longer in repo.`);

    // ── 8. Remove .temp ───────────────────────────────────────────────────────
    log('Cleaning up .temp...');
    cleanTemp();
    log('[PROGRESS: 100%]');
    log(`Done. Updated: ${updated}, Deleted: ${deleted}, Skipped: ${skipped}, Failed: ${failed}`);

    // ── 9. Persist state ──────────────────────────────────────────────────────
    const state = loadState();
    const prevSha = state.lastSha;

    // Try to read version from updated package.json in main dir
    let newVersion = state.installedVersion || CURRENT_VERSION;
    let newChannel = state.installedChannel || CURRENT_CHANNEL;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        if (pkg.version) newVersion = pkg.version;
    } catch { /* fallback */ }

    state.lastSha = actualSha;
    state.installedVersion = newVersion;
    state.installedChannel = newChannel;
    state.restartCount = 0;
    state.revertSha = prevSha;
    state.revertFiles = backup;
    state.lastUpdateFailed = failed > 0;
    state.dismissed = (state.dismissed || []).filter(s => s !== sha);
    state.deleted = (state.deleted || []).filter(s => s !== sha);
    state.history = [
        {
            sha: actualSha.slice(0, 7),
            fullSha: actualSha,
            message: `Full sync to ${actualSha.slice(0, 7)}`,
            date: new Date().toISOString(),
            version: newVersion,
            channel: newChannel,
            updated,
            skipped,
            failed
        },
        ...(state.history || [])
    ].slice(0, 10);
    saveState(state);
    return { updated, skipped, failed, deleted, history: state.history };
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
