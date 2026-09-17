const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'lord754/ProPluss';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const STATE_FILE = path.join(__dirname, 'data', 'updater.json');
const BACKUP_DIR = path.join(__dirname, 'data', 'updater_backup');

const PROTECTED = ['.env', 'tokens.env', 'data/', 'data\\'];

function isProtected(filePath) {
    const norm = filePath.replace(/\\/g, '/');
    return PROTECTED.some(p => norm === p || norm.startsWith(p.replace(/\\/g, '/')));
}

function loadState() {
    try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    return { lastSha: null, history: [], dismissed: [], restartCount: 0, revertSha: null, revertFiles: null };
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
    const commits = await getJson(`${API}/repos/${REPO}/commits?per_page=4`);
    const updates = commits.map(c => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
        isNew: state.lastSha !== c.sha,
        isDismissed: (state.dismissed || []).includes(c.sha)
    }));
    // hasUpdate = any commit newer than lastSha that isn't dismissed
    const hasUpdate = updates.some(u => u.isNew && !u.isDismissed);
    return { updates, hasUpdate, lastSha: state.lastSha, history: state.history || [], dismissed: state.dismissed || [], canRevert: !!state.revertSha, revertSha: state.revertSha };
}

// Backup files before applying so we can revert
function backupFiles(files) {
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const backed = {};
        for (const f of files) {
            const src = path.join(__dirname, f);
            if (fs.existsSync(src)) {
                const content = fs.readFileSync(src);
                backed[f] = content.toString('base64');
            }
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

    // Backup before applying
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
    state.lastSha = sha;
    state.restartCount = 0;
    state.revertSha = state.lastSha || null;
    state.revertFiles = backup;
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
            const dest = path.join(__dirname, filePath);
            fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
            log(`Restored: ${filePath}`);
            restored++;
        } catch (e) { log(`FAIL: ${filePath} — ${e.message}`); failed++; }
    }
    log(`Revert done. Restored: ${restored}, Failed: ${failed}`);
    state.revertSha = null;
    state.revertFiles = null;
    state.restartCount = 0;
    saveState(state);
    return { restored, failed };
}

function dismissUpdate(sha) {
    const state = loadState();
    if (!(state.dismissed || []).includes(sha)) {
        state.dismissed = [...(state.dismissed || []), sha];
        saveState(state);
    }
}

function undismissUpdate(sha) {
    const state = loadState();
    state.dismissed = (state.dismissed || []).filter(s => s !== sha);
    saveState(state);
}

// Call on every bot restart to track restart count — revert option gone after 2 restarts
function trackRestart() {
    const state = loadState();
    if (state.revertSha) {
        state.restartCount = (state.restartCount || 0) + 1;
        if (state.restartCount >= 2) {
            state.revertSha = null;
            state.revertFiles = null;
            state.restartCount = 0;
        }
        saveState(state);
    }
}

module.exports = { checkForUpdates, applyUpdate, revertUpdate, dismissUpdate, undismissUpdate, trackRestart, loadState };
