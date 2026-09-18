'use strict';
const fs = require('fs');
const path = require('path');
const accountManager = require('../accountManager');

// ── Per-account data path ─────────────────────────────────────────────────────
// Each account (token) gets its own allowed.json inside data/account_N/
function getAllowedPath(accountIndex) {
    const dir = accountManager.getAccountDataDir(
        accountIndex !== undefined ? accountIndex : getActiveIndex()
    );
    return path.join(dir, 'allowed.json');
}

function getActiveIndex() {
    const { active } = accountManager.getAccounts();
    return active;
}

// ── Load / Save ───────────────────────────────────────────────────────────────
function loadData(accountIndex) {
    const filePath = getAllowedPath(accountIndex);
    try {
        if (!fs.existsSync(filePath)) {
            const defaultData = { enabled: true, allowedUsers: [] };
            fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 4));
            return defaultData;
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.allowedUsers)  data.allowedUsers = [];
        if (data.enabled === undefined) data.enabled = true;
        return data;
    } catch (e) {
        console.error('[AllowedManager] Error loading data:', e);
        return { enabled: true, allowedUsers: [] };
    }
}

function saveData(data, accountIndex) {
    const filePath = getAllowedPath(accountIndex);
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
    } catch (e) {
        console.error('[AllowedManager] Error saving data:', e);
    }
}

// ── Self-add: call this on client ready so the token owner is always allowed ──
function ensureSelfAllowed(userId, accountIndex) {
    const idx = accountIndex !== undefined ? accountIndex : getActiveIndex();
    const data = loadData(idx);
    if (!data.allowedUsers.includes(userId)) {
        data.allowedUsers.unshift(userId); // put self first
        saveData(data, idx);
        console.log(`[AllowedManager] Auto-added self (${userId}) to account ${idx} allowed list`);
    }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
function addAllowedUser(userId, accountIndex) {
    const idx = accountIndex !== undefined ? accountIndex : getActiveIndex();
    const data = loadData(idx);
    if (!data.allowedUsers.includes(userId)) {
        data.allowedUsers.push(userId);
        saveData(data, idx);
        return true;
    }
    return false;
}

function removeAllowedUser(userId, accountIndex) {
    const idx = accountIndex !== undefined ? accountIndex : getActiveIndex();
    const data = loadData(idx);
    if (data.allowedUsers.includes(userId)) {
        data.allowedUsers = data.allowedUsers.filter(id => id !== userId);
        saveData(data, idx);
        return true;
    }
    return false;
}

function isAllowed(userId, accountIndex) {
    const idx = accountIndex !== undefined ? accountIndex : getActiveIndex();
    const data = loadData(idx);
    // If feature is disabled, allow everyone (no restriction)
    if (!data.enabled) return true;
    return data.allowedUsers.includes(userId);
}

function setEnabled(enabled, accountIndex) {
    const idx = accountIndex !== undefined ? accountIndex : getActiveIndex();
    const data = loadData(idx);
    data.enabled = !!enabled;
    saveData(data, idx);
}

module.exports = {
    loadData,
    saveData,
    addAllowedUser,
    removeAllowedUser,
    isAllowed,
    setEnabled,
    ensureSelfAllowed,
    getActiveIndex,
};

// v2.2.1a
