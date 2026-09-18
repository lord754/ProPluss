# Issue Investigation Notes

## Issues That Cannot Be Fixed Without Testing Environment

### Issue IV: Big5 Network Errors
**Status:** Requires Python environment and actual testing
**Root cause:** Unknown without running the Python scripts
**Action needed:** 
1. Install Python dependencies: `pip install -r requirements.txt` (if exists)
2. Check `big_5_v2/config.json` for correct port settings
3. Run `big_5_v2/main.py` and check actual error messages
4. Verify Discord API endpoints are still valid

### Issue V: Server Soundboard Not Loading  
**Status:** Requires testing if library supports soundboards
**Action needed:**
1. Check discord.js-selfbot-v13 v3.7.1 changelog
2. Test if `guild.soundboards` API exists
3. Verify dashboard routes are implemented

### Issue VI: Bounties Always Zero
**Status:** Requires Discord API investigation
**Likely cause:** Discord changed quest API or disabled for selfbots
**Action needed:**
1. Check Discord's quest API status
2. Test with fresh account
3. Verify parsing logic in `quests/questManager.js`

### Issue VII: Call Spam HTTP 405
**Status:** Discord likely deprecated endpoint
**Likely unfixable:** Discord removed selfbot call access
**Action needed:**
1. Check library changelog
2. Confirm Discord removed call endpoints for user accounts
3. Consider removing feature if unfixable

## Issues Already Addressed

### Issue II & III: Multi-Account Loading
**Status:** ALREADY WORKING
**How it works:**
- When no tokens exist, `/login` redirects to `/accounts`
- Accounts page shows "setup mode"
- Adding first token calls `global.bootClient` automatically
- Bot initializes and login becomes available

This is working as designed. The confusion may be that it takes a few seconds for the bot to initialize after adding the first token.

### Issue VIII: Updater Downloads All Files
**Status:** FIXED
**What was done:**
- Added git tree API call to fetch ALL files from commit
- Compares local files with commit tree
- Downloads missing files even if not in diff
- Downloads from specific commit SHA, not just main branch

### Issue IX: Duplicate Status Rotator
**Status:** FIXED (already done earlier)

### Issue X: Welcomer Toggle  
**Status:** FIXED (already done earlier)
