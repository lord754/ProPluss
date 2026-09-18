# Voice & Music Features (Current Build)

This build adds the requested voice/music upgrades to the PRO+ dashboard.

## 1. Custom File Player — No Auto-Play
When you upload an MP3/MP4 file in the **Play Custom File** modal:
1. Click the file drop-zone and choose an `.mp3`, `.mp4`, `.m4a`, `.wav`, etc.
2. Click **Upload** (NOT "Upload & Play" — the button was renamed).
   A progress bar shows upload progress.
3. The server uploads your file to a free public host (tries catbox.moe first,
   falls back to tmpfiles.org if catbox rejects the IP).
4. **Playback does NOT start automatically.** Instead, a mode selector and
   a separate **Play Now** button appear in the modal.

## 2. Mode Selector — Manual vs Repeat
After a successful upload, choose how the file should play:

| Mode | Behavior |
|------|----------|
| ▶️ **Manual** | File plays once. Use the new Pause/Resume (⏸/▶) control in the player to pause and resume. Replay as many times as you want by hitting Skip/Prev or re-playing. Repeat is OFF. |
| 🔁 **Repeat** | File plays and auto-repeats forever (queue.repeatMode = 'loop'). Useful for ambient audio or rickrolls. |

The Pause/Resume button sits between Stop and Skip in the player controls.
When paused, the button turns green and shows a play icon. Click again to resume.

## 3. Louder Volume — 100% to 5000%
The volume slider now goes **0–5000%** (10× louder than before, up from 500%).
Quick preset buttons let you instantly jump to:

| Preset | Use case |
|--------|----------|
| 50% | Quiet listening |
| 100% | Default |
| 200% | Slightly louder |
| 500% | Loud |
| 1000% | Very loud |
| 2000% | Extreme |
| 5000% | Max — may distort or damage speakers/hearing. Use with caution. |

The slider drag-to-adjust behavior is unchanged.

## 4. Repeat Modes (unchanged)
Click the **Repeat** button (replaces the old "Loop" button) to open a modal
with four options:

| Mode | What it does |
|------|--------------|
| ▶️ **Once** | Play one time, then move to next track (default) |
| 🔂 **Loop Infinite** | Repeat the same track forever |
| 🔁 **Loop Queue** | After every track, push it to the back of the queue |
| 🔢 **Repeat N Times** | Play the track N times, then continue (set N=1..100 in the box) |

The Repeat button shows the current mode at a glance, plus a live `0/N` counter
when "Repeat N Times" is active.

## 5. Spammer (NEW)
A new **Spammer** page is accessible from the bottom-right Super Button menu.
It has two tabs:

### Spammer Tab
- **Mode**: Message Spam or Call Spam
- **Victim User ID**: target Discord user ID
- **Time**: two input boxes — `ms` and `sec`. They add together.
  Example: `1 ms` + `0 sec` = 1ms delay between actions.
- **Count**: how many times to repeat
- Optional **Message Content** (Message Spam mode only)

For **Call Spam**, each iteration:
1. Calls the victim via `POST /channels/{dmId}/call`
2. Immediately ends the call via `DELETE /channels/{dmId}/call`
3. Waits the configured delay
4. Repeats until count is reached

For **Message Spam**, each iteration:
1. Sends the configured message to the victim's DM
2. Waits the configured delay
3. Repeats until count is reached

Discord rate-limits very low delays (e.g. 1ms) automatically via the
selfbot library's internal queue.

### DM Purge Tab
Deletes your own messages in the DM with a victim user.

- **Victim User ID**: whose DM to purge your messages from
- **Count**: 
  - Positive number (e.g. `50`): deletes that many of your most recent messages
  - `-1` (infinity): deletes **ALL** your messages in that DM — paginates
    through the entire history and removes every message authored by you

The purge runs in the background with a 600ms safety delay between deletes
to avoid Discord rate-limit bans.

## 6. Quests — Bounties Button
A new **BOUNTIES** button sits next to **START ALL** in the Quest terminal.
When clicked, it triggers the same quest-completion flow but logs it as
"Starting BOUNTIES protocol — completing quests AND bounties...". Since the
`/quests/@me` endpoint returns both quests and bounties together, this
explicitly processes both.

The existing **START ALL**, **STOP ALL**, and **CLEAR** buttons work
exactly as before — no behavior changes.

## 7. Branding — Roxy → PRO
All references to "Roxy" / "Roxy+" have been replaced with "PRO" / "PRO+".
This includes:
- Browser tab titles (e.g. `PRO+ Dashboard`, `PRO+ Voice`, `PRO+ Quest Terminal`)
- The Hub menu header ("PRO+ Hub")
- Lavalink client name (`PROPlus`)
- Console startup message ("PRO+ is ready!")
- RPC default name ("PRO+")
- AI assistant default name ("PRO")
- User-Agent strings in file upload (`PROPlus/1.0`)
- README and docs

## 8. Owner Profile on Dashboard
The main dashboard's right-side panel now shows the lanyard status card for
Discord user ID `995171384344973393` (the new owner). The previous "made with
<3 by it's manish" creator text has been removed.

The lanyard API (`lanyard.cnrad.dev`) automatically fetches and displays
the user's profile picture, username, and current Discord presence for the
given ID — so the dashboard now reflects the new owner's live status.

## Files Modified
- `dashboard/views/partials/super_button.ejs` — Music → Voice label, added Spammer menu item, "PRO+ Hub" header
- `dashboard/views/music.ejs` — Upload button renamed, mode selector + Play Now button, Pause/Resume control, volume slider extended to 5000%, new volume presets
- `dashboard/views/index.ejs` — Lanyard ID changed to 995171384344973393, creator text removed
- `dashboard/views/quest.ejs` — Added BOUNTIES button + startBounties() JS function
- `dashboard/views/spammer.ejs` (NEW) — Full Spammer + DM Purge UI with tabs
- `dashboard/index.js` — Volume validation 0-5000, new `/api/music/pause` endpoint, `/api/music/status` now exposes `paused`, new `/api/spammer/*` endpoints, new `/api/spammer/purge/*` endpoints, new `/quest/start-bounties` route, new `/spammer` view route, `paused` field added to queue state
- `music/queue.js` — Added `paused` field to queue creation
- `index.js` — Lavalink client name → PROPlus, startup log → "PRO+ is ready!"
- `commands/aiManager.js` — AI default name → "PRO"
- `commands/rpcManager.js` — RPC default name → "PRO+"
- `README.md` — Rebranded + removed "By it's Manish" + new lanyard ID
- `package.json` — Rebranded name/description
- All `.ejs` view titles — "Roxy+" → "PRO+"

## Setup
1. Unzip this folder
2. Run `npm install`
3. Edit `.env`:
   - `TOKEN=` your Discord selfbot token
   - `PORT=` the port for the dashboard (e.g. `3000`)
   - `APP_USER=` / `APP_PASS=` dashboard login
   - Keep the Lavalink lines as-is (uses public Lavalink)
4. `npm start`
5. Open `http://localhost:PORT` in your browser, log in, click the bottom-right
   Super Button → Voice / Quests / Spammer.

[//]: # (// v2.2.1a)
