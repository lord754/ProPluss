module.exports = {
    name: 'loop',
    aliases: ['l', 'repeat'],
    category: 'Music',
    description: 'Set repeat mode: once / loop / queue / repeatN <N>',
    usage: 'loop [once|loop|queue|repeatN <count>]',
    async execute(message, args, client) {
        if (!message.guild) return;

        const queue = client.queueManager.get(message.guild.id);
        if (!queue) {
            return message.channel.send('bro no music playing!');
        }

        // Default to cycling once -> loop -> queue -> once
        let newMode = queue.repeatMode || 'once';
        let newCount = queue.repeatCount || 1;

        if (args[0]) {
            const arg = args[0].toLowerCase();
            if (arg === 'once' || arg === 'off' || arg === 'none') {
                newMode = 'once';
            } else if (arg === 'loop' || arg === 'track') {
                newMode = 'loop';
            } else if (arg === 'queue') {
                newMode = 'queue';
            } else if (arg === 'repeatn' || arg === 'repeat') {
                newMode = 'repeatN';
                if (args[1]) {
                    const n = parseInt(args[1]);
                    if (!isNaN(n) && n >= 1 && n <= 100) {
                        newCount = n;
                    } else {
                        return message.channel.send('```Invalid count. Use a number between 1 and 100.```');
                    }
                } else if (newMode !== queue.repeatMode) {
                    newCount = 5; // default 5
                }
            } else if (/^\d+$/.test(arg)) {
                // Pure number = repeat N times
                newMode = 'repeatN';
                newCount = Math.max(1, Math.min(100, parseInt(arg)));
            } else {
                return message.channel.send('```Usage: loop [once|loop|queue|repeatN <count>]```');
            }
        } else {
            // cycle once -> loop -> queue -> once
            if (newMode === 'once') newMode = 'loop';
            else if (newMode === 'loop') newMode = 'queue';
            else if (newMode === 'queue') newMode = 'once';
            else newMode = 'once';
        }

        queue.repeatMode = newMode;
        // Sync legacy loop field
        if (newMode === 'loop') queue.loop = 'track';
        else if (newMode === 'queue') queue.loop = 'queue';
        else queue.loop = 'none';

        if (newMode === 'repeatN') {
            queue.repeatCount = newCount;
            queue.currentRepeat = 0;
        } else {
            queue.repeatCount = 1;
            queue.currentRepeat = 0;
        }

        let icon = '▶️';
        let label = 'ONCE';
        if (newMode === 'loop') { icon = '🔂'; label = 'LOOP (infinite)'; }
        else if (newMode === 'queue') { icon = '🔁'; label = 'LOOP QUEUE'; }
        else if (newMode === 'repeatN') { icon = '🔢'; label = `REPEAT ${newCount} TIMES`; }

        let response = '```js\n';
        response += ` ${icon} Repeat mode set to: ${label}\n`;
        response += '╰──────────────────────────────────╯\n```';

        await message.channel.send(response);
    }
};

// v2.2.1a
