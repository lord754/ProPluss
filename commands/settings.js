const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'settings',
    category: 'Utility',
    description: 'Manage bot settings and environment variables',
    async execute(message, args, client) {
        const envPath = path.join(__dirname, '../.env');
        
        if (!args.length) {
            const embed = {
                color: 0x8a2be2,
                title: '⚙️ Settings',
                description: 'Manage bot configuration via dashboard:\n**http://localhost:8080/commands/settings**',
                fields: [
                    { name: 'Available Settings', value: '• Prefix\n• OpenAI API Key\n• Other environment variables', inline: false }
                ],
                footer: { text: 'Use the dashboard for a better experience' }
            };
            return message.reply({ embeds: [embed] });
        }

        // Simple inline setting for prefix
        if (args[0].toLowerCase() === 'prefix' && args[1]) {
            try {
                let envContent = fs.readFileSync(envPath, 'utf8');
                const lines = envContent.split('\n');
                let found = false;
                
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('PREFIX=')) {
                        lines[i] = `PREFIX=${args[1]}`;
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    lines.push(`PREFIX=${args[1]}`);
                }
                
                fs.writeFileSync(envPath, lines.join('\n'));
                process.env.PREFIX = args[1];
                
                return message.reply(`✅ Prefix updated to \`${args[1]}\` (restart required for full effect)`);
            } catch (e) {
                return message.reply(`❌ Error updating prefix: ${e.message}`);
            }
        }

        message.reply('Use the dashboard for full settings management: http://localhost:8080/commands/settings');
    }
};
