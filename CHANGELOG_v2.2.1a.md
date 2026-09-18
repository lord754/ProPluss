# CHANGELOG — v2.2.1a ALPHA

## Fixes

### Critical: `Err:99 Identifier 'fs' has already been declared`
- **File:** `updater.js`
- Removed duplicate `const fs = require('fs')` declaration on line 2 that crashed the anti-crash handler on every startup.

### Critical: AI `410 status code` errors (model deprecated)
- **File:** `commands/aiManager.js`
- Replaced removed NVIDIA NIM models:
  - `moonshotai/kimi-k2-thinking` → `meta/llama-3.3-70b-instruct` (slow/default)
  - `moonshotai/kimi-k2-instruct-0905` → `meta/llama-3.1-8b-instruct` (fast)
- Added proper error handling for 410 (model gone), 404, 401, 429 with user-friendly replies instead of silent failures.

### Known: Discord API 405 on call spam
- Discord returns HTTP 405 for `POST /channels/{id}/call` on certain account types.
- The existing PATCH fallback handles this. The 405 is from Discord's API, not the bot's Express server.
