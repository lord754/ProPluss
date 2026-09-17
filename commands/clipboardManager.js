const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data', 'clipboard.json');

// Ensure data directory exists
const dataDir = path.dirname(dataPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function loadData() {
    if (!fs.existsSync(dataPath)) {
        return { triggers: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (e) {
        return { triggers: {} };
    }
}

function saveData(data) {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function addTrigger(trigger, response) {
    const data = loadData();
    data.triggers[trigger] = response;
    saveData(data);
}

function removeTrigger(trigger) {
    const data = loadData();
    if (data.triggers[trigger]) {
        delete data.triggers[trigger];
        saveData(data);
    }
}

function getResponse(trigger) {
    const data = loadData();
    return data.triggers[trigger] || null;
}

module.exports = {
    loadData,
    saveData,
    addTrigger,
    removeTrigger,
    getResponse
};
