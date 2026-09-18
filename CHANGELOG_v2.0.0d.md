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
7. **Comprehensive Documentation** — README.md, CHANGELOG, DEVELOPMENT_ROADMAP.md, IMPLEMENTATION_STATUS.md

### 🔧 Known Issues (To Be Addressed)

#### Dashboard & UI
- **Issue I:** Duplicate status change buttons in dashboard (partially resolved - rotator consolidated)
- **Issue II:** Multi-account tokens don't load before login screen
- **Issue III:** Token addition before login doesn't initialize login screen

#### Big5 Features
- **Issue IV:** All big5 features returning "network error" even on localhost
  - Affects: big5_v2 Python scripts (main.py, gct.py, sgct.py, etc.)
  - May require port/endpoint configuration check

#### Voice Features  
- **Issue V:** Server soundboard not loading in voice channels
- **Issue VI:** Quest bounties always showing as empty/none available
- **Issue VII:** Video call & voice call spam returning HTTP 405 Method Not Allowed
  - Discord API may have deprecated the call endpoints
  - Requires investigation of alternate calling methods

#### Updater
- **Issue VIII:** Update system only downloads committed files in "apply latest"
  - "Apply old" should also download missing files from selected version

### 🚀 Planned Features (Not Yet Implemented)

#### Feature I: Enhanced Updater
- Git pull from repo with file-by-file code checking
- Visual progress indicator showing: "1/20 Pulling, 2/20 Checking index.js, 3/20 Committing Index.js"
- Percentage-based progress (5% per task for 20 tasks, 2% for 50 tasks, etc.)
- Preserve logs folder during updates
- Smart code diffing (add/delete only changed lines)

#### Feature II: Installer Distribution
- Add installer.js as separate GitHub release asset
- Auto-deletion after successful setup
- Support for legacy users with file upload workflows
- Exclude installer from main repository

#### Feature III: Voice Recorder
- Record voice channel audio
- Format options: mp3 (default), m4a, aac, wav
- Start/Stop recording controls in voice section
- Auto-save recordings with timestamps

#### Feature IV: Enhanced Help Command
- Embed-based help system
- Prefix-aware (e.g., `.help` if prefix is `.`)
- `.help extra` for big5 features with pagination
- `.help extra 5` for page navigation
- Reference: tokens2.txt → tokens.env

#### Feature V: Settings Command
- New command for environment configuration
- Accessible via commands menu
- Replace scattered environment changers

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

## ⚠️ Breaking Changes

- **Config Reset:** This is an index update. All config files will be reset except:
  - `.env` (preserved)
  - `tokens.env` (preserved)
  - Logs (preserved)
  - All other config in `config/` folder will be deleted for clean slate

## 🐛 Bug Reports

Found an issue? Please report with:
- OS & Node version
- Exact error message
- Steps to reproduce
- Expected vs actual behavior

## 📝 Notes

This is a **Developer Stable Release** intended for testing and feedback. Some features are documented but not yet implemented. Stability improvements and feature completions will follow in subsequent patches.

---

**Full Changelog:** https://github.com/lord754/ProPluss/commits/main
