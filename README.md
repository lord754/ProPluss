# PRO+ Discord Selfbot

**Version 2.0.0d — Developer Stable Release**

Advanced Discord selfbot with dashboard, voice features, Big5 toolkit, multi-account support, and extensive automation.

## ✨ Features

- 🎮 **Rich Presence (RPC)** — Custom game status, streaming, Spotify-style presence
- 🎵 **Music Player** — Play music in voice channels with queue management
- 💬 **Auto Messaging** — Timed messages, auto-reply, mimic, clipboard sync
- 🖼️ **Welcomer System** — Customizable welcome cards with live images
- 🤖 **AI Integration** — OpenAI GPT chat, image generation
- ⚔️ **Quest System** — Discord quest automation and bounty tracking
- 🔄 **Server Cloner** — Full server backup and restoration
- 💣 **Spam Tools** — Message bomber, call spam, raid utilities
- 📊 **Dashboard** — Web-based control panel on `localhost:8080`
- 👥 **Multi-Account** — Switch between multiple Discord accounts seamlessly
- 🔧 **Big5 Toolkit** — Advanced features via Python scripts (nuker, raid, token tools)

## 🚀 Quick Start

### Using Installer (Recommended)
1. Download `installer.js` from [Releases](https://github.com/lord754/ProPluss/releases)
2. Run: `node installer.js`
3. Done! Installer handles everything and self-deletes

### Manual Installation
```bash
# Clone the repository
git clone https://github.com/lord754/ProPluss.git
cd ProPluss

# Install dependencies
npm install

# Configure your token
cp .env.example .env
# Edit .env and add your Discord token

# Start the bot
node index.js
```

## 🔐 Configuration

Create a `.env` file:
```env
DISCORD_TOKEN=your_discord_token_here
OPENAI_API_KEY=your_openai_key_here  # Optional, for AI features
```

For multi-account support, add tokens to `tokens.env`:
```
token1_here
token2_here
token3_here
```

## 📖 Usage

Once running, access the dashboard at: **http://localhost:8080**

Default prefix: `.` (customizable)

Example commands:
```
.help          — Show all commands
.help extra    — Show Big5 features
.ping          — Check bot latency
.play <song>   — Play music in voice
.rpc           — Set custom Rich Presence
.ai <prompt>   — Chat with AI
```

## 🛠️ Requirements

- **Node.js** v20 or newer
- **npm** (comes with Node.js)
- **Git** (for installer and updates)
- **Python 3.8+** (optional, for Big5 features)
- **FFmpeg** (for voice features, installed automatically)

## 📦 Updating

From the dashboard Updater page or run:
```bash
git pull origin main
npm install
```

## ⚠️ Disclaimer

**This is a selfbot** — running a selfbot violates Discord's Terms of Service. Use at your own risk. This project is for educational purposes only.

- Self-botting can result in account termination
- Automated actions may trigger rate limits or bans
- The developers are not responsible for any consequences

## 📝 Version 2.0.0d Changes

See [CHANGELOG_v2.0.0d.md](./CHANGELOG_v2.0.0d.md) for full release notes.

**Key Updates:**
- Status rotator consolidated to dashboard home
- Welcomer system now has global enable/disable toggle
- Known issues documented for Big5, voice features, and multi-account
- Planned features outlined for future releases

## 🐛 Known Issues

- Big5 features returning network errors (under investigation)
- Server soundboard not loading in voice
- Video/voice call spam returning HTTP 405
- Multi-account doesn't pre-load on login

See CHANGELOG for full list and workarounds.

## 🤝 Contributing

This is a developer stable release. Bug reports and feature suggestions welcome!

## 📄 License

ISC License — See package.json

---

**Repository:** https://github.com/lord754/ProPluss  
**Issues:** https://github.com/lord754/ProPluss/issues
