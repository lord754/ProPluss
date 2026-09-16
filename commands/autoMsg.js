const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../data/auto_msg.json');

// Store active intervals: Map<channelId, IntervalID>
let activeTimers = new Map();

// Helper to calculate milliseconds
function getMilliseconds(val, unit) {
    val = parseInt(val);
    if (isNaN(val)) return null;
    switch (unit) {
        case 'second': return val * 1000;
        case 'minute': return val * 60 * 1000;
        case 'hour': return val * 60 * 60 * 1000;
        case 'day': return val * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

function loadData() {
    if (!fs.existsSync(CONFIG_PATH)) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify([], null, 4));
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveData(data) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 4));
}

async function initialize(client) {
    console.log("[Auto Msg] Initializing...");
    const saved = loadData();

    let count = 0;
    for (const item of saved) {
        try {
            await startTimer(client, item.channelId, item.message, item.interval, item.unit);
            count++;
        } catch (e) {
            console.error(`[Auto Msg] Failed to restore for channel ${item.channelId}:`, e.message);
        }
    }
    console.log(`[Auto Msg] Restored ${count} timers.`);
}

async function startTimer(client, channelId, messageContent, intervalVal, unit) {
    // Clear existing timer for this channel/user if any
    stopTimer(channelId);

    const ms = getMilliseconds(intervalVal, unit);
    if (!ms || ms < 1000) throw new Error("Invalid interval (Min 1 second)");

    let target;
    let targetType = 'channel';

    // Try Channel First
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            if (channel.guild) {
                if (!channel.permissionsFor(client.user).has('SEND_MESSAGES')) {
                    throw new Error("Missing SEND_MESSAGES permission in Channel");
                }
            }
            target = channel;
        }
    } catch (e) { }

    // Try User Second (if not channel)
    if (!target) {
        try {
            const user = await client.users.fetch(channelId).catch(() => null);
            if (user) {
                target = user; // Users have .send() method too
                targetType = 'user';
            }
        } catch (e) { }
    }

    if (!target) throw new Error("ID not found (Must be a valid Channel ID or User ID)");

    // Interval Function
    const timer = setInterval(async () => {
        try {
            await target.send(messageContent);
        } catch (e) {
            console.error(`[Auto Msg] Failed to send to ${targetType} ${channelId}:`, e.message);
        }
    }, ms);

    activeTimers.set(channelId, timer);
    return true;
}

function stopTimer(channelId) {
    if (activeTimers.has(channelId)) {
        clearInterval(activeTimers.get(channelId));
        activeTimers.delete(channelId);
    }
}

// API Methods
function addAutoMsg(channelId, message, interval, unit) {
    const list = loadData();
    // Check duplication? Allow update.
    const index = list.findIndex(x => x.channelId === channelId);

    if (index >= 0) {
        list[index] = { channelId, message, interval, unit };
    } else {
        list.push({ channelId, message, interval, unit });
    }

    saveData(list);
}

function removeAutoMsg(channelId) {
    const list = loadData();
    const newList = list.filter(x => x.channelId !== channelId);
    saveData(newList);
    stopTimer(channelId);
}

function getList() {
    return loadData();
}

module.exports = { initialize, startTimer, stopTimer, addAutoMsg, removeAutoMsg, getList };
