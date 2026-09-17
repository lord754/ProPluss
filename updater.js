const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'lord754/ProPluss';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const STATE_FILE = path.join(__dirname, 'data', 'updater.json');

const PROTECTED = ['.env', 'tokens.env', 'data/', 'data\\'];

function isProtected(filePath) {
    const norm = filePath.replace(/\\/g, '/');
    return PROTECTED.some(p => norm === p || norm.startsWith(p.replace(/\\/g, '/')));
}

function loadState() {
    try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    return { lastSha: null, history: [], dismissed: [], deleted: [], restartCount: 0, revertSha: null, revertFiles: null };
}

function saveState(s) {
    try {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
    } catch {}
}

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

async function checkForUpdates() {
    const state = loadState();
    const deleted = state.deleted || [];
    const dismissed = state.dismissed || [];

    // Fetch enough commits to find up to 4 new ones after lastSha
    const commits = await getJson(`${API}/repos/${REPO}/commits?per_page=20`);

    // Find index of lastSha in the list
    const installedIdx = state.lastSha ? commits.findIndex(c => c.sha === state.lastSha) : -1;

    // Commits newer than installed (before installedIdx), or all if never installed
    const newCommits = installedIdx === -1 ? commits : commits.slice(0, installedIdx);

    // Filter out permanently deleted, keep dismissed visible in their own section
    const available = newCommits.filter(c => !deleted.includes(c.sha));

    // Up to 4 non-dismissed for main list
    const updates = available.slice(0, 4).map((c, i) => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
        isDismissed: dismissed.includes(c.sha),
        isLatest: i === 0
    }));

    // Dismissed items (not deleted) for dropdown
    const dismissedItems = available.filter(c => dismissed.includes(c.sha)).map(c => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date
    }));

    const hasUpdate = updates.some(u => !u.isDismissed);

    return {
        updates,
        dismissedItems,
        hasUpdate,
        isUpToDate: newCommits.length === 0,
        lastSha: state.lastSha,
        installedShortSha: state.lastSha ? state.lastSha.slice(0, 7) : null,
        history: state.history || [],
        canRevert: !!state.revertSha
    };
}

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
    const files = commit.files || [];
    log(`${files.length} file(s) changed.`);

    const filesToChange = files.filter(f => !isProtected(f.filename) && f.status !== 'removed').map(f => f.filename);
    const backup = backupFiles(filesToChange);

    let updated = 0, skipped = 0, failed = 0;
    for (const file of files) {
        if (isProtected(file.filename)) { log(`SKIP (protected): ${file.filename}`); skipped++; continue; }
        if (file.status === 'removed') { log(`SKIP (removed): ${file.filename}`); skipped++; continue; }
        try {
            const r = await get(`${RAW}/${REPO}/main/${file.filename}`);
            if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
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
    state.lastSha = sha;
    state.restartCount = 0;
    state.revertSha = prevSha;
    state.revertFiles = backup;
    // Remove from dismissed/deleted now that it's installed
    state.dismissed = (state.dismissed || []).filter(s => s !== sha);
    state.deleted = (state.deleted || []).filter(s => s !== sha);
    state.history = [
        { sha: sha.slice(0, 7), fullSha: sha, message: commit.commit.message.split('\n')[0], date: commit.commit.author.date, updated, skipped, failed },
        ...(state.history || [])
    ].slice(0, 10);
    saveState(state);
    return { updated, skipped, failed, history: state.history };
}

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
    // Restore lastSha to previous
    state.lastSha = state.revertSha;
    state.revertSha = null;
    state.revertFiles = null;
    state.restartCount = 0;
    saveState(state);
    return { restored, failed };
}

function dismissUpdate(sha) {
    const state = loadState();
    const dismissed = state.dismissed || [];
    if (!dismissed.includes(sha)) {
        // Store with timestamp for 24h cleanup
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
    // Remove from dismissed too
    state.dismissed = (state.dismissed || []).filter(s => s !== sha);
    if (state.dismissedAt) delete state.dismissedAt[sha];
    state.deleted = [...new Set([...(state.deleted || []), sha])];
    saveState(state);
}

// Called on every restart — cleans up dismissed after 24h or on 2nd restart, clears revert after 2 restarts
function trackRestart() {
    const state = loadState();
    const now = Date.now();

    // Revert window: gone after 2 restarts
    if (state.revertSha) {
        state.restartCount = (state.restartCount || 0) + 1;
        if (state.restartCount >= 2) {
            state.revertSha = null;
            state.revertFiles = null;
            state.restartCount = 0;
        }
    }

    // Dismissed cleanup: remove if older than 24h OR if this is the 2nd restart since dismiss
    // We track restartsSinceDismiss per sha
    state.dismissedRestarts = state.dismissedRestarts || {};
    const toClean = [];
    for (const sha of (state.dismissed || [])) {
        const dismissedAt = (state.dismissedAt || {})[sha] || 0;
        const restarts = (state.dismissedRestarts[sha] || 0) + 1;
        state.dismissedRestarts[sha] = restarts;
        // Clean if 24h passed OR 2nd restart
        if (now - dismissedAt > 24 * 60 * 60 * 1000 || restarts >= 2) {
            toClean.push(sha);
        }
    }
    for (const sha of toClean) {
        state.dismissed = (state.dismissed || []).filter(s => s !== sha);
        if (state.dismissedAt) delete state.dismissedAt[sha];
        if (state.dismissedRestarts) delete state.dismissedRestarts[sha];
        // Also add to deleted so it doesn't reappear
        state.deleted = [...new Set([...(state.deleted || []), sha])];
    }

    // If lastSha is installed, also clean deleted shas that are older than lastSha (already past)
    // Keep deleted list lean — max 50
    if ((state.deleted || []).length > 50) state.deleted = state.deleted.slice(-50);

    saveState(state);
}

module.exports = { checkForUpdates, applyUpdate, revertUpdate, dismissUpdate, undismissUpdate, deleteUpdate, trackRestart, loadState };
