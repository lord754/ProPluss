#!/usr/bin/env node
/**
 * PRO+ Installer
 * ──────────────
 * 1. Checks for Git — installs it if missing (Windows: winget / choco / manual prompt)
 * 2. Clones https://github.com/lord754/ProPluss.git  (or pulls if already cloned)
 * 3. Checks node_modules — runs `npm install` only if missing or incomplete
 * 4. Launches `node index.js`
 * 5. Self-deletes after a successful launch
 *
 * Run:  node installer.js
 */

const { execSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const REPO_URL    = 'https://github.com/lord754/ProPluss.git';
const REPO_DIR    = path.join(process.cwd(), 'ProPluss');
const SELF        = __filename;

// ── helpers ────────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`\x1b[36m[PRO+ Installer]\x1b[0m ${msg}`); }
function ok(msg)   { console.log(`\x1b[32m[✔]\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[33m[!]\x1b[0m ${msg}`); }
function err(msg)  { console.error(`\x1b[31m[✘]\x1b[0m ${msg}`); }

function run(cmd, opts = {}) {
    return execSync(cmd, { stdio: 'inherit', ...opts });
}

function commandExists(cmd) {
    try {
        const check = os.platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`;
        execSync(check, { stdio: 'pipe' });
        return true;
    } catch { return false; }
}

// ── Step 1: Ensure Git is installed ────────────────────────────────────────────

function ensureGit() {
    if (commandExists('git')) {
        ok('Git is already installed.');
        return;
    }

    warn('Git not found. Attempting to install…');

    const platform = os.platform();

    if (platform === 'win32') {
        // Try winget first, then choco, then manual
        if (commandExists('winget')) {
            log('Installing Git via winget…');
            run('winget install --id Git.Git -e --source winget --silent');
        } else if (commandExists('choco')) {
            log('Installing Git via Chocolatey…');
            run('choco install git -y');
        } else {
            err('Cannot auto-install Git. Please install it manually from https://git-scm.com/download/win and re-run this installer.');
            process.exit(1);
        }
    } else if (platform === 'darwin') {
        log('Installing Git via Homebrew…');
        if (!commandExists('brew')) {
            err('Homebrew not found. Install Homebrew first: https://brew.sh');
            process.exit(1);
        }
        run('brew install git');
    } else {
        // Linux — try common package managers
        if (commandExists('apt-get')) {
            run('sudo apt-get install -y git');
        } else if (commandExists('dnf')) {
            run('sudo dnf install -y git');
        } else if (commandExists('pacman')) {
            run('sudo pacman -S --noconfirm git');
        } else {
            err('Cannot auto-install Git on this system. Please install git manually and re-run.');
            process.exit(1);
        }
    }

    if (!commandExists('git')) {
        err('Git installation failed. Please install git manually and re-run.');
        process.exit(1);
    }
    ok('Git installed successfully.');
}

// ── Step 2: Clone or pull the repo ─────────────────────────────────────────────

function cloneOrPull() {
    if (fs.existsSync(path.join(REPO_DIR, '.git'))) {
        log('Repository already exists — pulling latest changes…');
        run('git pull', { cwd: REPO_DIR });
        ok('Repository updated.');
    } else {
        log(`Cloning ${REPO_URL} …`);
        run(`git clone "${REPO_URL}" "${REPO_DIR}"`);
        ok('Repository cloned.');
    }
}

// ── Step 3: npm install (skip if node_modules is complete) ─────────────────────

function nodeModulesComplete(dir) {
    const nmPath  = path.join(dir, 'node_modules');
    const pkgPath = path.join(dir, 'package.json');

    if (!fs.existsSync(nmPath)) return false;

    // Quick check: every top-level dependency listed in package.json must exist
    try {
        const pkg  = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
        for (const dep of deps) {
            if (!fs.existsSync(path.join(nmPath, dep))) {
                warn(`Missing module: ${dep}`);
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

function ensureModules() {
    if (nodeModulesComplete(REPO_DIR)) {
        ok('node_modules is complete — skipping npm install.');
    } else {
        log('Running npm install…');
        run('npm install', { cwd: REPO_DIR });
        ok('npm install complete.');
    }
}

// ── Step 4: Launch the bot ─────────────────────────────────────────────────────

function launch() {
    log('Starting PRO+ (node index.js)…');

    const child = spawn('node', ['index.js'], {
        cwd:   REPO_DIR,
        stdio: 'inherit',
        detached: false,
    });

    child.on('error', (e) => {
        err(`Failed to start: ${e.message}`);
        process.exit(1);
    });

    // Self-delete once the child process is up (give it 2 s to confirm it started)
    setTimeout(() => selfDelete(), 2000);

    child.on('exit', (code) => {
        if (code !== 0) {
            err(`node index.js exited with code ${code}`);
        }
    });
}

// ── Step 5: Self-delete ────────────────────────────────────────────────────────

function selfDelete() {
    try {
        fs.unlinkSync(SELF);
        ok('installer.js removed — installation complete!');
    } catch (e) {
        warn(`Could not self-delete installer.js: ${e.message}`);
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────

(async function main() {
    console.log('\n\x1b[35m╔══════════════════════════════════╗');
    console.log('║   PRO+ Selfbot  —  Installer     ║');
    console.log('╚══════════════════════════════════╝\x1b[0m\n');

    try {
        ensureGit();
        cloneOrPull();
        ensureModules();
        launch();
    } catch (e) {
        err(`Installation failed: ${e.message}`);
        process.exit(1);
    }
})();
