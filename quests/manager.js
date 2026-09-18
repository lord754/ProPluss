const { ClientQuest } = require('./client');

class QuestManagerBridge {
    constructor(token) {
        this.token = token.replace('Bot ', '');
        this.client = new ClientQuest(this.token);

        this.client.connect().catch(err => {
            this.log('system', `Gateway Error: ${err.message}`);
        });

        this.globalLogs = [];
        this.activeManager = null;
        this.isRunning = false;
    }

    get activeQuests() { return new Map(); }

    log(questId, msg) {
        let line = '';
        const time = new Date().toLocaleTimeString();

        if (msg) {
            line = msg;
        } else {
            line = questId;
        }

        if (!line.startsWith('[')) {
            line = `[${time}] ${line}`;
        }

        this.globalLogs.push(line);
        if (this.globalLogs.length > 500) this.globalLogs.shift();
    }

    clearLogs() {
        this.globalLogs = [];
        this.log('system', 'Logs cleared.');
    }

    async startAll() {
        if (this.isRunning) {
            this.log('system', 'Already running.');
            return;
        }

        this.isRunning = true;
        this.log('system', 'Starting Quest Protocol...');

        try {
            const manager = await this.client.fetchQuests();
            this.activeManager = manager;
            manager.setLogger((msg) => this.log(msg));

            const valid = manager.filterQuestsValid();
            const quests = valid.filter(q => !q.isBounty);
            const bounties = valid.filter(q => q.isBounty);

            this.log('system', `Found ${quests.length} quest(s) and ${bounties.length} bounty(s).`);

            if (valid.length === 0) {
                this.log('system', 'No quests or bounties to do.');
                this.isRunning = false;
                return;
            }

            const run = async (q) => {
                await new Promise(r => setTimeout(r, Math.random() * 5000));
                try { await manager.doingQuest(q); }
                catch (e) { if (e.message !== 'Stopped') this.log(q.id, `Error: ${e.message}`); }
            };

            if (quests.length > 0) {
                this.log('system', 'Processing quests...');
                await Promise.all(quests.map(run));
                this.log('system', 'All quests done.');
            }

            if (bounties.length > 0 && !manager.stopped) {
                this.log('system', 'Now processing bounties...');
                await Promise.all(bounties.map(run));
                this.log('system', 'All bounties done.');
            }

            this.log('system', 'All finished.');

        } catch (error) {
            this.log('system', `Critical Error: ${error.message}`);
        } finally {
            this.isRunning = false;
            this.activeManager = null;
        }
    }

    async startBountiesOnly() {
        if (this.isRunning) {
            this.log('system', 'Already running.');
            return;
        }
        this.isRunning = true;
        this.log('system', 'Starting Bounties-Only Protocol...');
        try {
            const manager = await this.client.fetchQuests();
            this.activeManager = manager;
            manager.setLogger((msg) => this.log(msg));
            const valid = manager.filterQuestsValid();
            const bounties = valid.filter(q => q.isBounty);
            this.log('system', `Found ${bounties.length} bounty(s).`);
            if (bounties.length === 0) {
                this.log('system', 'No bounties available right now.');
                this.isRunning = false;
                return;
            }
            await Promise.all(bounties.map(async (q) => {
                await new Promise(r => setTimeout(r, Math.random() * 5000));
                try { await manager.doingQuest(q); }
                catch (e) { if (e.message !== 'Stopped') this.log(q.id, `Error: ${e.message}`); }
            }));
            this.log('system', 'All bounties done.');
        } catch (error) {
            this.log('system', `Critical Error: ${error.message}`);
        } finally {
            this.isRunning = false;
            this.activeManager = null;
        }
    }

    stopAll() {
        if (this.activeManager) {
            this.activeManager.stopAll();
            this.log('system', 'Stopping all tasks immediately...');
        } else {
            this.log('system', 'Nothing to stop.');
        }
    }
}

module.exports = QuestManagerBridge;
