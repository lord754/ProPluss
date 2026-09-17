const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'rpc_presets.json');
const MAX = 100;
function load() { try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) {} return []; }
function save(list) { fs.writeFileSync(FILE, JSON.stringify(list, null, 2)); }
module.exports = {
    list: () => load(),
    upsert: (name, config) => {
        const list = load();
        const idx = list.findIndex(p => p.name === name);
        const entry = { name, config, savedAt: Date.now() };
        if (idx >= 0) list[idx] = entry; else { if (list.length >= MAX) return { error: `Max ${MAX} presets reached` }; list.push(entry); }
        save(list); return { ok: true };
    },
    delete: (name) => { save(load().filter(p => p.name !== name)); }
};
