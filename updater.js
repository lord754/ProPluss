const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'ryxierindo/ProPlus';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const STATE_FILE = path.join(__dirname, 'data', 'updater.json');

// Files/dirs that must NEVER be overwritten
const PROTECTED = [
  '.env', 'tokens.env',
  'data/', 'data\\',
];

function isProtected(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  return PROTECTED.some(p => norm === p || norm.startsWith(p.replace(/\\/g, '/')));
}

function loadState() {
  try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  return { lastSha: null, lastCheck: null, history: [] };
}

function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

function get(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'RoxyUpdater/1.0', 'Accept': 'application/vnd.github.v3+json' } };
    https.get(url, opts, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location).then(resolve).catch(reject);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: buf, text: buf.toString() });
      });
    }).on('error', reject);
  });
}

async function getJson(url) {
  const r = await get(url);
  if (r.status !== 200) throw new Error(`GitHub API ${r.status}: ${r.text.slice(0, 200)}`);
  return JSON.parse(r.text);
}

async function checkForUpdate() {
  const state = loadState();
  const commits = await getJson(`${API}/repos/${REPO}/commits?per_page=1`);
  const latest = commits[0];
  return {
    sha: latest.sha,
    shortSha: latest.sha.slice(0, 7),
    message: latest.commit.message.split('\n')[0],
    author: latest.commit.author.name,
    date: latest.commit.author.date,
    hasUpdate: state.lastSha !== latest.sha,
    lastSha: state.lastSha,
    lastCheck: new Date().toISOString(),
    history: state.history || []
  };
}

async function applyUpdate(sha, logs) {
  const log = msg => { logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`); };

  log(`Fetching commit ${sha.slice(0, 7)}...`);

  // Get list of files changed in this commit
  const commit = await getJson(`${API}/repos/${REPO}/commits/${sha}`);
  const files = commit.files || [];

  log(`${files.length} file(s) changed in this commit.`);

  let updated = 0, skipped = 0, failed = 0;

  for (const file of files) {
    const filePath = file.filename;

    if (isProtected(filePath)) {
      log(`SKIP (protected): ${filePath}`);
      skipped++;
      continue;
    }

    if (file.status === 'removed') {
      // Don't delete files automatically — too risky
      log(`SKIP (removed): ${filePath}`);
      skipped++;
      continue;
    }

    try {
      const rawUrl = `${RAW}/${REPO}/main/${filePath}`;
      const r = await get(rawUrl);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);

      const dest = path.join(__dirname, filePath);
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, r.body);
      log(`OK: ${filePath}`);
      updated++;
    } catch (e) {
      log(`FAIL: ${filePath} — ${e.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 100));
  }

  log(`Done. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);

  // Save state
  const state = loadState();
  state.lastSha = sha;
  state.lastCheck = new Date().toISOString();
  state.history = [
    { sha: sha.slice(0, 7), message: commit.commit.message.split('\n')[0], date: commit.commit.author.date, updated, skipped, failed },
    ...(state.history || [])
  ].slice(0, 10);
  saveState(state);

  return { updated, skipped, failed };
}

module.exports = { checkForUpdate, applyUpdate, loadState };
