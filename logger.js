

// Store original console methods
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function formatMessage(args) {
    return args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return arg instanceof Error ? arg.stack || arg.message : JSON.stringify(arg, null, 2);
            } catch (e) {
                return '[Circular Object or Error stringifying]';
            }
        }
        return String(arg);
    }).join(' ');
}

// Webhook rate-limit: max 1 request per 5 seconds, only errors/warns
let _webhookLastSent = 0;
let _webhookQueue = [];
let _webhookTimer = null;

function flushWebhookQueue() {
    _webhookTimer = null;
    if (_webhookQueue.length === 0) return;
    const { content, type } = _webhookQueue.shift();
    _sendWebhook(content, type);
    if (_webhookQueue.length > 0) {
        _webhookTimer = setTimeout(flushWebhookQueue, 5000);
    }
}

function sendToWebhook(content, type) {
    const webhookUrl = process.env.WEBHOOK;
    if (!webhookUrl) return;
    // Only forward errors and warnings to webhook — skip routine logs to avoid spam
    if (type === 'log') return;
    _webhookQueue.push({ content, type });
    if (_webhookQueue.length > 20) _webhookQueue = _webhookQueue.slice(-20); // cap queue
    if (!_webhookTimer) _webhookTimer = setTimeout(flushWebhookQueue, 5000);
}

function _sendWebhook(content, type) {
    const webhookUrl = process.env.WEBHOOK;
    if (!webhookUrl) return;

    const colors = { warn: 0xf1c40f, error: 0xe74c3c };
    const title = type === 'warn' ? 'Terminal Warning' : 'Terminal Error';
    let description = content.length > 4000 ? content.substring(0, 4000) + '\n...[TRUNCATED]' : content;

    const payload = JSON.stringify({
        embeds: [{ title, description: '```js\n' + description + '\n```', color: colors[type] || 0x3498db, timestamp: new Date().toISOString() }]
    });

    const https = require('https');
    const { URL } = require('url');
    try {
        const parsedUrl = new URL(webhookUrl);
        const req = https.request({
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        });
        req.on('error', () => {}); // silently ignore webhook send failures
        req.write(payload);
        req.end();
    } catch (_) {}
}

function initLogger() {
    console.log = function (...args) {
        originalLog.apply(console, args);
        sendToWebhook(formatMessage(args), 'log');
    };

    console.error = function (...args) {
        originalError.apply(console, args);
        sendToWebhook(formatMessage(args), 'error');
    };

    console.warn = function (...args) {
        originalWarn.apply(console, args);
        sendToWebhook(formatMessage(args), 'warn');
    };
}

module.exports = { initLogger };

// v2.2.1a
