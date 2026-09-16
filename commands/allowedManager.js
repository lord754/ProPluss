const fs = require('fs');
const path = require('path');

const ALLOWED_PATH = path.join(__dirname, '../data/allowed.json');

function loadData() {
    try {
        if (!fs.existsSync(ALLOWED_PATH)) {
            const dir = path.dirname(ALLOWED_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const defaultData = { allowedUsers: [] };
            fs.writeFileSync(ALLOWED_PATH, JSON.stringify(defaultData, null, 4));
            return defaultData;
        }
        const data = JSON.parse(fs.readFileSync(ALLOWED_PATH, 'utf8'));
        // Ensure structure
        if (!data.allowedUsers) data.allowedUsers = [];
        return data;
    } catch (e) {
        console.error('[Allowed Manager] Error loading data:', e);
        return { allowedUsers: [] };
    }
}

function saveData(data) {
    try {
        const dir = path.dirname(ALLOWED_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ALLOWED_PATH, JSON.stringify(data, null, 4));
    } catch (e) {
        console.error('[Allowed Manager] Error saving data:', e);
    }
}

function addAllowedUser(userId) {
    const data = loadData();
    if (!data.allowedUsers.includes(userId)) {
        data.allowedUsers.push(userId);
        saveData(data);
        return true;
    }
    return false;
}

function removeAllowedUser(userId) {
    const data = loadData();
    if (data.allowedUsers.includes(userId)) {
        data.allowedUsers = data.allowedUsers.filter(id => id !== userId);
        saveData(data);
        return true;
    }
    return false;
}

function isAllowed(userId) {
    const data = loadData();
    return data.allowedUsers.includes(userId);
}

module.exports = {
    loadData,
    saveData,
    addAllowedUser,
    removeAllowedUser,
    isAllowed
};
