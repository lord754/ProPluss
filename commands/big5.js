'use strict';
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── fetch shim ────────────────────────────────────────────────────────────────
let _fetch;
try { _fetch = require('node-fetch'); } catch { _fetch = global.fetch; }
const doFetch = (...a) => Promise.resolve(_fetch(...a));

// ── helpers ───────────────────────────────────────────────────────────────────
function hdr(token) {
    return {
        Authorization: token,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    };
}
async function dPatch(token, p, body) {
    return doFetch(`https://discord.com/api/v9${p}`, { method: 'PATCH', headers: hdr(token), body: JSON.stringify(body) });
}
async function dGet(token, p) {
    return doFetch(`https://discord.com/api/v9${p}`, { headers: hdr(token) });
}
async function dPost(token, p, body) {
    return doFetch(`https://discord.com/api/v9${p}`, { method: 'POST', headers: hdr(token), body: JSON.stringify(body) });
}
async function dDelete(token, p) {
    return doFetch(`https://discord.com/api/v9${p}`, { method: 'DELETE', headers: hdr(token) });
}
async function urlToB64(url) {
    return new Promise((res, rej) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, r => {
            const c = []; r.on('data', d => c.push(d));
            r.on('end', () => res(`data:${r.headers['content-type'] || 'image/png'};base64,${Buffer.concat(c).toString('base64')}`));
            r.on('error', rej);
        }).on('error', rej);
    });
}
async function waifuSfw(tag) {
    try { const r = await doFetch(`https://api.waifu.pics/sfw/${tag}`); const d = await r.json(); return d?.url || null; } catch { return null; }
}
async function waifuNsfw(tag) {
    try { const r = await doFetch(`https://api.waifu.im/search/?included_tags=${tag}&is_nsfw=true`); const d = await r.json(); return d?.images?.[0]?.url || null; } catch { return null; }
}
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── persistent state ──────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, '..', 'data', 'big5_state.json');
function loadState() {
    try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    return {};
}
function saveState(s) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

// ── in-memory state ───────────────────────────────────────────────────────────
const sniped = new Map();          // channelId -> [{author,content,time}]
const agctOn = new Set();          // clientId
const silentAgctOn = new Set();    // clientId
const alwOn = new Set();           // clientId
const autoReplyTargets = new Map();// `uid-cid` -> true
const autoFloodUsers = new Map();  // `uid-scope` -> message
const dreactUsers = new Map();     // uid -> {emojis,idx}
const autoreactUsers = new Map();  // uid -> emoji
const ar1Targets = new Map();      // mention -> [replies]
const ar2Targets = new Map();      // mention -> [spaced]
const arrTasks = new Map();        // `uid-cid` -> true
const pingResponses = new Map();   // channelId -> response
const insultEnabled = new Set();   // clientId
const reactEnabled = new Map();    // clientId -> emoji
const autodeleUsers = new Set();   // uid
const afkWatchers = new Set();     // uid
const blackifyTasks = new Map();   // uid -> bool
const statusRotators = new Map();  // clientId -> {task,list,idx,delay}
const emojiRotators = new Map();   // clientId -> {task,list,idx,delay}
const mimicUser = new Map();       // clientId -> userId
const forcedNicks = new Map();     // uid -> nick
const outlastRunning = new Map();  // clientId -> bool
const murderRunning = new Map();   // clientId -> bool
const killLoops = new Map();       // clientId -> bool

// ── message lists ─────────────────────────────────────────────────────────────
const INSULTS = ['your a skid','stfu','your such a loser','fuck up boy','no.','why are you a bitch','nigga you stink','idk you','stop pinging me boy'];
const AUTOREPLIES = ['Elbow Sniffer','stfu fat bum','ur weak','frail bitch','shut the fuck up LOL','you suck faggot','Golf Ball Nose','Grease Stain','ur unwanted','com reject LOL','Dusty Termite','FAGGOT ASS PEDO','snapping turtle neck ass nigga','weak prostitute','stfu dork ass nigga','garbage ass slut','why am i so above u rn','soft ass nigga','frail slut','ur slow as fuck','you cant beat me'];
const LW_MSGS = ['LOL FAILED LAST WORD','nice failed last word, last word for me','nigga failed a last word LOL','last word for apophis'];
const BLACKIFYS = ['woah jamal dont pull out the nine','cotton picker 🧑‍🌾','back in my time...','worthless nigger! 🥷','chicken warrior 🍗','its just some watermelon chill 🍉','are you darkskined perchance?','you... STINK 🤢'];
const MURDER_MSGS = ['nb cares faggot','YOU SUCK\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nwtf\nyoure\nslow\nas\nfuck\nlmao\nSHUT\nTHE\nFUCK\nUP\nLMFAOO\nyou suck dogshit ass nigga','weak prostitute','stfu dork ass nigga','garbage ass slut','ur weak','soft ass nigga','frail slut','ur slow as fuck','you cant beat me','shut the fuck up LOL'];
const OUTLAST_MSGS = ['NIGGA UR FACING THE GODS AMROHA RUNS U\nNIGGA UR FACING THE GODS OF AMROHA RUNS U'];

module.exports = {
    name: 'big5',
    initialize,
    execute,
    // expose for big5_index
    sniped, agctOn, silentAgctOn, alwOn, autoReplyTargets, autoFloodUsers,
    dreactUsers, autoreactUsers, ar1Targets, ar2Targets, arrTasks,
    pingResponses, insultEnabled, reactEnabled, autodeleUsers, afkWatchers,
    blackifyTasks, statusRotators, emojiRotators, mimicUser, forcedNicks,
    outlastRunning, murderRunning, killLoops
};

// ── initialize (called on client ready) ───────────────────────────────────────
function initialize(client) {
    client.on('messageDelete', msg => {
        if (!msg.author || msg.author.bot) return;
        const list = sniped.get(msg.channel.id) || [];
        list.unshift({ author: msg.author.tag, content: msg.content || '*[no text]*', time: new Date().toLocaleTimeString() });
        if (list.length > 10) list.pop();
        sniped.set(msg.channel.id, list);
    });

    client.on('messageCreate', async msg => {
        if (!msg.author) return;
        const cid = client.user?.id;

        // anti-gc trap
        if (agctOn.has(cid) && msg.channel.type === 'GROUP_DM') {
            if (msg.system && msg.mentions?.users?.has(client.user.id)) {
                try { await msg.channel.leave(); } catch {}
                try { await doFetch(`https://discord.com/api/v9/users/@me/relationships/${msg.author.id}`, { method: 'PUT', headers: hdr(client.token), body: JSON.stringify({ type: 2 }) }); } catch {}
            }
        }

        // silent anti-gc trap
        if (silentAgctOn.has(cid) && msg.channel.type === 'GROUP_DM') {
            if (msg.system && msg.mentions?.users?.has(client.user.id)) {
                try { await doFetch(`https://discord.com/api/v9/channels/${msg.channel.id}?silent=true`, { method: 'DELETE', headers: hdr(client.token) }); } catch {}
                try { await doFetch(`https://discord.com/api/v9/users/@me/relationships/${msg.author.id}`, { method: 'PUT', headers: hdr(client.token), body: JSON.stringify({ type: 2 }) }); } catch {}
            }
        }

        // alw
        if (alwOn.has(cid) && msg.author.id !== client.user?.id) {
            if (['last word','lastword','lw','lst word'].some(t => msg.content?.toLowerCase().includes(t))) {
                try { await msg.reply(pick(LW_MSGS)); } catch {}
            }
        }

        // auto reply (arr)
        const arKey = `${msg.author.id}-${msg.channel.id}`;
        if (arrTasks.has(arKey) && msg.author.id !== client.user?.id) {
            try { await msg.channel.send(`${msg.author} ${pick(AUTOREPLIES)}`); } catch {}
        }

        // dreact
        if (dreactUsers.has(msg.author.id)) {
            const d = dreactUsers.get(msg.author.id);
            try { await msg.react(d.emojis[d.idx % d.emojis.length]); d.idx++; } catch {}
        }

        // autoreact
        if (autoreactUsers.has(msg.author.id)) {
            try { await msg.react(autoreactUsers.get(msg.author.id)); } catch {}
        }

        // auto flood
        const floodKey = msg.guild ? `${msg.author.id}-${msg.guild.id}` : `${msg.author.id}-${msg.channel.id}`;
        if (autoFloodUsers.has(floodKey)) {
            const fm = autoFloodUsers.get(floodKey);
            try { await msg.reply('\n'.repeat(1000) + fm); } catch {}
        }

        // auto delete
        if (autodeleUsers.has(msg.author.id)) {
            try { await msg.delete(); } catch {}
        }

        // ar1
        const mention = `<@${msg.author.id}>`;
        if (ar1Targets.has(mention)) {
            const list = ar1Targets.get(mention);
            if (list.length) { try { await msg.reply(list[0]); list.push(list.shift()); } catch {} }
        }

        // ar2
        if (ar2Targets.has(mention)) {
            const list = ar2Targets.get(mention);
            if (list.length) { try { await msg.reply(list[0]); list.push(list.shift()); } catch {} }
        }

        // ping response
        if (client.user && msg.mentions?.users?.has(client.user.id) && pingResponses.has(msg.channel.id)) {
            try { await msg.channel.send(pingResponses.get(msg.channel.id)); } catch {}
        }

        // ping insult
        if (insultEnabled.has(cid) && client.user && msg.mentions?.users?.has(client.user.id)) {
            try { await msg.channel.send(pick(INSULTS)); } catch {}
        }

        // ping react
        if (reactEnabled.has(cid) && client.user && msg.mentions?.users?.has(client.user.id)) {
            try { await msg.react(reactEnabled.get(cid)); } catch {}
        }

        // mimic
        if (mimicUser.has(cid) && msg.author.id === mimicUser.get(cid) && msg.author.id !== client.user?.id) {
            try { await msg.channel.send(msg.content); } catch {}
        }

        // forced nick
        if (forcedNicks.has(msg.author.id) && msg.guild) {
            const member = msg.guild.members.cache.get(msg.author.id);
            if (member && member.nickname !== forcedNicks.get(msg.author.id)) {
                try { await member.setNickname(forcedNicks.get(msg.author.id)); } catch {}
            }
        }

        // blackify
        if (blackifyTasks.get(msg.author.id)) {
            try { await msg.reply(pick(BLACKIFYS)); } catch {}
            for (const e of ['🍉','🍗','🤢','🥷','🔫']) { try { await msg.react(e); } catch {} }
        }
    });
}

// ── execute ───────────────────────────────────────────────────────────────────
async function execute(message, args, client) {
    const prefix = process.env.PREFIX || '!';
    const cmd = message.content.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase();
    const token = client.token;
    const cid = client.user?.id;

    // ── STATUS ROTATOR ────────────────────────────────────────────────────────
    if (cmd === 'rstatus') {
        const list = args.join(' ').split(',').map(s => s.trim()).filter(Boolean);
        if (!list.length) return message.reply('Usage: rstatus <status1, status2, ...>');
        try { await message.delete(); } catch {}
        if (statusRotators.has(cid)) { clearInterval(statusRotators.get(cid).timer); }
        let idx = 0;
        const tick = async () => {
            const text = list[idx % list.length]; idx++;
            try {
                await doFetch('https://discord.com/api/v9/users/@me/settings', {
                    method: 'PATCH', headers: hdr(token),
                    body: JSON.stringify({ custom_status: { text } })
                });
            } catch {}
        };
        await tick();
        const timer = setInterval(tick, 8000);
        statusRotators.set(cid, { timer, list, idx });
        await message.channel.send('```Status rotation started```');
    }

    else if (cmd === 'stopstatus') {
        if (statusRotators.has(cid)) { clearInterval(statusRotators.get(cid).timer); statusRotators.delete(cid); }
        try { await message.delete(); } catch {}
        await message.channel.send('```Status rotation stopped```');
    }

    // ── EMOJI ROTATOR ─────────────────────────────────────────────────────────
    else if (cmd === 'remoji') {
        const list = args.join(' ').split(',').map(s => s.trim()).filter(Boolean);
        if (!list.length) return message.reply('Usage: remoji <emoji1, emoji2, ...>');
        try { await message.delete(); } catch {}
        if (emojiRotators.has(cid)) { clearInterval(emojiRotators.get(cid).timer); }
        let idx = 0;
        const tick = async () => {
            const emoji_name = list[idx % list.length]; idx++;
            try {
                await doFetch('https://discord.com/api/v9/users/@me/settings', {
                    method: 'PATCH', headers: hdr(token),
                    body: JSON.stringify({ custom_status: { emoji_name } })
                });
            } catch {}
        };
        await tick();
        const timer = setInterval(tick, 8000);
        emojiRotators.set(cid, { timer, list, idx });
        await message.channel.send('```Emoji rotation started```');
    }

    else if (cmd === 'stopemoji') {
        if (emojiRotators.has(cid)) { clearInterval(emojiRotators.get(cid).timer); emojiRotators.delete(cid); }
        try { await message.delete(); } catch {}
        await message.channel.send('```Emoji rotation stopped```');
    }

    // ── STREAM STATUS ─────────────────────────────────────────────────────────
    else if (cmd === 'stream') {
        const statuses = args.join(' ').split(',').map(s => s.trim()).filter(Boolean);
        if (!statuses.length) return message.reply('Usage: stream <status1, status2, ...>');
        let idx = 0;
        const tick = async () => {
            try { await client.user.setPresence({ activities: [{ type: 'STREAMING', name: statuses[idx % statuses.length], url: 'https://twitch.tv/discord' }] }); idx++; } catch {}
        };
        await tick();
        const timer = setInterval(tick, 10000);
        statusRotators.set(cid + '_stream', { timer });
        await message.channel.send(`\`\`\`Stream status rotation started\`\`\``);
    }

    else if (cmd === 'streamoff') {
        const k = cid + '_stream';
        if (statusRotators.has(k)) { clearInterval(statusRotators.get(k).timer); statusRotators.delete(k); }
        try { await client.user.setPresence({ activities: [] }); } catch {}
        await message.channel.send('```Stream status stopped```');
    }

    // ── SETSTATUS ─────────────────────────────────────────────────────────────
    else if (cmd === 'setstatus') {
        const s = args[0]?.toLowerCase();
        const map = { online: 'online', dnd: 'dnd', idle: 'idle', invisible: 'invisible' };
        if (!map[s]) return message.reply('Usage: setstatus <online|dnd|idle|invisible>');
        try { await client.user.setStatus(map[s]); await message.reply(`\`\`\`Status set to ${s}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }

    // ── PLAYING / LISTENING / WATCHING ────────────────────────────────────────
    else if (cmd === 'playing') {
        const name = args.join(' '); if (!name) return message.reply('Usage: playing <name>');
        try { await client.user.setPresence({ activities: [{ type: 'PLAYING', name }] }); await message.reply(`\`\`\`Now playing: ${name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'listening') {
        const name = args.join(' '); if (!name) return message.reply('Usage: listening <name>');
        try { await client.user.setPresence({ activities: [{ type: 'LISTENING', name }] }); await message.reply(`\`\`\`Now listening: ${name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'watching') {
        const name = args.join(' '); if (!name) return message.reply('Usage: watching <name>');
        try { await client.user.setPresence({ activities: [{ type: 'WATCHING', name }] }); await message.reply(`\`\`\`Now watching: ${name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'stopactivity') {
        try { await client.user.setPresence({ activities: [], status: 'dnd' }); await message.reply('```Activity stopped```'); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }

    // ── PROFILE ───────────────────────────────────────────────────────────────
    else if (cmd === 'setpfp') {
        const url = args[0]; if (!url) return message.reply('Usage: setpfp <url>');
        try { const b64 = await urlToB64(url); const r = await dPatch(token, '/users/@me', { avatar: b64 }); await message.reply(r.ok ? '```PFP updated!```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'setbanner') {
        const url = args[0]; if (!url) return message.reply('Usage: setbanner <url>');
        try { const b64 = await urlToB64(url); const r = await dPatch(token, '/users/@me', { banner: b64 }); await message.reply(r.ok ? '```Banner updated!```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'stealpfp') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention a user.');
        try { const b64 = await urlToB64(user.displayAvatarURL({ format: user.avatar?.startsWith('a_') ? 'gif' : 'png', size: 512 })); const r = await dPatch(token, '/users/@me', { avatar: b64 }); await message.reply(r.ok ? `\`\`\`Stole ${user.username}'s pfp!\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'stealbanner') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention a user.');
        try {
            const res = await dGet(token, `/users/${user.id}/profile`); const p = await res.json();
            const bh = p?.user?.banner; if (!bh) return message.reply('```No banner.```');
            const b64 = await urlToB64(`https://cdn.discordapp.com/banners/${user.id}/${bh}.${bh.startsWith('a_') ? 'gif' : 'png'}?size=1024`);
            const r = await dPatch(token, '/users/@me', { banner: b64 }); await message.reply(r.ok ? `\`\`\`Stole ${user.username}'s banner!\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'setname') {
        const name = args.join(' '); if (!name) return message.reply('Usage: setname <name>');
        const r = await dPatch(token, '/users/@me', { global_name: name }); await message.reply(r.ok ? `\`\`\`Name set to: ${name}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``);
    }
    else if (cmd === 'setbio') {
        const bio = args.join(' '); if (!bio) return message.reply('Usage: setbio <text>');
        const r = await dPatch(token, '/users/@me/profile', { bio }); await message.reply(r.ok ? '```Bio updated!```' : `\`\`\`Failed: ${r.status}\`\`\``);
    }
    else if (cmd === 'stealbio') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention a user.');
        try { const res = await dGet(token, `/users/${user.id}/profile?with_mutual_guilds=true`); const d = await res.json(); const bio = d?.user?.bio; if (!bio) return message.reply('```No bio.```'); const r = await dPatch(token, '/users/@me/profile', { bio }); await message.reply(r.ok ? '```Bio stolen!```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'setpronoun') {
        const pronouns = args.join(' '); if (!pronouns) return message.reply('Usage: setpronoun <pronouns>');
        const r = await dPatch(token, '/users/@me/profile', { pronouns }); await message.reply(r.ok ? `\`\`\`Pronouns: ${pronouns}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``);
    }
    else if (cmd === 'stealpronoun') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention a user.');
        try { const res = await dGet(token, `/users/${user.id}/profile?with_mutual_guilds=true`); const d = await res.json(); const pronouns = d?.user_profile?.pronouns; if (!pronouns) return message.reply('```No pronouns.```'); const r = await dPatch(token, '/users/@me/profile', { pronouns }); await message.reply(r.ok ? '```Pronouns stolen!```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'copyprofile') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention a user.');
        try {
            const res = await dGet(token, `/users/${user.id}/profile`); const pd = await res.json();
            const b64 = await urlToB64(user.displayAvatarURL({ format: 'png', size: 512 }));
            await dPatch(token, '/users/@me', { avatar: b64, global_name: pd?.user?.global_name });
            await dPatch(token, '/users/@me/profile', { bio: pd?.bio || '', pronouns: pd?.pronouns || '' });
            await message.reply(`\`\`\`Copied ${user.username}'s profile!\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }

    // ── HYPESQUAD ─────────────────────────────────────────────────────────────
    else if (cmd === 'hypesquad') {
        const houses = { bravery: 1, brilliance: 2, balance: 3 };
        const h = args[0]?.toLowerCase();
        if (h === 'off') { const r = await dDelete(token, '/hypesquad/online'); return message.reply(r.ok ? '```HypeSquad removed```' : `\`\`\`Failed: ${r.status}\`\`\``); }
        const id = houses[h]; if (!id) return message.reply('Usage: hypesquad <bravery|brilliance|balance|off>');
        const r = await dPost(token, '/hypesquad/online', { house_id: id }); await message.reply(r.ok ? `\`\`\`HypeSquad: ${h}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``);
    }

    // ── TOKEN CHECKER ─────────────────────────────────────────────────────────
    else if (cmd === 'ct') {
        const [mode, tok] = args; if (!mode || !tok) return message.reply('Usage: ct <v|i> <token>');
        try {
            const r = await doFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: tok } });
            if (!r.ok) return message.reply('```Token: INVALID```');
            if (mode === 'v') return message.reply('```Token: VALID```');
            const d = await r.json();
            await message.reply(`\`\`\`Token: VALID\nUser: ${d.username}\nID: ${d.id}\nEmail: ${d.email || 'N/A'}\nNitro: ${d.premium_type ? 'Yes' : 'No'}\nMFA: ${d.mfa_enabled ? 'Yes' : 'No'}\nVerified: ${d.verified ? 'Yes' : 'No'}\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }

    // ── SNIPE ─────────────────────────────────────────────────────────────────
    else if (cmd === 'snipe') {
        try { await message.delete(); } catch {}
        const list = sniped.get(message.channel.id);
        if (!list?.length) return message.channel.send('-# No deleted messages to snipe.');
        await message.channel.send('**Last deleted messages:**\n' + list.map((m, i) => `${i + 1}. **${m.author}** [${m.time}]: ${m.content}`).join('\n'));
    }

    // ── ANTI-GC TRAP ──────────────────────────────────────────────────────────
    else if (cmd === 'agct') {
        const on = args[0]?.toLowerCase() === 'on';
        on ? agctOn.add(cid) : agctOn.delete(cid);
        await message.reply(`\`\`\`Anti-GC Trap: ${on ? 'ON' : 'OFF'}\`\`\``);
    }
    else if (cmd === 'silentantigc') {
        const on = args[0]?.toLowerCase() === 'on';
        on ? silentAgctOn.add(cid) : silentAgctOn.delete(cid);
        await message.reply(`\`\`\`Silent Anti-GC Trap: ${on ? 'ON' : 'OFF'}\`\`\``);
    }

    // ── ALW ───────────────────────────────────────────────────────────────────
    else if (cmd === 'alw') {
        const on = args[0]?.toLowerCase() === 'on';
        on ? alwOn.add(cid) : alwOn.delete(cid);
        await message.reply(`\`\`\`Auto Last Word: ${on ? 'ON' : 'OFF'}\`\`\``);
    }
    else if (cmd === 'wl') {
        const uid = args[0]; if (!uid) return message.reply('Usage: wl <user_id>');
        await message.reply(`\`\`\`User ${uid} whitelisted from ALW\`\`\``);
    }

    // ── AUTO REPLY ────────────────────────────────────────────────────────────
    else if (cmd === 'arr') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        arrTasks.set(`${user.id}-${message.channel.id}`, true);
        await message.reply(`\`\`\`Auto-replying to ${user.username}\`\`\``);
    }
    else if (cmd === 'arrend') {
        for (const k of arrTasks.keys()) if (k.endsWith(`-${message.channel.id}`)) arrTasks.delete(k);
        await message.reply('```Auto-reply stopped```');
    }
    else if (cmd === 'ar1') {
        const mention = args[0]; const replies = args.slice(1).join(' ').split(',').map(s => s.trim());
        if (!mention || !replies.length) return message.reply('Usage: ar1 <@user> <reply1, reply2, ...>');
        ar1Targets.set(mention, replies);
        await message.reply(`\`\`\`AR1 set for ${mention}\`\`\``);
    }
    else if (cmd === 'ar1e') { ar1Targets.clear(); await message.reply('```AR1 cleared```'); }
    else if (cmd === 'ar2') {
        const mention = args[0]; const replies = args.slice(1).join(' ').split(',').map(s => s.trim().split(' ').join('\n'));
        if (!mention || !replies.length) return message.reply('Usage: ar2 <@user> <reply1, reply2, ...>');
        ar2Targets.set(mention, replies);
        await message.reply(`\`\`\`AR2 set for ${mention}\`\`\``);
    }
    else if (cmd === 'ar2e') { ar2Targets.clear(); await message.reply('```AR2 cleared```'); }

    // ── DREACT ────────────────────────────────────────────────────────────────
    else if (cmd === 'dreact') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        const emojis = args.slice(1); if (!emojis.length) return message.reply('Provide emojis.');
        dreactUsers.set(user.id, { emojis, idx: 0 });
        await message.reply(`\`\`\`Dreact ON for ${user.username}\`\`\``);
    }
    else if (cmd === 'dreactoff') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        dreactUsers.delete(user.id);
        await message.reply(`\`\`\`Dreact OFF for ${user.username}\`\`\``);
    }

    // ── AUTOREACT ─────────────────────────────────────────────────────────────
    else if (cmd === 'autoreact') {
        const user = message.mentions.users.first(); const emoji = args[1];
        if (!user || !emoji) return message.reply('Usage: autoreact <@user> <emoji>');
        autoreactUsers.set(user.id, emoji);
        await message.reply(`\`\`\`Autoreact ON for ${user.username}: ${emoji}\`\`\``);
    }
    else if (cmd === 'autoreactoff') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        autoreactUsers.delete(user.id);
        await message.reply(`\`\`\`Autoreact OFF for ${user.username}\`\`\``);
    }

    // ── AUTO FLOOD ────────────────────────────────────────────────────────────
    else if (cmd === 'autoflood') {
        const user = message.mentions.users.first(); const msg2 = args.slice(1).join(' ');
        if (!user || !msg2) return message.reply('Usage: autoflood <@user> <message>');
        const scope = message.guild ? message.guild.id : message.channel.id;
        autoFloodUsers.set(`${user.id}-${scope}`, msg2);
        try { await message.delete(); } catch {}
    }
    else if (cmd === 'stopautoflood') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        const scope = message.guild ? message.guild.id : message.channel.id;
        autoFloodUsers.delete(`${user.id}-${scope}`);
        await message.reply(`\`\`\`Autoflood stopped for ${user.username}\`\`\``);
    }

    // ── STFU / AUTO DELETE ────────────────────────────────────────────────────
    else if (cmd === 'stfu') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        autodeleUsers.add(user.id);
        await message.reply(`\`\`\`Auto-delete ON for ${user.username}\`\`\``);
    }
    else if (cmd === 'stfuoff') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        autodeleUsers.delete(user.id);
        await message.reply(`\`\`\`Auto-delete OFF for ${user.username}\`\`\``);
    }

    // ── PING RESPONSE ─────────────────────────────────────────────────────────
    else if (cmd === 'pingresponse') {
        const action = args[0]?.toLowerCase(); const resp = args.slice(1).join(' ');
        if (action === 'toggle') {
            if (pingResponses.has(message.channel.id)) { pingResponses.delete(message.channel.id); await message.reply('```Ping response disabled```'); }
            else if (resp) { pingResponses.set(message.channel.id, resp); await message.reply(`\`\`\`Ping response set: ${resp}\`\`\``); }
            else await message.reply('Provide a response.');
        } else if (action === 'list') {
            await message.reply(pingResponses.has(message.channel.id) ? `\`\`\`Response: ${pingResponses.get(message.channel.id)}\`\`\`` : '```None set```');
        } else if (action === 'clear') { pingResponses.delete(message.channel.id); await message.reply('```Cleared```'); }
        else await message.reply('Usage: pingresponse <toggle|list|clear> [response]');
    }

    // ── PING INSULT ───────────────────────────────────────────────────────────
    else if (cmd === 'pinginsult') {
        const action = args[0]?.toLowerCase();
        if (action === 'toggle') { insultEnabled.has(cid) ? insultEnabled.delete(cid) : insultEnabled.add(cid); await message.reply(`\`\`\`Ping insults: ${insultEnabled.has(cid) ? 'ON' : 'OFF'}\`\`\``); }
        else if (action === 'list') await message.reply(`\`\`\`Insults: ${INSULTS.join(', ')}\`\`\``);
        else if (action === 'clear') await message.reply('```Insults list is built-in```');
        else await message.reply('Usage: pinginsult <toggle|list|clear>');
    }

    // ── PING REACT ────────────────────────────────────────────────────────────
    else if (cmd === 'pingreact') {
        const action = args[0]?.toLowerCase(); const emoji = args[1];
        if (action === 'toggle') {
            if (reactEnabled.has(cid)) { reactEnabled.delete(cid); await message.reply('```Ping react: OFF```'); }
            else { reactEnabled.set(cid, emoji || '😜'); await message.reply(`\`\`\`Ping react: ON (${emoji || '😜'})\`\`\``); }
        } else if (action === 'list') await message.reply(`\`\`\`React: ${reactEnabled.get(cid) || 'none'}\`\`\``);
        else if (action === 'clear') { reactEnabled.delete(cid); await message.reply('```Cleared```'); }
        else await message.reply('Usage: pingreact <toggle|list|clear> [emoji]');
    }

    // ── MIMIC ─────────────────────────────────────────────────────────────────
    else if (cmd === 'mimic') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        mimicUser.set(cid, user.id);
        await message.reply(`\`\`\`Mimicking ${user.username}\`\`\``);
    }
    else if (cmd === 'mimicoff') { mimicUser.delete(cid); await message.reply('```Mimic stopped```'); }

    // ── BLACKIFY ──────────────────────────────────────────────────────────────
    else if (cmd === 'blackify') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        blackifyTasks.set(user.id, true);
        await message.reply(`\`\`\`Blackify ON for ${user.username}\`\`\``);
    }
    else if (cmd === 'unblackify') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        blackifyTasks.set(user.id, false);
        await message.reply(`\`\`\`Blackify OFF for ${user.username}\`\`\``);
    }

    // ── MURDER ────────────────────────────────────────────────────────────────
    else if (cmd === 'murder') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        murderRunning.set(cid, true);
        await message.reply('```Murder started```');
        (async () => {
            while (murderRunning.get(cid)) {
                try { await message.channel.send(`${user} ${pick(MURDER_MSGS)}`); } catch {}
                await new Promise(r => setTimeout(r, 300));
            }
        })();
    }
    else if (cmd === 'murderstop') { murderRunning.set(cid, false); await message.reply('```Murder stopped```'); }

    // ── KILL (OUTLASTER) ──────────────────────────────────────────────────────
    else if (cmd === 'kill') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        killLoops.set(cid, true);
        try { await message.delete(); } catch {}
        let count = 0;
        (async () => {
            while (killLoops.get(cid)) {
                try { await message.channel.send(`${user} ${pick(OUTLAST_MSGS)}\n\`\`\`${++count}\`\`\``); } catch {}
                await new Promise(r => setTimeout(r, 200));
            }
        })();
    }
    else if (cmd === 'kille') { killLoops.set(cid, false); await message.reply('```Outlaster stopped```'); }

    // ── MULTILAST ─────────────────────────────────────────────────────────────
    else if (cmd === 'multilast') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        outlastRunning.set(cid, true);
        await message.reply('```Multilast started```');
        let count = 0;
        (async () => {
            while (outlastRunning.get(cid)) {
                try { await message.channel.send(`${user} ${pick(OUTLAST_MSGS)}\n\`\`\`${++count}\`\`\``); } catch {}
                await new Promise(r => setTimeout(r, 150));
            }
        })();
    }
    else if (cmd === 'stopmultilast') { outlastRunning.set(cid, false); await message.reply('```Multilast stopped```'); }

    // ── GUILD ROTATION ────────────────────────────────────────────────────────
    else if (cmd === 'rg') {
        const GUILDS = { hail: '1034280738129989704', hesi: '1262925088374915204', god: '1264051999595302932' };
        let running = true;
        statusRotators.set(cid + '_guild', { running });
        await message.reply('```Guild rotation started```');
        (async () => {
            while (statusRotators.get(cid + '_guild')?.running) {
                for (const [name, gid] of Object.entries(GUILDS)) {
                    if (!statusRotators.get(cid + '_guild')?.running) break;
                    try { await dPatch(token, '/users/@me/clan', { identity_guild_id: gid, identity_enabled: true }); } catch {}
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        })();
    }
    else if (cmd === 'rge') {
        const k = cid + '_guild'; if (statusRotators.has(k)) { statusRotators.get(k).running = false; statusRotators.delete(k); }
        await message.reply('```Guild rotation stopped```');
    }

    // ── TOKEN JOINER ──────────────────────────────────────────────────────────
    else if (cmd === 'tjoin') {
        const invite = args[0]; const count = parseInt(args[1]) || 999;
        if (!invite) return message.reply('Usage: tjoin <invite> [count]');
        const code = invite.split('/').pop();
        const tokFile = path.join(__dirname, '..', 'big_5_v2', 'tokens.txt');
        if (!fs.existsSync(tokFile)) return message.reply('```tokens.txt not found in big_5_v2/```');
        const tokens2 = fs.readFileSync(tokFile, 'utf8').split('\n').map(t => t.trim()).filter(Boolean).slice(0, count);
        const status = await message.reply(`\`\`\`Starting join for ${tokens2.length} tokens...\`\`\``);
        let ok = 0, fail = 0;
        for (const t of tokens2) {
            try {
                const r = await doFetch(`https://discord.com/api/v10/invites/${code}`, {
                    method: 'POST', headers: hdr(t),
                    body: JSON.stringify({ session_id: Math.random().toString(36).slice(2, 18) })
                });
                r.ok ? ok++ : fail++;
            } catch { fail++; }
            try { await status.edit(`\`\`\`Joined: ${ok} | Failed: ${fail}\`\`\``); } catch {}
            await new Promise(r => setTimeout(r, 500));
        }
        await status.edit(`\`\`\`Done! Joined: ${ok} | Failed: ${fail}\`\`\``);
    }

    // ── AUTONICK ──────────────────────────────────────────────────────────────
    else if (cmd === 'autonick') {
        const action = args[0]?.toLowerCase();
        if (action === 'toggle') {
            const user = message.mentions.users.first(); const nick = args.slice(2).join(' ');
            if (!user || !nick) return message.reply('Usage: autonick toggle <@user> <nick>');
            forcedNicks.set(user.id, nick);
            await message.reply(`\`\`\`Autonick ON for ${user.username}: ${nick}\`\`\``);
        } else if (action === 'off') {
            const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
            forcedNicks.delete(user.id);
            await message.reply(`\`\`\`Autonick OFF for ${user.username}\`\`\``);
        }
    }

    // ── WHOIS / AV ────────────────────────────────────────────────────────────
    else if (cmd === 'whois') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : message.author);
        if (!user) return message.reply('User not found.');
        const member = message.guild?.members.cache.get(user.id);
        await message.channel.send(`\`\`\`User: ${user.tag}\nID: ${user.id}\nCreated: ${user.createdAt.toDateString()}${member ? `\nJoined: ${member.joinedAt?.toDateString()}` : ''}\`\`\``);
    }
    else if (cmd === 'av') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : message.author);
        if (!user) return message.reply('User not found.');
        await message.channel.send(user.displayAvatarURL({ dynamic: true, size: 1024 }));
    }
    else if (cmd === 'guildicon') {
        try { await message.delete(); } catch {}
        if (!message.guild?.iconURL()) return message.channel.send('No guild icon.');
        await message.channel.send(message.guild.iconURL({ dynamic: true, size: 1024 }));
    }
    else if (cmd === 'banner') {
        try { await message.delete(); } catch {}
        if (!message.guild?.bannerURL()) return message.channel.send('No guild banner.');
        await message.channel.send(message.guild.bannerURL({ size: 1024 }));
    }

    // ── FUN COMMANDS ──────────────────────────────────────────────────────────
    else if (cmd === 'diddy') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(10,1000)}% diddy ☠️`); }
    else if (cmd === 'pedophile') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% pedophile ☠️`); }
    else if (cmd === 'goat') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,150)}% GOAT 🐐`); }
    else if (cmd === 'faggot') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% faggot 🏳️🌈`); }
    else if (cmd === 'cringe') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% cringe 🤡`); }
    else if (cmd === 'godly') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,150)}% godly`); }
    else if (cmd === 'nitro') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} you're not getting nitro 💀`); }
    else if (cmd === 'hindu') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% Hindu, go drink cow piss`); }
    else if (cmd === 'ceepeelover') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% ceepee lover ☠️`); }

    // ── ANIME GIFs (SFW) ──────────────────────────────────────────────────────
    else if (['kiss','slap','hug','pat','wave','cuddle','lick','bite','bully','poke','bonk','yeet','highfive','handhold','nom','smug','dance','cry','sleep','blush','wink','smile'].includes(cmd)) {
        const gif = await waifuSfw(cmd);
        const u = message.mentions.users.first();
        const acts = { kiss:'kisses 💋',slap:'slaps 👋',hug:'hugs 🤗',pat:'pats 🖐',wave:'waves at 👋',cuddle:'cuddles 🤗',lick:'licks 😋',bite:'bites 🐍',bully:'bullies 😠',poke:'pokes 👉',bonk:'bonks 🤭',yeet:'yeets 💨',highfive:'high-fives 🙌',handhold:'holds hands with 🤝',nom:'noms on 😋',smug:'is smug 😏',dance:'dances 💃',cry:'is crying 😢',sleep:'is sleeping 😴',blush:'blushes 😊',wink:'winks 😉',smile:'smiles 😊' };
        const txt = u ? `${message.author.username} ${acts[cmd]} ${u.username}!` : `${message.author.username} ${acts[cmd]}!`;
        await message.channel.send(`\`\`\`${txt}\`\`\`${gif ? '\n' + gif : ''}`);
    }

    // ── ANIME GIFs (NSFW) ─────────────────────────────────────────────────────
    else if (['ecchi','hentai','uniform','maid','oppai','selfies'].includes(cmd)) {
        const gif = await waifuNsfw(cmd);
        if (gif) await message.channel.send(gif); else await message.reply('```Failed to fetch```');
    }
    else if (cmd === 'raiden') { const gif = await waifuNsfw('raiden-shogun'); if (gif) await message.channel.send(gif); else await message.reply('```Failed```'); }
    else if (cmd === 'marin') { const gif = await waifuNsfw('marin-kitagawa'); if (gif) await message.channel.send(gif); else await message.reply('```Failed```'); }

    // ── PING ──────────────────────────────────────────────────────────────────
    else if (cmd === 'ping') {
        const lat = Math.round(client.ws.ping);
        const up = client.uptime ? Math.floor(client.uptime / 1000) : 0;
        const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = up % 60;
        await message.channel.send(`\`\`\`Latency: ${lat}ms\nUptime: ${h}h ${m}m ${s}s\nServers: ${client.guilds.cache.size}\nUsers: ${client.users.cache.size}\`\`\``);
    }

    // ── FIRSTMESSAGE ──────────────────────────────────────────────────────────
    else if (cmd === 'firstmessage') {
        try {
            const msgs = await message.channel.messages.fetch({ limit: 1, after: '0' });
            const first = msgs.first();
            if (first) await first.reply('here.'); else await message.reply('```No messages found```');
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }

    // ── CLS ───────────────────────────────────────────────────────────────────
    else if (cmd === 'cls') {
        try { process.stdout.write('\x1Bc'); } catch {}
        await message.reply('```Console cleared```');
    }

    // ── HOSTINFO ──────────────────────────────────────────────────────────────
    else if (cmd === 'hostinfo') {
        try {
            const os = require('os');
            const total = Math.round(os.totalmem() / 1024 / 1024 / 1024);
            const free = Math.round(os.freemem() / 1024 / 1024 / 1024);
            const uptime = Math.floor(os.uptime());
            const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60);
            await message.channel.send(`\`\`\`OS: ${os.type()} ${os.release()}\nUptime: ${h}h ${m}m\nRAM: ${total - free}GB / ${total}GB\nCPUs: ${os.cpus().length}\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
}
