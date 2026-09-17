const fs = require('fs');
const path = require('path');

const BASE_DATA_DIR = path.join(__dirname, '..', 'data');

function getStatusFile(accountIndex) {
    if (accountIndex == null || accountIndex === 0) return path.join(BASE_DATA_DIR, 'status.json');
    const d = path.join(BASE_DATA_DIR, `account_${accountIndex}`);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return path.join(d, 'status.json');
}

function getRotatorFile(accountIndex) {
    if (accountIndex == null || accountIndex === 0) return path.join(BASE_DATA_DIR, 'status_rotator.json');
    const d = path.join(BASE_DATA_DIR, `account_${accountIndex}`);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return path.join(d, 'status_rotator.json');
}

const defaultData = { status: 'online', custom_status: '', emoji: '' };

const defaultRotator = {
    enabled: false,
    intervalSeconds: 30,
    statuses: [] // [{ text, emoji, status }]
};

function loadData(accountIndex) {
    const STATUS_FILE = getStatusFile(accountIndex);
    if (!fs.existsSync(STATUS_FILE)) return defaultData;
    try {
        const loaded = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        return { ...defaultData, ...loaded };
    } catch (e) { return defaultData; }
}

function saveData(data, accountIndex) {
    const STATUS_FILE = getStatusFile(accountIndex);
    const existing = loadData(accountIndex);
    const newData = { ...existing, ...data };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(newData, null, 2));
}

function loadRotator(accountIndex) {
    const f = getRotatorFile(accountIndex);
    if (!fs.existsSync(f)) return defaultRotator;
    try { return { ...defaultRotator, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; }
    catch (e) { return defaultRotator; }
}

function saveRotator(data, accountIndex) {
    fs.writeFileSync(getRotatorFile(accountIndex), JSON.stringify(data, null, 2));
}

function parseEmoji(text) {
    if (!text) return null;
    const match = text.match(/<(a)?:(\w+):(\d+)>/);
    if (match) return { name: match[2], id: match[3], animated: !!match[1] };
    return { name: text, id: null, animated: false };
}

function getStatusActivity(data) {
    if (!data.custom_status && !data.emoji) return null;
    const activity = { type: 'CUSTOM', name: 'Custom Status', state: data.custom_status || ' ' };
    if (data.emoji) activity.emoji = parseEmoji(data.emoji);
    return activity;
}

// --- Rotator runtime ---
const rotatorTimers = new Map(); // accountIndex -> intervalId

function startRotator(client, accountIndex) {
    stopRotator(accountIndex);
    const rotator = loadRotator(accountIndex);
    if (!rotator.enabled || !rotator.statuses.length) return;

    let idx = 0;
    const rpcManager = require('./rpcManager');

    const tick = async () => {
        const entry = rotator.statuses[idx % rotator.statuses.length];
        idx++;
        saveData({ status: entry.status || 'online', custom_status: entry.text || '', emoji: entry.emoji || '' }, accountIndex);
        await rpcManager.setPresence(client, rpcManager.loadData(accountIndex));
    };

    tick(); // run immediately
    const id = setInterval(tick, (rotator.intervalSeconds || 30) * 1000);
    rotatorTimers.set(accountIndex ?? 0, id);
}

function stopRotator(accountIndex) {
    const key = accountIndex ?? 0;
    if (rotatorTimers.has(key)) {
        clearInterval(rotatorTimers.get(key));
        rotatorTimers.delete(key);
    }
}

function isRotatorRunning(accountIndex) {
    return rotatorTimers.has(accountIndex ?? 0);
}

module.exports = {
    loadData,
    saveData,
    loadRotator,
    saveRotator,
    getStatusActivity,
    startRotator,
    stopRotator,
    isRotatorRunning
};
