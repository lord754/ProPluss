const { EmbedBuilder } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

// Big5 features for .help extra
const BIG5_FEATURES = [
    { name: 'Token Checker', desc: 'Verify Discord tokens validity', usage: 'Run via dashboard Big5 section' },
    { name: 'Server Nuker', desc: 'Mass delete channels/roles', usage: 'Configure in big_5_v2/nuke_config.json' },
    { name: 'Group Chat Tools', desc: 'GC spam, auto-join, management', usage: 'gcfill.py, gct.py, agct.py' },
    { name: 'Token Joiner', desc: 'Mass-join tokens to server', usage: 'Add tokens to tokens.env, run joiner' },
    { name: 'RPC Spoofer', desc: 'Custom rich presence profiles', usage: 'rpc.py with custom config' },
    { name: 'Server Info', desc: 'Fetch server details & members', usage: 'sgct.py <server_id>' },
    { name: 'Auto-Leave/Withdraw', desc: 'Leave all servers or GCs', usage: 'alw.py script' },
    { name: 'Joke Spammer', desc: 'Spam jokes from jokes.txt', usage: 'Load jokes.txt, configure target' },
];

module.exports = {
    name: 'help',
    category: 'Utility',
    description: 'List commands with embeds and pagination',
    async execute(message, args, client) {
        const prefix = process.env.PREFIX || '.';
        
        // .help extra [page] — Big5 features
        if (args[0]?.toLowerCase() === 'extra') {
            const page = parseInt(args[1]) || 1;
            const itemsPerPage = 3;
            const totalPages = Math.ceil(BIG5_FEATURES.length / itemsPerPage);
            const start = (page - 1) * itemsPerPage;
            const pageItems = BIG5_FEATURES.slice(start, start + itemsPerPage);

            if (pageItems.length === 0) {
                return message.reply(`❌ Page ${page} doesn't exist. Total pages: ${totalPages}`);
            }

            const embed = new EmbedBuilder()
                .setColor('#8a2be2')
                .setTitle('⚡ Big5 Extra Features')
                .setDescription(`Advanced Python-based features from \`big_5_v2/\`\n\n**Note:** Tokens are stored in \`tokens.env\`, not tokens2.txt`)
                .setFooter({ text: `Page ${page}/${totalPages} • Use ${prefix}help extra <page>` })
                .setTimestamp();

            pageItems.forEach(item => {
                embed.addFields({ name: `🔹 ${item.name}`, value: `${item.desc}\n*Usage:* ${item.usage}`, inline: false });
            });

            const replyMsg = await message.reply({ embeds: [embed] });
            setTimeout(() => replyMsg.delete().catch(() => {}), 30000);
            return;
        }

        const commands = Array.from(client.commands.values());
        const categories = {};

        // Sort commands into categories
        commands.forEach(cmd => {
            let cat = cmd.category || 'Utility';
            if (['play', 'stop', 'skip', 'queue', 'join', 'left', 'tts', 'volume', 'seek', 'autoplay', 'fav'].includes(cmd.name)) cat = 'Music';
            if (['purge', 'dm', 'say'].includes(cmd.name)) cat = 'Utility';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(cmd);
        });

        // Inject Clipboard Help
        if (categories['Utility']) {
            categories['Utility'].push(
                { name: '<trigger>', description: 'Custom Clipboard Trigger' },
                { name: '<math>', description: 'Calculator (e.g. 5+5)' },
                { name: '<currency>', description: 'Fiat Exchange (e.g. 10 usd to inr)' },
                { name: '<qr>', description: 'QR Code Manager (type "qr")' },
                { name: '<ip>', description: 'IP Lookup (e.g. "ip 1.1.1.1")' }
            );
        }

        let replyMsg = null;

        // Show Specific Category
        if (args[0]) {
            const catName = Object.keys(categories).find(c => c.toLowerCase() === args[0].toLowerCase());
            if (catName) {
                const embed = new EmbedBuilder()
                    .setColor('#6c5ce7')
                    .setTitle(`📂 ${catName} Commands`)
                    .setFooter({ text: `PRO+ v2.0.0d • ${prefix}help for all categories` })
                    .setTimestamp();

                categories[catName].forEach(cmd => {
                    embed.addFields({ name: `${prefix}${cmd.name}`, value: cmd.description || 'No description', inline: true });
                });

                replyMsg = await message.reply({ embeds: [embed] });
            } else {
                replyMsg = await message.reply(`❌ Category not found. Type \`${prefix}help\` for list.`);
            }
        } else {
            // Show All Categories (Main Menu)
            const embed = new EmbedBuilder()
                .setColor('#a29bfe')
                .setTitle('📖 PRO+ Help Menu')
                .setDescription(`Use \`${prefix}help <category>\` to view commands in a category.\nUse \`${prefix}help extra\` for Big5 features.`)
                .setFooter({ text: 'PRO+ v2.0.0d Developer Stable' })
                .setTimestamp();

            Object.keys(categories).forEach(cat => {
                const count = categories[cat].length;
                embed.addFields({ name: `📂 ${cat}`, value: `${count} commands • \`${prefix}help ${cat.toLowerCase()}\``, inline: true });
            });

            embed.addFields({ name: '⚡ Big5 Extra', value: `Advanced features • \`${prefix}help extra\``, inline: true });

            replyMsg = await message.reply({ embeds: [embed] });
        }

        // Auto Delete after 30 seconds
        if (replyMsg) {
            setTimeout(() => replyMsg.delete().catch(() => {}), 30000);
        }
    }
};

// v2.2.1a
