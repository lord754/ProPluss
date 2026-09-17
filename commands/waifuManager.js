const { fetch } = require('undici');

// Endpoints
const WAIFU_SFW = ['waifu', 'neko', 'hug', 'kiss', 'pat', 'slap', 'kill'];
const WAIFU_NSFW = ['waifu', 'neko', 'blowjob'];
const NEKO_NSFW = ['hentai', 'anal', 'boobs'];

// Mapping commands to API endpoints keys if different
const ENDPOINT_MAP = {
    'anal': 'hanal',
    'boobs': 'hboobs'
    // 'hentai' is 'hentai'
};

module.exports = {
    initialize(client) {
        const commands = [
            // SFW/NSFW Toggleable
            { name: 'waifu', type: 'mixed' },
            { name: 'neko', type: 'mixed' },

            // Interactions
            { name: 'hug', type: 'sfw' },
            { name: 'kiss', type: 'sfw' },
            { name: 'pat', type: 'sfw' },
            { name: 'slap', type: 'sfw' },
            { name: 'kill', type: 'sfw' },

            // NSFW Only
            { name: 'blowjob', type: 'nsfw', source: 'waifu' },
            { name: 'hentai', type: 'nsfw', source: 'neko' },
            { name: 'anal', type: 'nsfw', source: 'neko' },
            { name: 'boobs', type: 'nsfw', source: 'neko' }
        ];

        commands.forEach(cmd => {
            client.commands.set(cmd.name, {
                name: cmd.name,
                category: 'Fun',
                description: `Fun command: ${cmd.name}`,
                execute: async (message, args) => {
                    await this.handleCommand(message, cmd.name, cmd);
                }
            });
        });
    },

    async handleCommand(message, name, config) {
        const isNsfw = message.channel.type === 'GUILD_TEXT' ? message.channel.nsfw : true; // DMs are usually considered NSFW enabled or free

        let url = '';

        try {
            if (config.type === 'nsfw') {
                if (!isNsfw) return; // Silent fail if SFW channel

                if (config.source === 'waifu') {
                    url = await this.getWaifuPics('nsfw', name);
                } else {
                    const endpoint = ENDPOINT_MAP[name] || name;
                    url = await this.getNekoBot(endpoint);
                }
            } else if (config.type === 'mixed') {
                const type = isNsfw ? 'nsfw' : 'sfw';
                url = await this.getWaifuPics(type, name);
            } else {
                // sfw / interactions
                url = await this.getWaifuPics('sfw', name);
            }

            if (!url) return;

            // Reply Logic
            const referenceId = message.reference ? message.reference.messageId : null;

            if (referenceId) {
                // Reply to the referenced message
                try {
                    const repliedMsg = await message.channel.messages.fetch(referenceId);
                    if (repliedMsg) {
                        await repliedMsg.reply({ content: url, allowedMentions: { repliedUser: false } });
                    } else {
                        await message.channel.send(url);
                    }
                } catch (e) {
                    await message.channel.send(url);
                }
            } else {
                // Just send to channel
                await message.channel.send(url);
            }

        } catch (e) {
            console.error(`[WaifuManager] Error on ${name}:`, e);
        }
    },

    async getWaifuPics(type, category) {
        try {
            const res = await fetch(`https://api.waifu.pics/${type}/${category}`);
            const data = await res.json();
            return data.url;
        } catch (e) { return null; }
    },

    async getNekoBot(type) {
        try {
            const res = await fetch(`https://nekobot.xyz/api/image?type=${type}`);
            const data = await res.json();
            return data.message;
        } catch (e) { return null; }
    }
};
