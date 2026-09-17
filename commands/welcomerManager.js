const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../data/welcomer.json');

function loadData() {
    if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, JSON.stringify({ welcomeSetups: {} }));
    }
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!data.welcomeSetups) {
        data.welcomeSetups = {};
        saveData(data);
    }
    return data;
}

function saveData(data) {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function addSetup(guildId, channelId, template, background, textcolor, welcomeType = 'card', textMessage, cardMessage) {
    const data = loadData();
    data.welcomeSetups[guildId] = { channelId, template, background, textcolor, welcomeType, textMessage, cardMessage };
    saveData(data);
}

function removeSetup(guildId) {
    const data = loadData();
    if (data.welcomeSetups[guildId]) {
        delete data.welcomeSetups[guildId];
        saveData(data);
    }
}

function getSetup(guildId) {
    const data = loadData();
    return data.welcomeSetups[guildId];
}

module.exports = { loadData, saveData, addSetup, removeSetup, getSetup };
