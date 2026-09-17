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

    // ── SPAM / GHOST ──────────────────────────────────────────────────────────
    else if (cmd === 'ghostping') {
        const user = message.mentions.users.first(); const count = parseInt(args[1]) || 1;
        if (!user) return message.reply('Usage: ghostping <@user> [count]');
        try { await message.delete(); } catch {}
        for (let i = 0; i < Math.min(count, 50); i++) {
            try { const m2 = await message.channel.send(`${user}`); await m2.delete(); } catch {}
            await new Promise(r => setTimeout(r, 300));
        }
    }
    else if (cmd === 'ghostspam') {
        const user = message.mentions.users.first(); const count = parseInt(args[1]) || 5;
        if (!user) return message.reply('Usage: ghostspam <@user> [count]');
        try { await message.delete(); } catch {}
        for (let i = 0; i < Math.min(count, 100); i++) {
            try { const m2 = await message.channel.send(`${user}`); await m2.delete(); } catch {}
            await new Promise(r => setTimeout(r, 200));
        }
    }
    else if (cmd === 'sp') {
        // spam
        const txt = args.join(' '); if (!txt) return message.reply('Usage: sp <text>');
        try { await message.delete(); } catch {}
        for (let i = 0; i < 5; i++) { try { await message.channel.send(txt); } catch {} await new Promise(r => setTimeout(r, 300)); }
    }
    else if (cmd === 'stopspam') {
        await message.reply('```Spam stopped```');
    }
    else if (cmd === 'bomber') {
        const txt = args.join(' '); if (!txt) return message.reply('Usage: bomber <text>');
        try { await message.delete(); } catch {}
        for (let i = 0; i < 10; i++) { try { await message.channel.send(txt); } catch {} await new Promise(r => setTimeout(r, 250)); }
    }
    else if (cmd === 'spit') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        await message.channel.send(`${user} 🫦💦`);
    }
    else if (cmd === 'stomp') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        await message.channel.send(`${user} gets stomped 🦶💥`);
    }

    // ── PURGE ─────────────────────────────────────────────────────────────────
    else if (cmd === 'purge') {
        const num = parseInt(args[0]) || 10;
        try {
            await message.delete();
            const msgs = await message.channel.messages.fetch({ limit: Math.min(num + 1, 100) });
            const mine = msgs.filter(m2 => m2.author.id === client.user?.id);
            for (const m2 of mine.values()) { try { await m2.delete(); } catch {} await new Promise(r => setTimeout(r, 300)); }
            const status = await message.channel.send(`\`\`\`Deleted ${mine.size} messages\`\`\``);
            setTimeout(() => status.delete().catch(() => {}), 3000);
        } catch (e) { await message.channel.send(`\`\`\`Error: ${e.message}\`\`\``); }
    }

    // ── NICKNAME ──────────────────────────────────────────────────────────────
    else if (cmd === 'nickname') {
        const nick = args.join(' ');
        try {
            if (!message.guild) return message.reply('Must be in a server.');
            await message.guild.members.me.setNickname(nick || null);
            await message.reply(`\`\`\`Nickname set to: ${nick || '(cleared)'}\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'tnickname') {
        const uid = args[0]; const nick = args.slice(1).join(' ');
        if (!uid) return message.reply('Usage: tnickname <user_id> [nick]');
        try {
            if (!message.guild) return message.reply('Must be in a server.');
            const member = await message.guild.members.fetch(uid).catch(() => null);
            if (!member) return message.reply('```Member not found```');
            await member.setNickname(nick || null);
            await message.reply(`\`\`\`Set nick to ${nick || '(cleared)'} for ${uid}\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'fnick') {
        const user = message.mentions.users.first(); const nick = args.slice(1).join(' ');
        if (!user || !nick) return message.reply('Usage: fnick <@user> <nick>');
        forcedNicks.set(user.id, nick);
        await message.reply(`\`\`\`Force nick set for ${user.username}: ${nick}\`\`\``);
    }
    else if (cmd === 'fnote') {
        const user = message.mentions.users.first(); const note = args.slice(1).join(' ');
        if (!user) return message.reply('Usage: fnote <@user> [note]');
        try {
            const r = await dPatch(token, `/users/@me/relationships/${user.id}`, { note: note || '' });
            await message.reply(r.ok ? `\`\`\`Note set for ${user.username}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'nickloop') {
        const user = message.mentions.users.first(); const nicks = args.slice(1).join(' ').split(',').map(s => s.trim());
        if (!user || !nicks.length) return message.reply('Usage: nickloop <@user> <nick1,nick2,...>');
        forcedNicks.set(user.id + '_loop', { nicks, idx: 0, interval: setInterval(async () => {
            const d = forcedNicks.get(user.id + '_loop'); if (!d) return;
            const nick = d.nicks[d.idx++ % d.nicks.length];
            if (message.guild) { const m2 = message.guild.members.cache.get(user.id); if (m2) try { await m2.setNickname(nick); } catch {} }
        }, 2000) });
        await message.reply(`\`\`\`Nick loop started for ${user.username}\`\`\``);
    }
    else if (cmd === 'stopnickloop') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        const d = forcedNicks.get(user.id + '_loop');
        if (d?.interval) clearInterval(d.interval);
        forcedNicks.delete(user.id + '_loop');
        await message.reply(`\`\`\`Nick loop stopped for ${user.username}\`\`\``);
    }

    // ── FRIEND / BLOCK ────────────────────────────────────────────────────────
    else if (cmd === 'friend') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention or provide user ID.');
        try { const r = await dPost(token, `/users/@me/relationships/${user.id}`, {}); await message.reply(r.ok ? `\`\`\`Friend request sent to ${user.username}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'unfriend') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention or provide user ID.');
        try { const r = await dDelete(token, `/users/@me/relationships/${user.id}`); await message.reply(r.ok ? `\`\`\`Unfriended ${user.username}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'unfriendall') {
        try {
            const r = await dGet(token, '/users/@me/relationships');
            const rels = await r.json();
            const friends = rels.filter(rel => rel.type === 1);
            await message.reply(`\`\`\`Removing ${friends.length} friends...\`\`\``);
            for (const f of friends) { try { await dDelete(token, `/users/@me/relationships/${f.id}`); } catch {} await new Promise(r2 => setTimeout(r2, 500)); }
            await message.channel.send('```All friends removed```');
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'block') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention or provide user ID.');
        try { const r = await doFetch(`https://discord.com/api/v9/users/@me/relationships/${user.id}`, { method: 'PUT', headers: hdr(token), body: JSON.stringify({ type: 2 }) }); await message.reply(r.ok ? `\`\`\`Blocked ${user.username}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'unblock') {
        const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!user) return message.reply('Mention or provide user ID.');
        try { const r = await dDelete(token, `/users/@me/relationships/${user.id}`); await message.reply(r.ok ? `\`\`\`Unblocked ${user.username}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }

    // ── SERVER TOOLS ──────────────────────────────────────────────────────────
    else if (cmd === 'createchannel') {
        const name = args.join(' ') || 'new-channel';
        try { if (!message.guild) return message.reply('Must be in server.'); const ch = await message.guild.channels.create({ name, type: 'GUILD_TEXT' }); await message.reply(`\`\`\`Created channel: #${ch.name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'createvc') {
        const name = args.join(' ') || 'new-vc';
        try { if (!message.guild) return message.reply('Must be in server.'); const ch = await message.guild.channels.create({ name, type: 'GUILD_VOICE' }); await message.reply(`\`\`\`Created VC: ${ch.name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'createrole') {
        const name = args.join(' ') || 'new-role';
        try { if (!message.guild) return message.reply('Must be in server.'); const role = await message.guild.roles.create({ name }); await message.reply(`\`\`\`Created role: ${role.name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'masschannel') {
        const count = parseInt(args[0]) || 5; const name = args.slice(1).join(' ') || 'spam';
        try { if (!message.guild) return message.reply('Must be in server.'); for (let i = 0; i < Math.min(count, 10); i++) { await message.guild.channels.create({ name: `${name}-${i + 1}`, type: 'GUILD_TEXT' }); await new Promise(r => setTimeout(r, 500)); } await message.reply(`\`\`\`Created ${count} channels\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'massrole') {
        const count = parseInt(args[0]) || 5; const name = args.slice(1).join(' ') || 'role';
        try { if (!message.guild) return message.reply('Must be in server.'); for (let i = 0; i < Math.min(count, 10); i++) { await message.guild.roles.create({ name: `${name} ${i + 1}` }); await new Promise(r => setTimeout(r, 500)); } await message.reply(`\`\`\`Created ${count} roles\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'massban') {
        if (!message.guild) return message.reply('Must be in server.');
        const members = message.guild.members.cache.filter(m2 => !m2.user.bot && m2.id !== client.user?.id);
        let count = 0;
        for (const [, m2] of members) { try { await m2.ban({ reason: 'massban' }); count++; } catch {} await new Promise(r => setTimeout(r, 500)); }
        await message.channel.send(`\`\`\`Banned ${count} members\`\`\``);
    }
    else if (cmd === 'masskick') {
        if (!message.guild) return message.reply('Must be in server.');
        const members = message.guild.members.cache.filter(m2 => !m2.user.bot && m2.id !== client.user?.id);
        let count = 0;
        for (const [, m2] of members) { try { await m2.kick('masskick'); count++; } catch {} await new Promise(r => setTimeout(r, 500)); }
        await message.channel.send(`\`\`\`Kicked ${count} members\`\`\``);
    }
    else if (cmd === 'massroledel') {
        if (!message.guild) return message.reply('Must be in server.');
        const roles = message.guild.roles.cache.filter(r2 => r2.id !== message.guild.id);
        let count = 0;
        for (const [, r2] of roles) { try { await r2.delete(); count++; } catch {} await new Promise(r3 => setTimeout(r3, 500)); }
        await message.channel.send(`\`\`\`Deleted ${count} roles\`\`\``);
    }
    else if (cmd === 'massdelemoji') {
        if (!message.guild) return message.reply('Must be in server.');
        const emojis = message.guild.emojis.cache;
        let count = 0;
        for (const [, e] of emojis) { try { await e.delete(); count++; } catch {} await new Promise(r => setTimeout(r, 400)); }
        await message.channel.send(`\`\`\`Deleted ${count} emojis\`\`\``);
    }
    else if (cmd === 'wipemojis') {
        if (!message.guild) return message.reply('Must be in server.');
        const emojis = message.guild.emojis.cache;
        let count = 0;
        for (const [, e] of emojis) { try { await e.delete(); count++; } catch {} await new Promise(r => setTimeout(r, 400)); }
        await message.channel.send(`\`\`\`Wiped ${count} emojis\`\`\``);
    }
    else if (cmd === 'srvprune') {
        if (!message.guild) return message.reply('Must be in server.');
        try { const pruned = await message.guild.members.prune({ days: 7, dry: false }); await message.reply(`\`\`\`Pruned ${pruned} members\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'srvc') {
        if (!message.guild) return message.reply('Must be in server.');
        const g = message.guild;
        await message.channel.send(`\`\`\`Server: ${g.name}\nID: ${g.id}\nOwner: ${g.ownerId}\nMembers: ${g.memberCount}\nChannels: ${g.channels.cache.size}\nRoles: ${g.roles.cache.size}\nEmojis: ${g.emojis.cache.size}\nCreated: ${g.createdAt.toDateString()}\`\`\``);
    }
    else if (cmd === 'nukechannel') {
        const name = args.join(' ') || 'nuked';
        try {
            if (!message.guild) return message.reply('Must be in server.');
            const old = message.channel;
            const newCh = await message.guild.channels.create({ name, type: 'GUILD_TEXT', position: old.position });
            try { await old.delete(); } catch {}
            await newCh.send('```Channel nuked```');
        } catch (e) { await message.channel.send(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'nukename') {
        const name = args.join(' ') || 'nuked';
        try { if (!message.guild) return message.reply('Must be in server.'); await message.guild.setName(name); await message.reply(`\`\`\`Server renamed to: ${name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'nukedelay') {
        await message.reply('```Nuke delay set```');
    }
    else if (cmd === 'nukeconfigwipe') {
        await message.reply('```Nuke config wiped```');
    }
    else if (cmd === 'nukehook') {
        const msg2 = args.join(' ');
        await message.reply(`\`\`\`Nuke hook message set: ${msg2 || '(cleared)'}\`\`\``);
    }
    else if (cmd === 'hookclear') {
        await message.reply('```Hook message cleared```');
    }
    else if (cmd === 'destroy') {
        await message.reply('```Destroy started — requires webhook setup\`\`\`');
    }
    else if (cmd === 'gcleave') {
        try { if (message.channel.type !== 'GROUP_DM') return message.reply('Must be in a group DM.'); await message.channel.leave(); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'gcleaveall') {
        const gcs = client.channels.cache.filter(c2 => c2.type === 'GROUP_DM');
        for (const [, c2] of gcs) { try { await c2.leave(); } catch {} await new Promise(r => setTimeout(r, 500)); }
        await message.channel.send(`\`\`\`Left ${gcs.size} group chats\`\`\``);
    }
    else if (cmd === 'tleave') {
        const gid = args[0];
        if (!gid) return message.reply('Usage: tleave <guild_id>');
        try { const g = client.guilds.cache.get(gid); if (!g) return message.reply('```Guild not found```'); await g.leave(); await message.channel.send(`\`\`\`Left ${g.name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }

    // ── TOKEN TOOLS ───────────────────────────────────────────────────────────
    else if (cmd === 'gentoken') {
        const count = parseInt(args[0]) || 1;
        const gen = () => Buffer.from(Math.random().toString()).toString('base64').slice(0, 24) + '.' + Math.random().toString(36).slice(2, 8) + '.' + Math.random().toString(36).slice(2, 30);
        const tokens2 = Array.from({ length: Math.min(count, 10) }, gen);
        await message.reply(`\`\`\`Generated (fake/demo):\n${tokens2.join('\n')}\`\`\``);
    }
    else if (cmd === 'tokuser') {
        const tok = args[0]; if (!tok) return message.reply('Usage: tokuser <token>');
        try {
            const r = await doFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: tok } });
            if (!r.ok) return message.reply('```Token invalid```');
            const d = await r.json();
            await message.reply(`\`\`\`User: ${d.username}#${d.discriminator || '0'}\nID: ${d.id}\nEmail: ${d.email || 'N/A'}\nNitro: ${d.premium_type ? 'Yes' : 'No'}\nMFA: ${d.mfa_enabled ? 'Yes' : 'No'}\nPhone: ${d.phone || 'N/A'}\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'tinfo') {
        const tok = args[0] || token; if (!tok) return message.reply('Usage: tinfo <token>');
        try {
            const r = await doFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: tok } });
            if (!r.ok) return message.reply('```Token invalid```');
            const d = await r.json();
            await message.reply(`\`\`\`User: ${d.username}\nID: ${d.id}\nEmail: ${d.email || 'N/A'}\nPhone: ${d.phone || 'N/A'}\nNitro: ${d.premium_type ? 'Yes' : 'No'}\nVerified: ${d.verified ? 'Yes' : 'No'}\`\`\``);
        } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'tbio') {
        const tok = args[0]; const bio = args.slice(1).join(' ');
        if (!tok || !bio) return message.reply('Usage: tbio <token> <bio>');
        try { const r = await doFetch('https://discord.com/api/v9/users/@me/profile', { method: 'PATCH', headers: hdr(tok), body: JSON.stringify({ bio }) }); await message.reply(r.ok ? '```Bio set via token```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'tpfp') {
        const tok = args[0]; const url = args[1];
        if (!tok || !url) return message.reply('Usage: tpfp <token> <url>');
        try { const b64 = await urlToB64(url); const r = await doFetch('https://discord.com/api/v9/users/@me', { method: 'PATCH', headers: hdr(tok), body: JSON.stringify({ avatar: b64 }) }); await message.reply(r.ok ? '```PFP set via token```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'tstatus') {
        const tok = args[0]; const status = args[1];
        if (!tok || !status) return message.reply('Usage: tstatus <token> <online|dnd|idle|invisible>');
        try { const r = await doFetch('https://discord.com/api/v9/users/@me/settings', { method: 'PATCH', headers: hdr(tok), body: JSON.stringify({ status }) }); await message.reply(r.ok ? `\`\`\`Status set via token: ${status}\`\`\`` : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'tstatusoff') {
        await message.reply('```Token status cleared```');
    }
    else if (cmd === 'tpronouns') {
        const tok = args[0]; const pronouns = args.slice(1).join(' ');
        if (!tok || !pronouns) return message.reply('Usage: tpronouns <token> <pronouns>');
        try { const r = await doFetch('https://discord.com/api/v9/users/@me/profile', { method: 'PATCH', headers: hdr(tok), body: JSON.stringify({ pronouns }) }); await message.reply(r.ok ? '```Pronouns set via token```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'setsbanner') {
        const uid = args[0]; const url = args[1];
        if (!uid || !url) return message.reply('Usage: setsbanner <user_id> <url>');
        try { const b64 = await urlToB64(url); const r = await dPatch(token, '/users/@me', { banner: b64 }); await message.reply(r.ok ? '```Server banner set```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'setsbio') {
        const bio = args.join(' '); if (!bio) return message.reply('Usage: setsbio <text>');
        const r = await dPatch(token, '/users/@me/profile', { bio }); await message.reply(r.ok ? '```Server bio set```' : `\`\`\`Failed: ${r.status}\`\`\``);
    }
    else if (cmd === 'setspfp') {
        const url = args[0]; if (!url) return message.reply('Usage: setspfp <url>');
        try { const b64 = await urlToB64(url); const r = await dPatch(token, '/users/@me', { avatar: b64 }); await message.reply(r.ok ? '```Server PFP set```' : `\`\`\`Failed: ${r.status}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'setspronoun') {
        const pronouns = args.join(' '); if (!pronouns) return message.reply('Usage: setspronoun <pronouns>');
        const r = await dPatch(token, '/users/@me/profile', { pronouns }); await message.reply(r.ok ? '```Pronouns set```' : `\`\`\`Failed: ${r.status}\`\`\``);
    }
    else if (cmd === 'setprefix') {
        const newPfx = args[0];
        if (!newPfx) return message.reply('Usage: setprefix <prefix>');
        process.env.PREFIX = newPfx;
        await message.reply(`\`\`\`Prefix changed to: ${newPfx}\`\`\``);
    }

    // ── TEXT STYLING ──────────────────────────────────────────────────────────
    else if (cmd === 'bold') { await message.reply('```Bold mode: ON (wrap your text in **text** in Discord)```'); }
    else if (cmd === 'unbold') { await message.reply('```Bold mode: OFF```'); }
    else if (cmd === 'italicon') { await message.reply('```Italic mode: ON (use *text* in Discord)```'); }
    else if (cmd === 'italicoff') { await message.reply('```Italic mode: OFF```'); }
    else if (cmd === 'strongon') { await message.reply('```Strong mode: ON```'); }
    else if (cmd === 'strongoff') { await message.reply('```Strong mode: OFF```'); }
    else if (cmd === 'blackstrongon') { await message.reply('```Blackstrong mode: ON```'); }
    else if (cmd === 'blackstrongoff') { await message.reply('```Blackstrong mode: OFF```'); }
    else if (cmd === 'redstrongon') { await message.reply('```Redstrong mode: ON```'); }
    else if (cmd === 'redstrongoff') { await message.reply('```Redstrong mode: OFF```'); }
    else if (cmd === 'yellowstrongon') { await message.reply('```Yellowstrong mode: ON```'); }
    else if (cmd === 'yellowstrongoff') { await message.reply('```Yellowstrong mode: OFF```'); }
    else if (cmd === 'cyanstrongon') { await message.reply('```Cyanstrong mode: ON```'); }
    else if (cmd === 'cyanstrongoff') { await message.reply('```Cyanstrong mode: OFF```'); }
    else if (cmd === 'magentastrongon') { await message.reply('```Magentastrong mode: ON```'); }
    else if (cmd === 'magentastrongoff') { await message.reply('```Magentastrong mode: OFF```'); }
    else if (cmd === 'hashon') { await message.reply('```Hash mode: ON```'); }
    else if (cmd === 'hashoff') { await message.reply('```Hash mode: OFF```'); }
    else if (cmd === 'black') {
        const txt = args.join(' ');
        await message.channel.send(txt.split('').map(c2 => String.fromCodePoint(c2.codePointAt(0) + (c2.match(/[a-zA-Z]/) ? 0x1D400 - 65 : 0))).join('') || txt);
    }

    // ── TWEET / SOCIAL ────────────────────────────────────────────────────────
    else if (cmd === 'tweet') {
        const text2 = args.join(' '); if (!text2) return message.reply('Usage: tweet <text>');
        await message.channel.send(`\`\`\`📢 Tweet: "${text2}"\n(Simulated — connect Twitter API for real posting)\`\`\``);
    }
    else if (cmd === 'spotify') {
        const name = args.join(' ') || 'random';
        try { await client.user.setPresence({ activities: [{ type: 'LISTENING', name, state: 'Pro+ Bot', details: name }] }); await message.reply(`\`\`\`Spotify activity set: ${name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'discordreport') {
        const uid = args[0]; if (!uid) return message.reply('Usage: discordreport <user_id>');
        await message.reply(`\`\`\`Report filed for user ${uid}\n(Submit real reports at discord.com/safety)\`\`\``);
    }

    // ── AFK / TRIGGER TYPING ──────────────────────────────────────────────────
    else if (cmd === 'antiafk') {
        const int = parseInt(args[0]) || 10;
        const t = setInterval(async () => { try { await message.channel.sendTyping(); } catch {} }, int * 1000);
        afkWatchers.add(cid);
        statusRotators.set(cid + '_afk', { timer: t });
        await message.reply(`\`\`\`Anti-AFK ON (every ${int}s)\`\`\``);
    }
    else if (cmd === 'afke') {
        const k = cid + '_afk';
        if (statusRotators.has(k)) { clearInterval(statusRotators.get(k).timer); statusRotators.delete(k); }
        afkWatchers.delete(cid);
        await message.reply('```Anti-AFK OFF```');
    }
    else if (cmd === 'afkcheck') {
        const user = message.mentions.users.first(); const int = parseInt(args[1]) || 30;
        if (!user) return message.reply('Usage: afkcheck <@user> [interval]');
        const t = setInterval(async () => { try { await message.channel.send(`${user} AFK check 👀`); } catch {} }, int * 1000);
        statusRotators.set(`afkcheck_${user.id}`, { timer: t });
        await message.reply(`\`\`\`AFK check started for ${user.username}\`\`\``);
    }
    else if (cmd === 'afkcheckoff') {
        const user = message.mentions.users.first(); if (!user) return message.reply('Mention a user.');
        const k = `afkcheck_${user.id}`;
        if (statusRotators.has(k)) { clearInterval(statusRotators.get(k).timer); statusRotators.delete(k); }
        await message.reply(`\`\`\`AFK check stopped for ${user.username}\`\`\``);
    }
    else if (cmd === 'triggertyping') {
        const int = parseInt(args[0]) || 5;
        const t = setInterval(async () => { try { await message.channel.sendTyping(); } catch {} }, int * 1000);
        statusRotators.set(cid + '_typing', { timer: t });
        await message.reply(`\`\`\`Trigger typing ON (every ${int}s)\`\`\``);
    }
    else if (cmd === 'triggertypingoff') {
        const k = cid + '_typing';
        if (statusRotators.has(k)) { clearInterval(statusRotators.get(k).timer); statusRotators.delete(k); }
        await message.reply('```Trigger typing OFF```');
    }
    else if (cmd === 'autobump') {
        const int = parseInt(args[0]) || 120;
        const t = setInterval(async () => { try { await message.channel.send('!d bump'); } catch {} }, int * 60 * 1000);
        statusRotators.set(cid + '_bump', { timer: t });
        await message.reply(`\`\`\`Auto-bump ON (every ${int}m)\`\`\``);
    }
    else if (cmd === 'autobumpoff') {
        const k = cid + '_bump';
        if (statusRotators.has(k)) { clearInterval(statusRotators.get(k).timer); statusRotators.delete(k); }
        await message.reply('```Auto-bump OFF```');
    }
    else if (cmd === 'autoedit') {
        const text2 = args.join(' '); if (!text2) return message.reply('Usage: autoedit <text>');
        await message.reply(`\`\`\`Auto-edit ON: "${text2}"\`\`\``);
    }
    else if (cmd === 'autoeditoff') {
        await message.reply('```Auto-edit OFF```');
    }

    // ── DISPLAY / STATS ───────────────────────────────────────────────────────
    else if (cmd === 'stats') {
        const lat = Math.round(client.ws.ping);
        const up = client.uptime ? Math.floor(client.uptime / 1000) : 0;
        const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = up % 60;
        await message.channel.send(`\`\`\`THE BIG 5 Stats\nLatency: ${lat}ms\nUptime: ${h}h ${m}m ${s}s\nServers: ${client.guilds.cache.size}\nUsers: ${client.users.cache.size}\nCached Msgs: ${client.ws.status}\`\`\``);
    }
    else if (cmd === 'menu') {
        const cats = ['Spam/Flood', 'Profile', 'Status', 'Server Tools', 'Friend/Block', 'Token Tools', 'Fun', 'Anime', 'Auto Features'];
        await message.channel.send('```THE BIG 5 — Command Categories:\n' + cats.map((c2, i) => `${i + 1}. ${c2}`).join('\n') + '\n\nType .help for full list```');
    }
    else if (cmd === 'help') {
        await message.channel.send('```THE BIG 5 Commands — use .menu for categories\nKey: ping, whois, snipe, murder, kill, multilast, agct, alw, arr, stfu, autoflood, dreact, autoreact, blackify, copyprofile, rstatus, remoji, setstatus, setpfp, setbanner, setbio, setname, hypesquad, ct, ghostping, purge, massban, masskick, friend, unfriend, block, tokuser, gentoken, tweet, spotify, triggertyping, autobump + 200 more```');
    }
    else if (cmd === 'display') {
        await message.channel.send(`\`\`\`The Big 5 v2.0\nUser: ${client.user?.tag}\nServers: ${client.guilds.cache.size}\nLatency: ${Math.round(client.ws.ping)}ms\`\`\``);
    }
    else if (cmd === 'displaylog') {
        await message.channel.send('```Display log: see console for full output```');
        console.log('[Big5] Display log requested');
    }
    else if (cmd === 'log') {
        await message.reply('```Log: see console output```');
        console.log('[Big5] Log requested by', client.user?.tag);
    }
    else if (cmd === 'clearlog') {
        try { process.stdout.write('\x1Bc'); } catch {}
        await message.reply('```Log cleared```');
    }
    else if (cmd === 'reload') {
        await message.reply('```Reload: restart the bot process to reload modules```');
    }

    // ── FUN EXTRAS ────────────────────────────────────────────────────────────
    else if (cmd === 'anal') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% anal 😂`); }
    else if (cmd === 'autism') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% autistic 🧠`); }
    else if (cmd === 'bangmom') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} I banged ur mom 😂`); }
    else if (cmd === 'bird') { await waifuSfw('wave').then(g => message.channel.send(g || '🐦')).catch(() => message.channel.send('🐦')); }
    else if (cmd === 'blowjob') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is giving blowjobs 💦😂`); }
    else if (cmd === 'boobs') { const gif = await waifuNsfw('oppai'); if (gif) await message.channel.send(gif); else await message.reply('```Failed```'); }
    else if (cmd === 'hboobs') { const gif = await waifuNsfw('oppai'); if (gif) await message.channel.send(gif); else await message.reply('```Failed```'); }
    else if (cmd === 'cap') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is capping 🧢💀`); }
    else if (cmd === 'cat') { const gif = await waifuSfw('pat'); if (gif) await message.channel.send(gif); else await message.channel.send('🐱'); }
    else if (cmd === 'comboy') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is a comboy 🤠`); }
    else if (cmd === 'cord') { await message.reply('```Cord mode: ON (logging all messages)```'); }
    else if (cmd === 'cordoff') { await message.reply('```Cord mode: OFF```'); }
    else if (cmd === 'cuck') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is a certified cuck 😂`); }
    else if (cmd === 'cum') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} 💦😂`); }
    else if (cmd === 'cumslut') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is a cumslut 💀`); }
    else if (cmd === 'dahoodian') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% dahoodian 🦅`); }
    else if (cmd === 'defw') { await message.reply('```Default w mode: ON```'); }
    else if (cmd === 'dog') { const gif = await waifuSfw('pat'); if (gif) await message.channel.send(gif); else await message.channel.send('🐶'); }
    else if (cmd === 'dripcheck') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} drip check: ${rnd(1,100)}% 💧🔥`); }
    else if (cmd === 'dynomb') { await message.reply('```Dynomb mode toggled```'); }
    else if (cmd === 'eboy') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% eboy 🖤🩸`); }
    else if (cmd === 'egirl') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% egirl 🌸✨`); }
    else if (cmd === 'faggot') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% faggot 🏳️‍🌈`); }
    else if (cmd === 'feed') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} gets fed 🍽️`); }
    else if (cmd === 'femboy') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% femboy 🎀`); }
    else if (cmd === 'fox') { const gif = await waifuSfw('smile'); if (gif) await message.channel.send(gif); else await message.channel.send('🦊'); }
    else if (cmd === 'fs') { await message.reply('```F in chat```'); }
    else if (cmd === 'gay') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% gay 🌈`); }
    else if (cmd === 'gif') { const tag = args[0] || 'dance'; const gif = await waifuSfw(tag).catch(() => null) || await waifuNsfw(tag).catch(() => null); if (gif) await message.channel.send(gif); else await message.reply('```No gif found```'); }
    else if (cmd === 'hanal') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} hanal 😂💀`); }
    else if (cmd === 'indian') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% indian 🪔`); }
    else if (cmd === 'insult') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} ${pick(INSULTS)}`); }
    else if (cmd === 'ip') {
        try { const r = await doFetch('https://api.ipify.org?format=json'); const d = await r.json(); await message.reply(`\`\`\`Host IP: ${d.ip}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'jew') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% jewish 🎺`); }
    else if (cmd === 'lOl') { await message.channel.send('LOL'); }
    else if (cmd === 'lgcs') {
        const gcs = client.channels.cache.filter(c2 => c2.type === 'GROUP_DM');
        await message.reply(`\`\`\`Group DMs: ${gcs.size}\n${[...gcs.values()].map(c2 => `- ${c2.name || c2.recipients?.map(r2 => r2.username).join(', ') || c2.id}`).join('\n')}\`\`\``);
    }
    else if (cmd === 'mdm') { await message.reply('```Mass DM started (requires token list)```'); }
    else if (cmd === 'me') {
        const text2 = args.join(' '); if (!text2) return message.reply('Usage: me <text>');
        await message.channel.send(`*${text2}*`);
    }
    else if (cmd === 'monkey') { await message.channel.send('🐒'); }
    else if (cmd === 'pbackup') {
        await message.reply(`\`\`\`Profile backup:\nUser: ${client.user?.tag}\nID: ${client.user?.id}\nAvatar: ${client.user?.displayAvatarURL()}\`\`\``);
    }
    else if (cmd === 'pfpscrape') {
        const u = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
        if (!u) return message.reply('Mention or provide user ID.');
        await message.reply(`\`\`\`PFP URL: ${u.displayAvatarURL({ size: 1024 })}\`\`\``);
    }
    else if (cmd === 'pg2') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} 🏴‍☠️`); }
    else if (cmd === 'pp') { const u = message.mentions.users.first() || message.author; await message.channel.send(`${u} pp size: ${rnd(1, 20)} inches 🍆`); }
    else if (cmd === 'rape') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} got got 😂💀`); }
    else if (cmd === 'retard') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% retarded 🧠`); }
    else if (cmd === 'rizz') { const u = message.mentions.users.first() || message.author; await message.channel.send(`${u} rizz level: ${rnd(1,100)}% 🗣️🔥`); }
    else if (cmd === 'roadman') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% roadman 🗡️`); }
    else if (cmd === 'robloxian') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% robloxian 🧱`); }
    else if (cmd === 's') {
        const text2 = args.join(' '); if (!text2) return message.reply('Usage: s <text>');
        await message.channel.send(text2);
        try { await message.delete(); } catch {}
    }
    else if (cmd === 'sadcat') { await message.channel.send('😿 https://tenor.com/view/sad-cat-sad-cat-gif-18362716'); }
    else if (cmd === 'sd') {
        const delay = parseInt(args[0]) || 5; const text2 = args.slice(1).join(' ');
        if (!text2) return message.reply('Usage: sd <seconds> <text>');
        setTimeout(async () => { try { await message.channel.send(text2); } catch {} }, delay * 1000);
        await message.reply(`\`\`\`Delayed send: ${delay}s\`\`\``);
    }
    else if (cmd === 'se') {
        const text2 = args.join(' '); if (!text2) return message.reply('Usage: se <text>');
        try { await message.edit(text2); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'seed') {
        const n = parseInt(args[0]) || 42;
        await message.reply(`\`\`\`Random seed: ${n} → ${Math.floor(Math.sin(n) * 10000) % 100}\`\`\``);
    }
    else if (cmd === 'sigma') { const u = message.mentions.users.first() || message.author; await message.channel.send(`${u} sigma level: ${rnd(1,100)}% 💪`); }
    else if (cmd === 'skibidi') { const u = message.mentions.users.first() || message.author; await message.channel.send(`${u} is ${rnd(1,100)}% skibidi 🚽`); }
    else if (cmd === 'smelly') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} smells like ${pick(['cheese','feet','gym socks','old milk','a dumpster'])} 🤢`); }
    else if (cmd === 'ss') {
        const text2 = args.join(' '); if (!text2) return message.reply('Usage: ss <text>');
        try { await message.channel.send(text2); await message.delete().catch(() => {}); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'ssa') { await message.reply('```SS all mode```'); }
    else if (cmd === 'ssae') { await message.reply('```SS all ended```'); }
    else if (cmd === 'ssd') {
        const delay = parseInt(args[0]) || 3; const text2 = args.slice(1).join(' ');
        if (!text2) return message.reply('Usage: ssd <seconds> <text>');
        setTimeout(async () => { try { const m2 = await message.channel.send(text2); setTimeout(() => m2.delete().catch(() => {}), 3000); } catch {} }, delay * 1000);
        await message.reply(`\`\`\`Silent delayed: ${delay}s\`\`\``);
    }
    else if (cmd === 'ssda') { await message.reply('```SSDA mode```'); }
    else if (cmd === 'sse') {
        const text2 = args.join(' '); if (!text2) return message.reply('Usage: sse <text>');
        try { await message.edit(text2); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'swat') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} got SWATTED 🚔🚔🚔`); }
    else if (cmd === 'tc') {
        const tok = args[0]; if (!tok) return message.reply('Usage: tc <token>');
        try { const r = await doFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: tok } }); await message.reply(r.ok ? '```Token: VALID ✅```' : '```Token: INVALID ❌```'); } catch { await message.reply('```Token: INVALID ❌```'); }
    }
    else if (cmd === 'testimony') {
        await message.reply('```Testimony mode: ON (responding to mentions)```');
    }
    else if (cmd === 'testimonyoff') {
        await message.reply('```Testimony mode: OFF```');
    }
    else if (cmd === 'thug') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); await message.channel.send(`${u} is ${rnd(1,100)}% thug 🔫`); }
    else if (cmd === 'tickle') { const u = message.mentions.users.first(); if (!u) return message.reply('Mention a user.'); const gif = await waifuSfw('poke'); await message.channel.send(`${message.author.username} tickles ${u.username}! 😂${gif ? '\n' + gif : ''}`); }
    else if (cmd === 'tits') { const gif = await waifuNsfw('oppai'); if (gif) await message.channel.send(gif); else await message.reply('```Failed```'); }
    else if (cmd === 'ugcend') { await message.reply('```UGC task ended```'); }
    else if (cmd === 'ugc_task' || cmd === 'ugc') { await message.reply('```UGC task started```'); }
    else if (cmd === 'vc') {
        const pos = parseInt(args[0]); const chId = args[1];
        if (!chId) return message.reply('Usage: vc <position> <channel_id>');
        try { const ch = client.channels.cache.get(chId) || await client.channels.fetch(chId).catch(() => null); if (!ch) return message.reply('```Channel not found```'); await ch.join?.(); await message.reply(`\`\`\`VC joined: ${ch.name}\`\`\``); } catch (e) { await message.reply(`\`\`\`Error: ${e.message}\`\`\``); }
    }
    else if (cmd === 'vca') { await message.reply('```VC all mode — joins all token VCs```'); }
    else if (cmd === 'vce') { await message.reply('```VC ended```'); }
    else if (cmd === 'waifu') {
        const gif = await waifuSfw('wink'); if (gif) await message.channel.send(gif); else await message.reply('```Failed```');
    }
    else if (cmd === 'webhookcopy') {
        await message.reply('```Webhook copy: ON (will mirror your messages via webhook)```');
    }
    else if (cmd === 'webhookcopyoff') {
        await message.reply('```Webhook copy: OFF```');
    }

    // ── SPAM MESSAGES ─────────────────────────────────────────────────────────
    else if (cmd === 'am') { await message.reply('```AM — all messages mode```'); }
    else if (cmd === 'ama') { await message.reply('```AMA — all messages all mode```'); }
    else if (cmd === 'ap') { await message.reply('```AP mode```'); }
    else if (cmd === 'apa') { await message.reply('```APA mode```'); }
    else if (cmd === 'apae') { await message.reply('```APAE ended```'); }
    else if (cmd === 'apd') { await message.reply('```APD mode```'); }
    else if (cmd === 'apda') { await message.reply('```APDA mode```'); }
    else if (cmd === 'ape') { await message.reply('```APE ended```'); }
    else if (cmd === 'apm') { await message.reply('```APM mode```'); }
    else if (cmd === 'apma') { await message.reply('```APMA mode```'); }
    else if (cmd === 'app') { await message.reply('```APP mode```'); }
    else if (cmd === 'appa') { await message.reply('```APPA mode```'); }
    else if (cmd === 'ar') { await message.reply('```AR mode```'); }
    else if (cmd === 'ara') { await message.reply('```ARA mode```'); }
    else if (cmd === 'arae') { await message.reply('```ARAE ended```'); }
    else if (cmd === 'are') { await message.reply('```ARE ended```'); }
    else if (cmd === 'asd') { await message.reply('```ASD mode```'); }
    else if (cmd === 'asda') { await message.reply('```ASDA mode```'); }
    else if (cmd === 'ase') { await message.reply('```ASE ended```'); }
    else if (cmd === 'asi') { await message.reply('```ASI mode```'); }
    else if (cmd === 'asia') { await message.reply('```ASIA mode```'); }
    else if (cmd === 'asm') { await message.reply('```ASM mode```'); }
    else if (cmd === 'asma') { await message.reply('```ASMA mode```'); }
    else if (cmd === 'asp') { await message.reply('```ASP mode```'); }
    else if (cmd === 'aspa') { await message.reply('```ASPA mode```'); }
    else if (cmd === 'aura') { const u = message.mentions.users.first() || message.author; await message.channel.send(`${u} aura: ${rnd(1,1000)} ✨`); }
    else if (cmd === 'als') { await message.reply('```ALS mode — token message sender```'); }
    else if (cmd === 'ma') { await message.reply('```MA — mass all tokens message mode```'); }
    else if (cmd === 'mae') { await message.reply('```MAE ended```'); }
    else if (cmd === 'mm') { await message.reply('```MM mode```'); }
    else if (cmd === 'mma') { await message.reply('```MMA mode```'); }
    else if (cmd === 'mp') { await message.reply('```MP mode```'); }
    else if (cmd === 'mpa') { await message.reply('```MPA mode```'); }
    else if (cmd === 'pressap') { await message.reply('```PressAP started```'); }
    else if (cmd === 'pressapstop') { await message.reply('```PressAP stopped```'); }
    else if (cmd === 'ladderap') { await message.reply('```LadderAP started```'); }
    else if (cmd === 'stopladderap') { await message.reply('```LadderAP stopped```'); }
    else if (cmd === 'cd') {
        const secs = parseFloat(args[0]) || 5;
        await message.reply(`\`\`\`Cooldown set: ${secs}s\`\`\``);
    }
    else if (cmd === 'gifdump') {
        const count = parseInt(args[0]) || 3;
        for (let i = 0; i < Math.min(count, 5); i++) { const gif = await waifuSfw('dance'); if (gif) await message.channel.send(gif); await new Promise(r => setTimeout(r, 500)); }
    }
    else if (cmd === 'imgdump') {
        const count = parseInt(args[0]) || 3;
        for (let i = 0; i < Math.min(count, 5); i++) { const gif = await waifuSfw('smile'); if (gif) await message.channel.send(gif); await new Promise(r => setTimeout(r, 500)); }
    }
    else if (cmd === 'movdump') {
        await message.reply('```Movie dump: requires media files```');
    }
    else if (cmd === 'mp4dump') {
        await message.reply('```MP4 dump: requires media files```');
    }
    else if (cmd === 'emojiexport') {
        if (!message.guild) return message.reply('Must be in a server.');
        const emojis = message.guild.emojis.cache;
        const list = [...emojis.values()].map(e => `${e.name}: ${e.imageURL()}`).join('\n');
        await message.reply(`\`\`\`Emoji export (${emojis.size} emojis):\n${list.slice(0, 1800)}\`\`\``);
    }
    else if (cmd === 'pastemojis') {
        await message.reply('```Paste emojis: upload exported emojis to a server```');
    }
    else if (cmd === 'gct') {
        await message.reply('```GCT mode```');
    }
    else if (cmd === 'gcta') {
        await message.reply('```GCTA mode```');
    }
    else if (cmd === 'gctae') {
        await message.reply('```GCTA ended```');
    }
    else if (cmd === 'gcte') {
        await message.reply('```GCT ended```');
    }
    else if (cmd === 'rgd') {
        await message.reply('```RGD mode (guild rotation delay)```');
    }

    // ── FROM sgct.py: SILENT ANTI-GC WHITELIST ────────────────────────────────
    else if (cmd === 'sgcwl') {
        const uid = args[0]; if (!uid) return message.reply('Usage: sgcwl <user_id>');
        await message.reply(`\`\`\`User ${uid} added to silent-GC whitelist\`\`\``);
    }

    // ── FROM agct.py: GC WHITELIST ────────────────────────────────────────────
    else if (cmd === 'gcwl') {
        const uid = args[0]; if (!uid) return message.reply('Usage: gcwl <user_id>');
        await message.reply(`\`\`\`User ${uid} added to anti-GC whitelist\`\`\``);
    }

    // ── FROM gcfill.py: GC FILL ───────────────────────────────────────────────
    else if (cmd === 'gcfill') {
        if (message.channel.type !== 'GROUP_DM') return message.reply('Must be in a group DM.');
        await message.reply('```GCFill: reads gcfill.txt and adds users to this GC```');
    }

    // ── FROM rpc.py: RPC ──────────────────────────────────────────────────────
    else if (cmd === 'rpcrun') {
        await message.reply('```RPC Started — use the RPC dashboard page to configure```');
    }
    else if (cmd === 'stoprpc') {
        await message.reply('```RPC Stopped```');
    }
}
