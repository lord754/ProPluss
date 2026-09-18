# PRO+ v2.0.0d — Development Roadmap

## ✅ Completed (Pushed to GitHub)

1. **Version bump** to 2.0.0d
2. **Status rotator consolidation** — Removed duplicate `/commands/status-rotator` route and `cmd_status_rotator.ejs` file; rotator now only in dashboard home
3. **Welcomer toggle** — Added global enable/disable switch with persistent state check in `guildMemberAdd` event
4. **Documentation** — Created README.md and CHANGELOG_v2.0.0d.md

## 🔴 Critical Issues Requiring Investigation

### Issue II & III: Multi-Account Pre-Login Loading
**Problem:** Tokens don't load before login, and adding a token doesn't initialize the login screen.

**Files to check:**
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\accountManager.js`
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\dashboard\views\accounts.ejs`
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\dashboard\views\login.ejs`

**Investigation needed:**
1. Does `accountManager.getAccounts()` read from `tokens.env` on first load?
2. Is the login route checking for existing tokens before rendering?
3. Does adding a token via dashboard trigger a client reinit?

---

### Issue IV: Big5 Network Errors
**Problem:** All big5_v2 Python scripts return "network error" even on localhost.

**Files to check:**
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\big_5_v2\main.py` (425 KB — very large)
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\big_5_v2\config.json`
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\commands\big5.js`

**Likely causes:**
1. Port mismatch between Node.js server and Python scripts
2. Python script not finding the Discord API properly
3. Missing or incorrect config in `big_5_v2/config.json`
4. Python dependencies not installed (`pip install -r requirements.txt` if one exists)

**Action:** Read `main.py` headers and `config.json` to identify the localhost port/endpoint expectations.

---

### Issue V: Server Soundboard Not Loading
**Problem:** Voice soundboard feature doesn't load server soundboards.

**Files to check:**
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\dashboard\views\music.ejs` (82 KB)
- Voice-related routes in `dashboard\index.js`
- Discord.js-selfbot-v13 soundboard API

**Investigation needed:**
1. Does `discord.js-selfbot-v13` v3.7.1 support guild soundboard fetching?
2. Is the endpoint `/api/voice/soundboards` implemented?
3. Are permissions correct for fetching guild soundboards?

---

### Issue VI: No Bounties Showing
**Problem:** Quest system always shows zero bounties available.

**Files to check:**
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\quests\questManager.js`
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\quests\client.js`
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\dashboard\views\quest.ejs`

**Investigation needed:**
1. Is the quest API still returning bounties (Discord may have changed endpoint)?
2. Is the parsing logic outdated?
3. Are bounties region-locked or require specific account state?

---

### Issue VII: Video/Voice Call Spam HTTP 405
**Problem:** Call endpoints returning "405: Method Not Allowed"

**Error log:**
```
[10:27:37 AM] Started VIDEOCALL spam -- victim=739118216357347348, count=5, delay=1000ms
[10:27:39 AM] Call HTTP 405: {"message": "405: Method Not Allowed", "code": 0}
```

**Likely cause:** Discord deprecated the call initiation endpoint used by the selfbot library.

**Files to check:**
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\dashboard\views\spammer.ejs`
- Call-related routes in `dashboard\index.js`
- `discord.js-selfbot-v13` library version and changelog

**Action:** Check if library has an updated call API or if Discord removed selfbot call access entirely.

---

### Issue VIII: Updater Only Downloads Committed Files
**Problem:** "Apply old" doesn't download files that exist in the old version but are missing locally.

**Files to check:**
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\updater.js` (21 KB)
- `C:\agfiles\vs code\ProPluss-main\ProPluss-main\dashboard\views\cmd_updater.ejs` (26 KB)

**Current behavior:** Only committed files in the current version are downloaded.  
**Expected behavior:** When applying an old version, download ALL files from that version's commit.

**Action:** Modify the download logic to use `git diff --name-only` between commits and fetch missing files.

---

## 🚀 Features to Implement

### Feature I: Enhanced Updater with Progress Indicator
**Requirements:**
- `git pull` from repo
- File-by-file code checking and smart diffing
- Visual progress: "1/20 Pulling, 2/20 Checking index.js, 3/20 Committing index.js"
- Percentage-based (5% per task if 20 tasks, 2% if 50 tasks)
- Preserve logs during update

**Files to modify:**
- `updater.js` — Add git pull + diff logic
- `dashboard/views/cmd_updater.ejs` — Add circular progress indicator (CSS + JS)

**Implementation:**
1. Add a `/api/updater/pull-and-check` endpoint
2. Stream progress events using Server-Sent Events (SSE) or polling
3. Frontend: Circular SVG progress indicator with task labels

---

### Feature II: Installer.js as Separate Release Asset
**Current state:** `installer.js` is in the repo.  
**Desired state:** Upload as a GitHub release asset only, exclude from main repo.

**Action:**
1. Add `installer.js` to `.gitignore`
2. When creating v2.0.0d release, upload `installer.js` as an asset manually or via GitHub API
3. Remove `installer.js` from the repo after upload

---

### Feature III: Voice Recorder
**Requirements:**
- Record voice channel audio
- Format selector: mp3 (default), m4a, aac, wav
- Start/Stop recording buttons
- Save recordings with timestamps

**Files to create/modify:**
- New: `commands/voiceRecorder.js` — Recording logic using `@discordjs/voice` and `prism-media`
- Modify: `dashboard/views/music.ejs` — Add recorder UI section
- Add route: `/api/voice/recorder/start`, `/api/voice/recorder/stop`

**Technical notes:**
- Use `AudioReceiveStream` from `@discordjs/voice`
- Pipe to ffmpeg for format conversion
- Save to `data/recordings/` with format: `recording_YYYY-MM-DD_HH-MM-SS.mp3`

---

### Feature IV: Enhanced Help Command
**Requirements:**
- Embed-based output
- Prefix-aware (read from config)
- `.help extra` for big5 features
- Pagination: `.help extra 5` for page 5
- Update reference: `tokens2.txt` → `tokens.env`

**Files to modify:**
- `commands/help.js` — Rewrite to use embeds and pagination
- Add new command: `commands/helpExtra.js` for big5 features

**Implementation:**
```javascript
if (args[0] === 'extra') {
  const page = parseInt(args[1]) || 1;
  const itemsPerPage = 5;
  const big5Commands = [/* list from big5.js */];
  const start = (page - 1) * itemsPerPage;
  const pageItems = big5Commands.slice(start, start + itemsPerPage);
  // Build embed with pageItems and footer showing "Page X/Y"
}
```

---

### Feature V: Settings Command for Environment Changer
**Requirements:**
- New command accessible via commands menu
- Replaces scattered environment configuration
- Should modify `.env` file programmatically

**Files to create:**
- `commands/settings.js` — Environment variable manager
- `dashboard/views/cmd_settings.ejs` — UI for editing .env
- Add route: `/commands/settings`, `/api/settings`

**Security note:** 
- Do NOT expose `DISCORD_TOKEN` in the UI (mask it)
- Only allow editing safe variables (PREFIX, OPENAI_KEY, etc.)
- Validate inputs to prevent injection

---

## 🔧 Technical Debt

1. **Config Reset Logic** — Document which configs to preserve vs delete for the "index update"
2. **Error Handling** — Many routes lack try-catch or return generic errors
3. **Code Duplication** — Multiple files reload managers (`require('../commands/...')`) on every request
4. **Type Safety** — No JSDoc or TypeScript types
5. **Testing** — No test suite exists

---

## 📋 Next Steps

### Immediate (High Priority)
1. Investigate Issue IV (Big5 network errors) — blocking all Python features
2. Fix Issue VII (Call spam 405) — likely API deprecation
3. Implement Feature I (Enhanced updater) — most requested feature

### Short Term (This Week)
4. Fix Issue II & III (Multi-account loading)
5. Investigate Issue V (Soundboard) and Issue VI (Bounties)
6. Implement Feature IV (Enhanced help command)

### Medium Term (Next 2 Weeks)
7. Implement Feature III (Voice recorder)
8. Implement Feature V (Settings command)
9. Fix Issue VIII (Updater download logic)
10. Create automated tests for critical features

### Long Term
11. Refactor dashboard routing for better organization
12. Add rate limiting to prevent Discord API abuse
13. Implement proper logging system with rotation
14. Create admin dashboard for monitoring multiple instances

---

## 📌 Notes

- **Memory constraints:** Host has ~1.1 GB free — avoid heavy concurrent operations
- **Selfbot risks:** This project violates Discord ToS; users accept all liability
- **Python dependency:** Big5 features require Python 3.8+ and specific packages
- **Node version:** Requires Node.js v20+ (canvas and voice features)

---

**Last Updated:** 2026-09-18  
**Maintainer:** Development Team  
**Repository:** https://github.com/lord754/ProPluss

[//]: # (// v2.2.1a)
