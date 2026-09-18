const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, 'tokens.env');

function parseTokensFile() {
    if (!fs.existsSync(TOKENS_FILE)) {
        fs.writeFileSync(TOKENS_FILE, 'TOKEN=\nACTIVE_ACCOUNT=0\n');
    }
    const lines = fs.readFileSync(TOKENS_FILE, 'utf8').split('\n');
    const data = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        data[key] = val;
    }
    return data;
}

function writeTokensFile(data) {
    const lines = [];
    // Write ACTIVE_ACCOUNT first, then all TOKEN keys in order
    lines.push(`ACTIVE_ACCOUNT=${data.ACTIVE_ACCOUNT || 0}`);
    // Collect token keys sorted: TOKEN, TOKEN1, TOKEN2 ...
    const tokenKeys = Object.keys(data)
        .filter(k => k === 'TOKEN' || /^TOKEN\d+$/.test(k))
        .sort((a, b) => {
            const na = a === 'TOKEN' ? 0 : parseInt(a.replace('TOKEN', ''));
            const nb = b === 'TOKEN' ? 0 : parseInt(b.replace('TOKEN', ''));
            return na - nb;
        });
    for (const k of tokenKeys) {
        lines.push(`${k}=${data[k]}`);
    }
    fs.writeFileSync(TOKENS_FILE, lines.join('\n') + '\n');
}

function getAccounts() {
    const data = parseTokensFile();
    const accounts = [];
    const tokenKeys = Object.keys(data)
        .filter(k => k === 'TOKEN' || /^TOKEN\d+$/.test(k))
        .sort((a, b) => {
            const na = a === 'TOKEN' ? 0 : parseInt(a.replace('TOKEN', ''));
            const nb = b === 'TOKEN' ? 0 : parseInt(b.replace('TOKEN', ''));
            return na - nb;
        });
    for (const key of tokenKeys) {
        const index = key === 'TOKEN' ? 0 : parseInt(key.replace('TOKEN', ''));
        if (data[key] && data[key].trim()) accounts.push({ index, key, token: data[key].trim() });
    }
    let active = parseInt(data.ACTIVE_ACCOUNT || 0);
    // Auto-fallback: if active index has no token, switch to first available
    const activeExists = accounts.some(a => a.index === active);
    if (!activeExists && accounts.length > 0) {
        active = accounts[0].index;
        data.ACTIVE_ACCOUNT = active;
        writeTokensFile(data);
    }
    return { accounts, active };
}

function getActiveToken() {
    const { accounts, active } = getAccounts();
    const acc = accounts.find(a => a.index === active);
    return acc ? acc.token : (accounts[0] ? accounts[0].token : null);
}

function addAccount(token) {
    const data = parseTokensFile();
    // Check for duplicate token
    const tokenKeys = Object.keys(data).filter(k => k === 'TOKEN' || /^TOKEN\d+$/.test(k));
    for (const k of tokenKeys) {
        if (data[k] && data[k].trim() === token.trim()) {
            const idx = k === 'TOKEN' ? 0 : parseInt(k.replace('TOKEN', ''));
            return { duplicate: true, index: idx, key: k };
        }
    }
    // Find next available index
    const existing = tokenKeys.map(k => k === 'TOKEN' ? 0 : parseInt(k.replace('TOKEN', '')));
    let next = 0;
    while (existing.includes(next)) next++;
    const key = next === 0 ? 'TOKEN' : `TOKEN${next}`;
    data[key] = token;
    writeTokensFile(data);
    return next;
}

function deleteAccount(index) {
    const data = parseTokensFile();
    const key = index === 0 ? 'TOKEN' : `TOKEN${index}`;
    if (!data[key]) return false;
    delete data[key];
    // If deleted active, switch to first available
    if (parseInt(data.ACTIVE_ACCOUNT) === index) {
        const remaining = Object.keys(data)
            .filter(k => k === 'TOKEN' || /^TOKEN\d+$/.test(k))
            .map(k => k === 'TOKEN' ? 0 : parseInt(k.replace('TOKEN', '')))
            .sort((a, b) => a - b);
        data.ACTIVE_ACCOUNT = remaining.length > 0 ? remaining[0] : 0;
    }
    writeTokensFile(data);
    return true;
}

function switchAccount(index) {
    const data = parseTokensFile();
    const key = index === 0 ? 'TOKEN' : `TOKEN${index}`;
    if (!data[key]) return false;
    data.ACTIVE_ACCOUNT = index;
    writeTokensFile(data);
    return true;
}

// Returns the data directory for a given account index (isolated per account)
function getAccountDataDir(index) {
    const dir = path.join(__dirname, 'data', `account_${index}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

module.exports = { getAccounts, getActiveToken, addAccount, deleteAccount, switchAccount, getAccountDataDir };

// v2.2.1a
