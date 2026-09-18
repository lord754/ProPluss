# PRO+ v2.0.0d — Developer Stable Release

**Release Date:** September 18, 2026  
**Type:** Major Update — Developer Index Stable Release

## 🎯 What's New

### ✅ Completed in This Release

1. **Version 2.0.0d** — Bumped to Developer Stable Release
2. **Status Rotator Consolidation** — Removed duplicate status rotator page; now only accessible from dashboard home
3. **Welcomer Toggle** — Added global enable/disable switch for welcomer system with persistent state
4. **Enhanced Help Command** — Rewrote help with Discord embeds, added `.help extra` for Big5 features with pagination (`.help extra 5` for page 5)
5. **Settings Command** — New command and dashboard page for managing environment variables (PREFIX, OPENAI_API_KEY)
6. **Installer.js Separation** — Excluded from main repo, available as release asset only
7. **Voice Recorder** — New `.record start/stop` command to record voice channels in mp3/m4a/aac/wav formats
8. **Updater Enhancement** — Fixed "apply old" to download ALL files from a version, not just changed files
9. **Comprehensive Documentation** — README.md, CHANGELOG, DEVELOPMENT_ROADMAP.md, IMPLEMENTATION_STATUS.md, INVESTIGATION_NOTES.md

### 🔧 Known Issues (Require Testing/Investigation)

#### Issues II & III: Multi-Account Pre-Login
**Status:** System already works as designed
- When no tokens exist, redirects to accounts page automatically
- Adding first token triggers automatic bot initialization
- May take a few seconds to initialize after adding token

#### Issue IV: Big5 Network Errors
**Status:** Requires Python environment testing
- All big5_v2 Python scripts returning "network error"
- Likely: port mismatch or missing Python dependencies
- See INVESTIGATION_NOTES.md for debugging steps

#### Issue V: Server Soundboard Not Loading
**Status:** Requires library API check
- discord.js-selfbot-v13 may not support soundboard API
- Need to verify if endpoint exists in library

#### Issue VI: Quest Bounties Always Zero
**Status:** Discord API may have changed
- Quest system shows no bounties available
- Requires investigation of Discord's quest API changes

#### Issue VII: Call Spam HTTP 405
**Status:** Discord likely deprecated endpoint
- Video/voice call spam returning "405 Method Not Allowed"
- May be unfixable if Discord removed selfbot call access

### 🚀 Planned Features (Future Releases)

#### Feature I: Enhanced Updater with Progress Indicator
- Git pull integration with file-by-file checking
- Visual circular progress indicator
- Percentage-based updates
- Smart line-level code diffing
**Estimated effort:** 4-6 hours

## 📦 Installation

### New Users
1. Download `installer.js` from releases
2. Run `node installer.js`
3. Installer handles: Git install → Clone repo → npm install → Launch → Self-delete

### Existing Users
```bash
git pull origin main
npm install
node index.js
```

## 🎮 New Features Usage

### Voice Recorder
```
.record start mp3     # Start recording in mp3 format
.record start wav     # Start recording in wav format
.record stop          # Stop and save recording
```
Recordings saved to `data/recordings/` with timestamps.

### Enhanced Help
```
.help                 # Show all command categories
.help music           # Show music commands
.help extra           # Show Big5 features (page 1)
.help extra 3         # Show Big5 features page 3
```

### Settings Command
```
.settings prefix !    # Change prefix to !
```
Or visit: http://localhost:8080/commands/settings

## ⚠️ Breaking Changes

- **Config Reset:** This is an index update. All config files will be reset except:
  - `.env` (preserved)
  - `tokens.env` (preserved)
  - Logs (preserved)

## 🐛 Bug Reports

Found an issue? Please report with:
- OS & Node version
- Exact error message
- Steps to reproduce
- Expected vs actual behavior

## 📝 Notes

This is a **Developer Stable Release** — all core features are implemented and tested. Issues marked as "requires investigation" need specific testing environments (Python for Big5, live Discord API for calls/bounties).

---

**Full Changelog:** https://github.com/lord754/ProPluss/commits/main  
**Documentation:** See README.md, DEVELOPMENT_ROADMAP.md, IMPLEMENTATION_STATUS.md
