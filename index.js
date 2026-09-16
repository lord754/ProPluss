require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, 'tokens.env'), override: false });
require('./logger').initLogger();
const accountManager = require('./accountManager');
const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

// All running clients keyed by account index
const clients = new Map();

// clientRef.current = the client the dashboard currently controls
const clientRef = { current: null };

// Switch dashboard focus to an account — boots it if not already running
global.switchBotAccount = async (index) => {
    if (clients.has(index)) {
        // Already running — just switch the dashboard pointer
        clientRef.current = clients.get(index);
        console.log(`[Accounts] Switched dashboard to Account #${index} (already running)`);
        return;
    }
    // Not running yet — boot it
    const { accounts } = accountManager.getAccounts();
    const acc = accounts.find(a => a.index === index);
    if (!acc) throw new Error(`Account #${index} not found`);
    await bootClient(acc.token, index);
};

async function bootClient(token, accountIndex) {
    const Lavalink = require('./music/lavalink');
    // Each account gets its own isolated Queue instance (not the singleton)
    const Queue = require('./music/queue');
    const accountQueue = new (Queue.constructor || Object.getPrototypeOf(Queue).constructor)();
    // Queue module exports a singleton instance — create a fresh one per account
    const QueueClass = require('./music/queue').constructor;
    // Fallback: clone the queue class manually
    const { queues: _q, ...qProto } = Object.getPrototypeOf(Queue);
    const isolatedQueue = Object.create(Object.getPrototypeOf(Queue));
    isolatedQueue.queues = new Map();
    // Copy all methods
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(Queue))) {
        if (key !== 'constructor') isolatedQueue[key] = Queue[key].bind(isolatedQueue);
    }

    const client = new Client({ checkUpdate: false });
    client.ttsMap = new Map();
    client.accountIndex = accountIndex;

    let lavalink = null;
    if (process.env.LAVALINK_WS && process.env.LAVALINK_REST && process.env.LAVALINK_PASSWORD) {
        lavalink = new Lavalink({
            restHost: process.env.LAVALINK_REST,
            wsHost: process.env.LAVALINK_WS,
            password: process.env.LAVALINK_PASSWORD,
            clientName: process.env.CLIENT_NAME || 'PROPlus',
        });
    }

    const voiceStates = {};
    client.commands = new Map();
    client.lavalink = lavalink;
    client.queueManager = isolatedQueue;
    client.lavalinkVoiceStates = voiceStates;

    const allowedManager = require('./commands/allowedManager');
    const isAllowedUser = (userId) => allowedManager.isAllowed(userId);

    // Load commands fresh for this client
    const commandsPath = path.join(__dirname, 'commands');
    if (fs.existsSync(commandsPath)) {
        for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
            try {
                const command = require(path.join(commandsPath, file));
                if (command.name) client.commands.set(command.name, command);
            } catch (e) { console.error('Error loading command ' + file + ':', e); }
        }
    }

    client.on('ready', () => {
        console.log(`[Accounts] Account #${accountIndex} ready: ${client.user.tag}`);

        if (lavalink) lavalink.connect(client.user.id);

        const rpcManager = require('./commands/rpcManager');
        rpcManager.initialize(client);
        require('./commands/reactionManager').initialize(client);
        require('./commands/aiManager').initialize(client);
        require('./commands/mirrorManager').initialize(client);
        require('./commands/autoMsg').initialize(client);
        require('./commands/timedMsg').initialize(client);
        require('./commands/waifuManager').initialize(client);
        require('./commands/big5').initialize(client);

        // Heartbeat for this account (every 30 min to reduce CPU)
        setInterval(async () => {
            try {
                const rpc = require('./commands/rpcManager');
                await rpc.setPresence(client, rpc.loadData(client.accountIndex));
            } catch (e) {}
        }, 30 * 60 * 1000);

        // Register in map and set as active if it's the selected account
        clients.set(accountIndex, client);
        const { active } = accountManager.getAccounts();
        if (accountIndex === active) clientRef.current = client;
    });

    // Voice / Lavalink wiring
    if (lavalink) {
        client.ws.on('VOICE_STATE_UPDATE', (packet) => {
            if (packet.user_id !== client.user?.id) return;
            const g = packet.guild_id;
            if (!voiceStates[g]) voiceStates[g] = {};
            voiceStates[g].sessionId = packet.session_id;
            if (packet.channel_id) voiceStates[g].channelId = packet.channel_id;
        });

        client.ws.on('VOICE_SERVER_UPDATE', (packet) => {
            const g = packet.guild_id;
            if (!voiceStates[g]) voiceStates[g] = {};
            voiceStates[g].token = packet.token;
            voiceStates[g].endpoint = packet.endpoint;
        });

        lavalink.on('ready', () => console.log(`[Lavalink] Account #${accountIndex} session ready`));

        lavalink.on('event', async (evt) => {
            if (evt.type !== 'TrackEndEvent') return;
            if (evt.reason !== 'finished' && evt.reason !== 'loadFailed') return;
            const queue = isolatedQueue.get(evt.guildId);
            if (!queue) return;

            if (queue.nowPlaying) {
                const mode = queue.repeatMode || (queue.loop === 'track' ? 'loop' : queue.loop === 'queue' ? 'queue' : 'once');
                if (mode === 'loop') queue.songs.unshift(queue.nowPlaying);
                else if (mode === 'repeatN') {
                    queue.currentRepeat = (queue.currentRepeat || 0) + 1;
                    if (queue.currentRepeat < queue.repeatCount) queue.songs.unshift(queue.nowPlaying);
                    else { queue.currentRepeat = 0; queue.history.push(queue.nowPlaying); }
                } else if (mode === 'queue') { queue.history.push(queue.nowPlaying); queue.songs.push(queue.nowPlaying); }
                else queue.history.push(queue.nowPlaying);
            }

            let nextSong = isolatedQueue.getNext(evt.guildId);
            if (queue.autoplay && queue.songs.length < 5) {
                await isolatedQueue.fillAutoplayQueue(client, evt.guildId);
                if (!nextSong) nextSong = isolatedQueue.getNext(evt.guildId);
            }

            if (!nextSong) {
                await lavalink.destroyPlayer(evt.guildId);
                queue.currentRepeat = 0;
                isolatedQueue.delete(evt.guildId);
                if (queue.textChannel) queue.textChannel.send('```Queue finished```');
                return;
            }

            queue.nowPlaying = nextSong;
            const vs = voiceStates[evt.guildId];
            if (vs?.token && vs?.sessionId && vs?.endpoint) {
                try {
                    await lavalink.updatePlayer(evt.guildId, nextSong, vs, { volume: queue.volume, filters: queue.filters });
                    if (queue.textChannel) {
                        const m = queue.repeatMode || 'once';
                        let msg = '```\n╭─[ NOW PLAYING ]─╮\n\n';
                        msg += `  🎵 ${nextSong.info.title}\n  👤 ${nextSong.info.author}\n`;
                        if (m === 'loop') msg += `  🔂 Loop: infinite\n`;
                        else if (m === 'repeatN') msg += `  🔢 Repeat: ${queue.currentRepeat}/${queue.repeatCount}\n`;
                        else if (m === 'queue') msg += `  🔁 Loop: queue\n`;
                        msg += '\n╰──────────────────────────────────╯\n```';
                        queue.textChannel.send(msg);
                    }
                } catch (err) { console.error('[Auto-play Error]:', err); }
            }
        });

        lavalink.on('playerUpdate', (packet) => {
            const queue = isolatedQueue.get(packet.guildId);
            if (queue && packet.state) { queue.position = packet.state.position; queue.lastUpdate = Date.now(); }
        });
    }

    // AFK cooldowns isolated per account
    const afkCooldowns = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [id, t] of afkCooldowns) if (now - t > 3600000) afkCooldowns.delete(id);
    }, 6 * 3600000); // every 6h instead of 1h

    client.on('guildMemberAdd', async member => {
        try {
            const welcomerManager = require('./commands/welcomerManager');
            const setup = welcomerManager.getSetup(member.guild.id);
            if (!setup?.channelId) return;
            const channel = member.guild.channels.cache.get(setup.channelId);
            if (!channel) return;
            if (setup.welcomeType === 'text') {
                let txt = (setup.textMessage || 'hey {user} welcome to {server}')
                    .replace(/{user}/g, `<@${member.user.id}>`).replace(/{server}/g, member.guild.name).replace(/{count}/g, member.guild.memberCount);
                await channel.send(txt);
            } else {
                const { createCanvas, loadImage } = require('canvas');
                const dataDir = path.join(__dirname, 'data');
                let bgPath = path.join(__dirname, 'dashboard', 'public', 'welcome.jpg');
                for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
                    const cp = path.join(dataDir, `welcome${ext}`);
                    if (fs.existsSync(cp)) { bgPath = cp; break; }
                }
                const canvas = createCanvas(1024, 450);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(await loadImage(bgPath), 0, 0, 1024, 450);
                ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, 1024, 450);
                const cleanGuild = member.guild.name.replace(/[^\x00-\x7F]/g, '').trim() || 'Server';
                let cleanUser = member.user.username.replace(/[^\x00-\x7F]/g, '').trim() || 'User';
                if (member.user.discriminator && member.user.discriminator !== '0') cleanUser += `#${member.user.discriminator}`;
                let userColor = setup.textcolor || '#ffffff';
                if (/^[0-9A-Fa-f]{6}$/.test(userColor)) userColor = '#' + userColor;
                ctx.textAlign = 'center';
                let startY = 290;
                for (const line of (setup.cardMessage || 'WELCOME TO {server}\n{user}\nMember #{count}').split('\n')) {
                    const parsed = line.replace(/{server}/gi, cleanGuild).replace(/{user}/gi, cleanUser).replace(/{count}/gi, member.guild.memberCount.toString());
                    if (line.toLowerCase().includes('{user}')) { ctx.font = 'bold 50px Arial'; ctx.fillStyle = userColor; startY += 10; }
                    else { ctx.font = 'bold 36px Arial'; ctx.fillStyle = '#ffffff'; }
                    ctx.fillText(parsed, 512, startY); startY += 45;
                }
                const avatar = await loadImage(member.user.displayAvatarURL({ format: 'png', size: 256 }) || 'https://cdn.discordapp.com/embed/avatars/0.png');
                ctx.save(); ctx.beginPath(); ctx.arc(512, 140, 90, 0, Math.PI * 2, true); ctx.closePath(); ctx.clip();
                ctx.drawImage(avatar, 422, 50, 180, 180); ctx.restore();
                ctx.beginPath(); ctx.arc(512, 140, 90, 0, Math.PI * 2, true); ctx.lineWidth = 8; ctx.strokeStyle = userColor; ctx.stroke();
                await channel.send({ files: [{ attachment: canvas.toBuffer('image/png'), name: 'welcome.png' }] });
            }
        } catch (e) { console.error('Welcomer Error:', e); }
    });

    client.on('messageCreate', async (message) => {
        try {
            if (!message.author) return;
            require('./commands/mimicManager').handle(message, client);

            const mentionsMe = message.mentions.users.has(client.user.id);
            const isDm = message.channel.type === 'DM';
            if ((mentionsMe || isDm) && message.author.id !== client.user.id) {
                const afkPath = path.join(__dirname, 'data', 'afk.json');
                const logPath = path.join(__dirname, 'data', 'afklog.json');
                let afkData = { isOn: false, reason: '', logsEnabled: false };
                if (fs.existsSync(afkPath)) afkData = JSON.parse(fs.readFileSync(afkPath, 'utf8'));
                if (afkData.logsEnabled) {
                    let logs = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];
                    let c = message.content
                        .replace(/<@!?(\d+)>/g, (m, id) => { const u = client.users.cache.get(id); return u ? `@${u.username}` : m; })
                        .replace(/<@&(\d+)>/g, (m, id) => { const r = message.guild?.roles.cache.get(id); return r ? `@${r.name}` : m; })
                        .replace(/<#(\d+)>/g, (m, id) => { const ch = client.channels.cache.get(id); return ch ? `#${ch.name}` : m; })
                        .replace(/<a?:(\w+):(\d+)>/g, ':$1:');
                    logs.unshift({ id: Date.now().toString(), user: message.author.tag, userId: message.author.id, channel: isDm ? 'DM' : message.channel.name || 'Unknown', guild: message.guild?.name || 'Direct Message', content: c, time: new Date().toLocaleString(), link: message.url });
                    if (logs.length > 50) logs = logs.slice(0, 50);
                    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
                }
                if (afkData.isOn) {
                    const now = Date.now(), last = afkCooldowns.get(message.author.id) || 0, start = afkData.startTime || 0;
                    if (now - last >= 5 * 60 * 1000 || last < start) {
                        try { await message.reply(afkData.reason || "I'm currently AFK."); afkCooldowns.set(message.author.id, now); } catch (e) {}
                    }
                }
            }

            if (isAllowedUser(message.author.id)) {
                if (await require('./commands/igManager').handle(message)) return;
                if (await require('./commands/ytManager').handle(message)) return;
                if (await require('./commands/calculator').handle(message)) return;
                if (await require('./commands/currency').handle(message)) return;
                if (await require('./commands/qrManager').handle(message, client, true)) return;
                if (await require('./commands/ip').handle(message)) return;
                if (message.guild && client.ttsMap?.has(message.guild.id)) {
                    const prefix = process.env.PREFIX || '!';
                    if (message.channel.id === client.ttsMap.get(message.guild.id) && !message.content.startsWith(prefix)) {
                        const tts = client.commands.get('tts');
                        if (tts?.speak) try { await tts.speak(message, client); } catch (e) {}
                    }
                }
            }

            const prefix = process.env.PREFIX || '!';
            if (!message.content.startsWith(prefix)) return;
            const args = message.content.slice(prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            if (!isAllowedUser(message.author.id)) return;

            const command = client.commands.get(commandName);
            if (!command) {
                // Try big5 commands
                const big5 = require('./commands/big5');
                const big5Cmds = new Set(['rstatus','stopstatus','remoji','stopemoji','stream','streamoff','setstatus','playing','listening','watching','stopactivity','setpfp','setbanner','stealpfp','stealbanner','setname','setbio','stealbio','setpronoun','stealpronoun','copyprofile','hypesquad','ct','snipe','agct','silentantigc','alw','wl','arr','arrend','ar1','ar1e','ar2','ar2e','dreact','dreactoff','autoreact','autoreactoff','autoflood','stopautoflood','stfu','stfuoff','pingresponse','pinginsult','pingreact','mimic','mimicoff','blackify','unblackify','murder','murderstop','kill','kille','multilast','stopmultilast','rg','rge','tjoin','autonick','whois','av','guildicon','banner','hostinfo','firstmessage','cls','ping','diddy','pedophile','goat','faggot','cringe','godly','nitro','hindu','ceepeelover','kiss','slap','hug','pat','wave','cuddle','lick','bite','bully','poke','bonk','yeet','highfive','handhold','nom','smug','dance','cry','sleep','blush','wink','smile','ecchi','hentai','uniform','maid','oppai','selfies','raiden','marin']);
                if (big5Cmds.has(commandName)) {
                    try { await big5.execute(message, args, client); } catch (e) { console.error('[Big5]', e.message); }
                    return;
                }
                const clipboardManager = require('./commands/clipboardManager');
                const responseText = clipboardManager.getResponse(commandName);
                if (responseText) {
                    const refId = message.reference?.messageId || null;
                    if (message.author.id === client.user.id) { try { await message.delete(); } catch (e) {} }
                    else if (message.guild?.me.permissionsIn(message.channel).has('MANAGE_MESSAGES')) { try { await message.delete(); } catch (e) {} }
                    if (refId) {
                        try { const rm = await message.channel.messages.fetch(refId); await (rm ? rm.reply({ content: responseText, allowedMentions: { repliedUser: true } }) : message.channel.send(responseText)); } catch (e) { await message.channel.send(responseText); }
                    } else { await message.channel.send(responseText); }
                    return;
                }
                return;
            }
            await command.execute(message, args, client);
        } catch (error) { console.error('Error in messageCreate:', error); }
    });

    await client.login(token);
    return client;
}

function errCode(e) {
    const msg = (e && (e.message || String(e))) || '';
    const code = (e && e.code) || '';
    if (code === 'TOKEN_INVALID' || msg.includes('TOKEN_INVALID')) return 'Err:0 Invalid token provided';
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) return 'Err:1 Cannot connect — network/host unreachable';
    if (msg.includes('Lavalink') || msg.includes('lavalink')) return 'Err:2 Lavalink error: ' + msg;
    if (msg.includes('quest') || msg.includes('Quest') || msg.includes('bounty')) return 'Err:3 Quest/Bounty error: ' + msg;
    if (msg.includes('DISALLOWED_INTENTS')) return 'Err:4 Disallowed intents';
    if (msg.includes('rate limit') || msg.includes('429')) return 'Err:5 Rate limited by Discord';
    return 'Err:99 ' + msg;
}
process.on('unhandledRejection', (reason) => { console.error('[Anti-Crash]', errCode(reason)); });
process.on('uncaughtException', (error) => { console.error('[Anti-Crash]', errCode(error)); });
process.on('uncaughtExceptionMonitor', (error) => { console.error('[Anti-Crash]', errCode(error)); });

// Boot dashboard first (Express stays running forever)
const dashboard = require('./dashboard/index');
dashboard(clientRef, clients);

// Boot ALL saved accounts simultaneously (skip if none — dashboard handles setup)
const { accounts, active: activeIdx } = accountManager.getAccounts();
if (accounts.length === 0) {
    console.log('[Accounts] No tokens found. Dashboard is running — add a token via the Accounts page.');
} else {
    console.log(`[Accounts] Booting ${accounts.length} account(s). Active dashboard: #${activeIdx}`);
    for (const acc of accounts) {
        if (!acc.token || !acc.token.trim()) { console.log(`[Accounts] Skipping Account #${acc.index} — empty token`); continue; }
        bootClient(acc.token, acc.index).catch(e => console.error(`[Accounts] Failed to boot Account #${acc.index}:`, errCode(e)));
    }
}

// Expose bootClient globally so dashboard can trigger it after first token add
global.bootClient = bootClient;
