const fs = require('fs');
const path = require('path');
const statusManager = require('./statusManager');

// Cache for external image proxies: url -> 'mp:external/...'
const imageCache = {};

// Resolve any image URL to a format RichPresence accepts
// - Discord CDN / media URLs: converted to mp: by the library automatically
// - External URLs: proxied via getExternal
// - Already mp:/asset IDs: passed through
async function resolveImage(client, url) {
    if (!url) return null;
    // Already a valid format (asset ID, mp:, spotify:, etc.)
    if (!url.startsWith('http')) return url;
    // Discord CDN — library handles these natively via RichPresenceAssets.parseImage
    if (url.includes('cdn.discordapp.com') || url.includes('media.discordapp.net')) return url;
    // External URL — proxy it
    return await getExternalImage(client, url);
}

async function getExternalImage(client, url) {
    if (!url) return null;
    if (imageCache[url]) return imageCache[url];
    try {
        const { RichPresence } = require('discord.js-selfbot-v13/src/structures/Presence');
        // Use the client's own application id or a known valid one
        const appId = client.user?.id || '363445589247131668';
        const res = await RichPresence.getExternal(client, appId, url);
        const proxy = res?.[0]?.external_asset_path ? `mp:${res[0].external_asset_path}` : null;
        if (proxy) imageCache[url] = proxy;
        return proxy;
    } catch (e) { return null; }
}



const BASE_DATA_DIR = path.join(__dirname, '..', 'data');

function getDataDir(accountIndex) {
    if (accountIndex == null || accountIndex === 0) return BASE_DATA_DIR;
    const d = path.join(BASE_DATA_DIR, `account_${accountIndex}`);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
}

function getRpcFile(accountIndex) {
    return path.join(getDataDir(accountIndex), 'rpc.json');
}

const defaultData = {
    enabled: false,
    type: 'PLAYING',
    name: 'PRO+',
    applicationId: '',
    details: '',
    state: '',
    largeImage: '',
    largeText: '',
    smallImage: '',
    smallText: '',
    button1Text: '',
    button2Text: '',
    button2Url: '',
    enableProgressBar: false,
    startTimestamp: 0,
    endTimestamp: 0,
    spoofEnabled: false,
    spoofType: 'none',
    gameSpoofing: false,
    selectedGame: 'none'
};

function loadData(accountIndex) {
    const RPC_FILE = getRpcFile(accountIndex);
    if (!fs.existsSync(RPC_FILE)) return defaultData;
    try {
        const loaded = JSON.parse(fs.readFileSync(RPC_FILE, 'utf8'));
        return { ...defaultData, ...loaded };
    } catch (e) { return defaultData; }
}

function saveData(data, accountIndex) {
    const RPC_FILE = getRpcFile(accountIndex);
    const startOffset = parseInt(data.startTimestamp);
    const endOffset = parseInt(data.endTimestamp);

    if (data.gameSpoofing) {
        const oldData = fs.existsSync(RPC_FILE) ? JSON.parse(fs.readFileSync(RPC_FILE, 'utf8')) : {};
        if (!oldData.gameSpoofing || oldData.selectedGame !== data.selectedGame || !oldData.epochGameTimestamp) {
            data.epochGameTimestamp = Date.now();
        } else {
            data.epochGameTimestamp = oldData.epochGameTimestamp;
        }
    }

    if (data.enableProgressBar && !isNaN(endOffset) && endOffset > 0) {
        const realStart = Date.now() - (isNaN(startOffset) ? 0 : startOffset);
        data.epochTimestamp = realStart;
        data.epochEndTimestamp = realStart + endOffset;
    } else {
        delete data.epochEndTimestamp;
        if (!isNaN(startOffset) && startOffset > 0) {
            data.epochTimestamp = Date.now() - startOffset;
        } else {
            delete data.epochTimestamp;
        }
    }

    fs.writeFileSync(RPC_FILE, JSON.stringify(data, null, 2));
}

async function setPresence(client, data) {
    if (!client.user) return;

    try {
        const activities = [];

        if (data.enabled) {
            // Build activity as plain object — avoids RichPresence constructor issues
            const act = {
                type: data.type || 'PLAYING',
                name: data.name || 'PRO+',
                application_id: data.applicationId && /^[0-9]{17,19}$/.test(data.applicationId) ? data.applicationId : client.user.id,
                assets: {},
                buttons: [],
                metadata: { button_urls: [] }
            };

            if (data.gameSpoofing) {
                const g = require('./rpcGames').find(x => x.id === data.selectedGame);
                act.type = 'PLAYING';
                act.name = g ? g.name : 'a game';
                act.details = undefined;
                act.state = undefined;
                if (g && /^[0-9]{17,19}$/.test(g.appId)) act.application_id = g.appId;
                act.timestamps = { start: data.epochGameTimestamp || Date.now() };
            } else {
                if (data.details) act.details = data.details;
                if (data.state) act.state = data.state;

                if (data.enableProgressBar && data.epochEndTimestamp > 0) {
                    act.timestamps = { start: data.epochTimestamp || Date.now(), end: data.epochEndTimestamp };
                } else if (data.epochTimestamp && data.epochTimestamp > 0) {
                    act.timestamps = { start: data.epochTimestamp };
                }

                if (data.largeImage) {
                    const img = await resolveImage(client, data.largeImage);
                    if (img) { act.assets.large_image = img; if (data.largeText) act.assets.large_text = data.largeText; }
                }
                if (data.smallImage) {
                    const img = await resolveImage(client, data.smallImage);
                    if (img) { act.assets.small_image = img; if (data.smallText) act.assets.small_text = data.smallText; }
                }

                const isUrl = u => u && (u.startsWith('http://') || u.startsWith('https://'));
                if (data.button1Text && isUrl(data.button1Url)) { act.buttons.push(data.button1Text); act.metadata.button_urls.push(data.button1Url); }
                if (data.button2Text && isUrl(data.button2Url)) { act.buttons.push(data.button2Text); act.metadata.button_urls.push(data.button2Url); }

                if (data.spoofEnabled) {
                    const a = require('./rpcApps').find(x => x.id === data.spoofType);
                    if (a && /^[0-9]{17,19}$/.test(a.appId)) {
                        act.application_id = a.appId;
                        if (a.platform) act.platform = a.platform;
                        if (a.type) act.type = a.type;
                    }
                }

                if ((data.type || '').toUpperCase() === 'STREAMING') act.url = 'https://twitch.tv/discord';
            }

            if (!act.buttons.length) { delete act.buttons; delete act.metadata; }
            if (!Object.keys(act.assets).length) delete act.assets;

            activities.push(act);
        }

        // Custom Status
        const statusData = statusManager.loadData(client.accountIndex);
        if (statusData.custom_status || statusData.emoji) {
            const cs = { type: 'CUSTOM', name: 'Custom Status', state: statusData.custom_status || ' ' };
            if (statusData.emoji) {
                const m = statusData.emoji.match(/<(a)?:(\w+):(\d+)>/);
                cs.emoji = m ? { name: m[2], id: m[3], animated: !!m[1] } : { name: statusData.emoji };
            }
            activities.push(cs);
        }

        await client.user.setPresence({ status: statusData.status || 'online', activities });

    } catch (e) {
        console.error('[RPC] Error setting presence:', e);
    }
}

module.exports = {
    loadData,
    saveData,
    setPresence,
    initialize: async (client) => {
        const data = loadData(client.accountIndex);
        await setPresence(client, data);
    }
};