const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
    name: 'stop',
    description: 'Stop music and clear the queue',
    async execute(message, args, client) {
        if (!message.guild) {
            await message.channel.send('```This command only works in servers```');
            return;
        }

        const queue = client.queueManager.get(message.guild.id);

        if (!queue) {
            await message.channel.send('```No music is playing```');
            return;
        }

        try {
            // Destroy Lavalink player
            await client.lavalink.destroyPlayer(message.guild.id);

            // Clear queue
            client.queueManager.delete(message.guild.id);

            // Disconnect from voice channel
            const connection = getVoiceConnection(message.guild.id);
            if (connection) {
                connection.destroy();
            }

            let response = '```\n';
            response += '╭─[ MUSIC STOPPED ]─╮\n\n';
            response += '  ⏹️ Player stopped\n';
            response += '  🗑️ Queue cleared\n';
            response += '  👋 Disconnected\n';
            response += '\n╰──────────────────────────────────╯\n```';

            await message.channel.send(response);

            if (message.deletable) {
                await message.delete().catch(() => { });
            }
        } catch (err) {
            console.error('[Stop Error]:', err);
            await message.channel.send(`\`\`\`js\n❌ Error: ${err.message}\n\`\`\``);
        }
    },
};

// v2.2.1a
