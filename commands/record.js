const { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const recordings = new Map(); // guildId -> recording state

module.exports = {
    name: 'record',
    category: 'Voice',
    description: 'Record voice channel audio',
    async execute(message, args, client) {
        const member = message.guild.members.cache.get(client.user.id);
        const voiceChannel = member?.voice?.channel;
        
        if (!voiceChannel) {
            return message.reply('❌ You must be in a voice channel first!');
        }

        const action = (args[0] || 'start').toLowerCase();
        const guildId = message.guild.id;

        if (action === 'start') {
            if (recordings.has(guildId)) {
                return message.reply('⏺️ Already recording in this server!');
            }

            const format = (args[1] || 'mp3').toLowerCase();
            const validFormats = ['mp3', 'm4a', 'aac', 'wav'];
            if (!validFormats.includes(format)) {
                return message.reply(`❌ Invalid format. Use: ${validFormats.join(', ')}`);
            }

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guildId,
                    adapterCreator: message.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: true
                });

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                const recordDir = path.join(__dirname, '../data/recordings');
                if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true });
                
                const filename = `recording_${timestamp}.${format}`;
                const outputPath = path.join(recordDir, filename);

                recordings.set(guildId, {
                    connection,
                    format,
                    outputPath,
                    filename,
                    startTime: Date.now(),
                    audioChunks: []
                });

                // Listen to all users in the channel
                connection.receiver.speaking.on('start', (userId) => {
                    const audioStream = connection.receiver.subscribe(userId, {
                        end: {
                            behavior: EndBehaviorType.AfterSilence,
                            duration: 100
                        }
                    });

                    const opusDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
                    
                    audioStream.pipe(opusDecoder).on('data', (pcmData) => {
                        const rec = recordings.get(guildId);
                        if (rec) rec.audioChunks.push(pcmData);
                    });
                });

                return message.reply(`⏺️ Recording started in **${voiceChannel.name}** (format: ${format})\nUse \`.record stop\` to finish.`);
            } catch (e) {
                return message.reply(`❌ Error starting recording: ${e.message}`);
            }
        }

        if (action === 'stop') {
            const rec = recordings.get(guildId);
            if (!rec) {
                return message.reply('❌ No active recording in this server!');
            }

            const duration = Math.floor((Date.now() - rec.startTime) / 1000);
            
            try {
                // Combine all audio chunks
                const combinedBuffer = Buffer.concat(rec.audioChunks);
                
                // Convert PCM to desired format using ffmpeg
                const ffmpeg = spawn('ffmpeg', [
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2',
                    '-i', 'pipe:0',
                    '-acodec', rec.format === 'mp3' ? 'libmp3lame' : rec.format === 'aac' ? 'aac' : rec.format === 'm4a' ? 'aac' : 'pcm_s16le',
                    ...(rec.format === 'm4a' ? ['-f', 'mp4'] : []),
                    rec.outputPath
                ]);

                ffmpeg.stdin.write(combinedBuffer);
                ffmpeg.stdin.end();

                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        const sizeMB = (fs.statSync(rec.outputPath).size / (1024 * 1024)).toFixed(2);
                        message.reply(`✅ Recording saved: \`${rec.filename}\` (${duration}s, ${sizeMB} MB)\nLocation: \`data/recordings/\``);
                    } else {
                        message.reply(`⚠️ Recording finished but encoding failed (ffmpeg exit ${code})`);
                    }
                });

                rec.connection.destroy();
                recordings.delete(guildId);
            } catch (e) {
                recordings.delete(guildId);
                return message.reply(`❌ Error saving recording: ${e.message}`);
            }
        }
    }
};
