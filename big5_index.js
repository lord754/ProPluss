'use strict';
// big5_index.js — standalone runner for The Big 5 features
// Uses the token from big_5_v2/config.json (or TOKEN env var)
// Run: node big5_index.js

require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

// ── load token ────────────────────────────────────────────────────────────────
let TOKEN = process.env.BIG5_TOKEN || '';
const cfgPath = path.join(__dirname, 'big_5_v2', 'config.json');
if (!TOKEN && fs.existsSync(cfgPath)) {
    try { TOKEN = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).token || ''; } catch {}
}
if (!TOKEN) {
    console.error('[Big5] No token found. Set BIG5_TOKEN in .env or big_5_v2/config.json');
    process.exit(1);
}

const PREFIX = process.env.BIG5_PREFIX || '.';
const big5 = require('./commands/big5');

const client = new Client({ checkUpdate: false });

client.on('ready', () => {
    console.log(`[Big5] Logged in as ${client.user.tag}`);
    console.log(`[Big5] Prefix: ${PREFIX} | Commands ready`);
    big5.initialize(client);
});

client.on('messageCreate', async message => {
    if (!message.author || message.author.id !== client.user?.id) return;
    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    args.shift(); // remove command name — big5.execute reads from message.content directly
    try {
        await big5.execute(message, args, client);
    } catch (e) {
        console.error('[Big5] Command error:', e.message);
    }
});

process.on('unhandledRejection', e => console.error('[Big5] Unhandled:', e?.message || e));
process.on('uncaughtException', e => console.error('[Big5] Crash:', e?.message || e));

client.login(TOKEN).catch(e => {
    console.error('[Big5] Login failed:', e.message);
    process.exit(1);
});
