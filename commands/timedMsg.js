const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const CONFIG_PATH = path.join(__dirname, '../data/timed_msg.json');

let activeJobs = new Map();

function loadData() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

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

async function executeMessage(client, item) {
    const jobId = item.id;
    try {
        console.log(`[Timed Msg] Executing ${jobId} for ${item.channelId}...`);

        let target;
        try {
            const channel = await client.channels.fetch(item.channelId).catch(() => null);
            if (channel && channel.isText()) target = channel;
            else {
                const user = await client.users.fetch(item.channelId).catch(() => null);
                if (user) target = user;
            }
        } catch (e) { }

        if (target) {
            await target.send(item.message);
            console.log(`[Timed Msg] SUCCESS: Sent to ${item.channelId}`);
        } else {
            console.warn(`[Timed Msg] FAILED: Target ${item.channelId} not found.`);
        }

        removeTimedMsg(jobId);

    } catch (e) {
        console.error(`[Timed Msg] Error executing ${jobId}:`, e.message);
    }
}

async function initialize(client) {
    console.log("[Timed Msg] Initializing...");
    const saved = loadData();
    const now = Date.now();
    let count = 0;


    for (const item of saved) {
        const targetTime = new Date(item.timestamp).getTime();

        if (targetTime <= now) {

            console.log(`[Timed Msg] Found missed message ${item.id}. Sending immediately...`);
            executeMessage(client, item);
        } else {

            scheduleMessage(client, item);
            count++;
        }
    }

    console.log(`[Timed Msg] Scheduled ${count} future messages.`);
}

function scheduleMessage(client, item) {
    const jobId = item.id;
    if (activeJobs.has(jobId)) {
        activeJobs.get(jobId).stop();
        activeJobs.delete(jobId);
    }

    const date = new Date(item.timestamp);

    const seconds = date.getSeconds();
    const minutes = date.getMinutes();
    const hours = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const cronPattern = `${seconds} ${minutes} ${hours} ${day} ${month} *`;

    try {
        const task = cron.schedule(cronPattern, () => executeMessage(client, item));
        activeJobs.set(jobId, task);
    } catch (e) {
        console.error(`[Timed Msg] Failed to schedule ${jobId}:`, e.message);
    }
}

function addTimedMsg(client, channelId, message, timestamp, timezone) {
    const list = loadData();
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2);

    const newItem = {
        id,
        channelId,
        message,
        timestamp, // ISO string
        timezone
    };

    list.push(newItem);
    saveData(list);

    // Schedule
    scheduleMessage(client, newItem);
    return newItem;
}

function removeTimedMsg(id) {
    const list = loadData();
    const newList = list.filter(x => x.id !== id);
    saveData(newList);

    if (activeJobs.has(id)) {
        activeJobs.get(id).stop();
        activeJobs.delete(id);
    }
}

function getList() {
    return loadData();
}

module.exports = { initialize, addTimedMsg, removeTimedMsg, getList };
