// ==========================================
// BADMINTON MATCH SCHEDULER - PWA (FIXED)
// ==========================================

const App = {
    // State
    sessionPlayers: [],
    savedPlayers: [],
    courts: 0,
    rounds: [],
    currentRound: 0,
    pairingHistory: {},
    opponentHistory: {},
    playerStats: {},
    restRequests: new Set(),
    presentPlayers: new Set(),
    shuffleCount: 0,
    maxShuffles: 5,
    statsSnapshot: null,

    // ==========================================
    // INITIALIZATION
    // ==========================================
    init() {
        this.loadSavedPlayers();
        this.bindEvents();
        this.renderSavedPlayers();
        this.registerSW();
    },

    registerSW() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(() => console.log('SW registered'))
                .catch(err => console.log('SW registration failed:', err));
        }
    },

    // ==========================================
    // LOCAL STORAGE
    // ==========================================
    loadSavedPlayers() {
        try {
            const saved = localStorage.getItem('badminton_saved_players');
            this.savedPlayers = saved ? JSON.parse(saved) : [];
        } catch (e) {
            this.savedPlayers = [];
        }
    },

    savePlayers() {
        const allNames = [...new Set([...this.savedPlayers, ...this.sessionPlayers])];
        this.savedPlayers = allNames;
        localStorage.setItem('badminton_saved_players', JSON.stringify(allNames));
    },

    // ==========================================
    // EVENT BINDING
    // ==========================================
    bindEvents() {
        document.getElementById('add-player-btn').addEventListener('click', () => this.addPlayer());
        document.getElementById('player-name-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlayer();
        });

        document.querySelectorAll('.btn-court').forEach(btn => {
            btn.addEventListener('click', (e) => this.selectCourts(parseInt(e.target.dataset.courts)));
        });

        document.getElementById('start-session-btn').addEventListener('click', () => this.startSession());
        document.getElementById('generate-round-btn').addEventListener('click', () => this.generateRound());
        document.getElementById('back-to-setup-btn').addEventListener('click', () => this.showScreen('screen-setup'));
        document.getElementById('next-round-btn').addEventListener('click', () => this.nextRound());
        document.getElementById('shuffle-round-btn').addEventListener('click', () => this.shuffleRound());
        document.getElementById('end-session-btn').addEventListener('click', () => this.endSession());
        document.getElementById('new-session-btn').addEventListener('click', () => this.newSession());
    },

    // ==========================================
    // SCREEN MANAGEMENT
    // ==========================================
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
        window.scrollTo(0, 0);
    },

    // ==========================================
    // PLAYER MANAGEMENT
    // ==========================================
    addPlayer() {
        const input = document.getElementById('player-name-input');
        const name = input.value.trim();

        if (!name) return;
        if (this.sessionPlayers.find(p => p.toLowerCase() === name.toLowerCase())) {
            this.showToast('Player already added!');
            return;
        }

        this.sessionPlayers.push(name);
        input.value = '';
        input.focus();
        this.renderPlayerList();
        this.renderSavedPlayers();
        this.validateSetup();
    },

    addSavedPlayer(name) {
        if (this.sessionPlayers.find(p => p.toLowerCase() === name.toLowerCase())) return;
        this.sessionPlayers.push(name);
        this.renderPlayerList();
        this.renderSavedPlayers();
        this.validateSetup();
    },

    removePlayer(name) {
        this.sessionPlayers = this.sessionPlayers.filter(p => p !== name);
        this.renderPlayerList();
        this.renderSavedPlayers();
        this.validateSetup();
    },

    deleteSavedPlayer(name, event) {
        event.stopPropagation();
        this.savedPlayers = this.savedPlayers.filter(p => p !== name);
        localStorage.setItem('badminton_saved_players', JSON.stringify(this.savedPlayers));
        this.renderSavedPlayers();
    },

    renderPlayerList() {
        const container = document.getElementById('player-list');
        container.innerHTML = this.sessionPlayers.map(name => `
            <span class="player-tag">
                ${name}
                <span class="remove-player" onclick="App.removePlayer('${name}')">&times;</span>
            </span>
        `).join('');
    },

    renderSavedPlayers() {
        const container = document.getElementById('saved-player-list');
        const sessionLower = this.sessionPlayers.map(p => p.toLowerCase());

        container.innerHTML = this.savedPlayers.map(name => {
            const added = sessionLower.includes(name.toLowerCase());
            return `
                <span class="saved-player-tag ${added ? 'added' : ''}"
                      onclick="App.addSavedPlayer('${name}')">
                    ${name}
                    <span class="delete-saved" onclick="App.deleteSavedPlayer('${name}', event)">&times;</span>
                </span>
            `;
        }).join('');

        if (this.savedPlayers.length === 0) {
            container.innerHTML = '<span style="color: var(--text-dim); font-size: 13px;">No saved players yet</span>';
        }
    },

    // ==========================================
    // COURT SELECTION
    // ==========================================
    selectCourts(num) {
        this.courts = num;
        document.querySelectorAll('.btn-court').forEach(btn => {
            btn.classList.toggle('selected', parseInt(btn.dataset.courts) === num);
        });
        document.querySelector('#courts-display strong').textContent = num;
        this.validateSetup();
    },

    validateSetup() {
        const valid = this.sessionPlayers.length >= 3 && this.courts > 0;
        document.getElementById('start-session-btn').disabled = !valid;
    },

    // ==========================================
    // SESSION START
    // ==========================================
    startSession() {
        this.savePlayers();

        this.playerStats = {};
        this.sessionPlayers.forEach(name => {
            this.playerStats[name] = {
                gamesPlayed: 0,
                restCount: 0,
                consecutivePlayed: 0,
                partners: [],
                opponents: []
            };
        });

        this.pairingHistory = {};
        this.opponentHistory = {};
        this.sessionPlayers.forEach(p1 => {
            this.pairingHistory[p1] = {};
            this.opponentHistory[p1] = {};
            this.sessionPlayers.forEach(p2 => {
                if (p1 !== p2) {
                    this.pairingHistory[p1][p2] = 0;
                    this.opponentHistory[p1][p2] = 0;
                }
            });
        });

        this.rounds = [];
        this.currentRound = 0;
        this.restRequests.clear();
        this.statsSnapshot = null;
        this.presentPlayers = new Set(this.sessionPlayers);

        this.renderAttendance();
        this.showScreen('screen-attendance');
    },

    // ==========================================
    // ATTENDANCE
    // ==========================================
    renderAttendance() {
        const container = document.getElementById('attendance-list');
        container.innerHTML = this.sessionPlayers.map(name => {
            const isPresent = this.presentPlayers.has(name);
            return `
                <div class="attendance-item ${isPresent ? 'present' : 'absent'}"
                     onclick="App.toggleAttendance('${name}')">
                    <span>${name}</span>
                    <span class="attendance-status">${isPresent ? '✅' : '❌'}</span>
                </div>
            `;
        }).join('');

        const presentCount = this.presentPlayers.size;
        document.getElementById('generate-round-btn').disabled = presentCount < 2;
    },

    toggleAttendance(name) {
        if (this.presentPlayers.has(name)) {
            this.presentPlayers.delete(name);
        } else {
            this.presentPlayers.add(name);
            // Initialize stats for newly joined player if needed
            if (!this.playerStats[name]) {
                this.playerStats[name] = {
                    gamesPlayed: 0,
                    restCount: 0,
                    consecutivePlayed: 0,
                    partners: [],
                    opponents: []
                };
            }
            // Ensure pairing/opponent history exists
            if (!this.pairingHistory[name]) {
                this.pairingHistory[name] = {};
                this.opponentHistory[name] = {};
            }
            this.sessionPlayers.forEach(p => {
                if (p !== name) {
                    if (this.pairingHistory[name][p] === undefined) this.pairingHistory[name][p] = 0;
                    if (this.pairingHistory[p] && this.pairingHistory[p][name] === undefined) this.pairingHistory[p][name] = 0;
                    if (this.opponentHistory[name][p] === undefined) this.opponentHistory[name][p] = 0;
                    if (this.opponentHistory[p] && this.opponentHistory[p][name] === undefined) this.opponentHistory[p][name] = 0;
                }
            });
        }
        this.renderAttendance();
    },

    // ==========================================
    // SNAPSHOT (for shuffle undo)
    // ==========================================
    saveStatsSnapshot() {
        this.statsSnapshot = JSON.parse(JSON.stringify({
            playerStats: this.playerStats,
            pairingHistory: this.pairingHistory,
            opponentHistory: this.opponentHistory
        }));
    },

    restoreStatsSnapshot() {
        if (this.statsSnapshot) {
            this.playerStats = JSON.parse(JSON.stringify(this.statsSnapshot.playerStats));
            this.pairingHistory = JSON.parse(JSON.stringify(this.statsSnapshot.pairingHistory));
            this.opponentHistory = JSON.parse(JSON.stringify(this.statsSnapshot.opponentHistory));
        }
    },

    // ==========================================
    // 🔑 FAIR REST SELECTION (FIXED)
    // ==========================================
    selectRestingPlayers(available, restCount) {
        if (restCount <= 0) return [];

        // Separate manual rest requests
        let requested = available.filter(p => this.restRequests.has(p));
        let remaining = available.filter(p => !this.restRequests.has(p));

        let slotsLeft = restCount - requested.length;

        // If too many requested rest, only take what we need
        if (slotsLeft <= 0) return requested.slice(0, restCount);

        // Score remaining players for rest priority
        let scored = remaining.map(name => {
            const s = this.playerStats[name] || {
                gamesPlayed: 0, restCount: 0, consecutivePlayed: 0
            };
            return {
                name,
                gamesPlayed: s.gamesPlayed,
                restCount: s.restCount,
                consecutivePlayed: s.consecutivePlayed,
                // KEY METRIC: how "overdue" for rest
                // Higher = played more relative to resting = should rest
                restPriority: s.gamesPlayed - s.restCount,
                random: Math.random()  // ← FIX #2: randomize ties
            };
        });

        // Sort: top of list = should rest first
        scored.sort((a, b) => {
            // ← FIX #1: New/returning players go to BOTTOM (they PLAY)
            if (a.gamesPlayed === 0 && b.gamesPlayed > 0) return 1;
            if (b.gamesPlayed === 0 && a.gamesPlayed > 0) return -1;

            // Most overdue for rest → top
            if (a.restPriority !== b.restPriority)
                return b.restPriority - a.restPriority;

            // Most consecutive games → top
            if (a.consecutivePlayed !== b.consecutivePlayed)
                return b.consecutivePlayed - a.consecutivePlayed;

            // ← FIX #2: Random tiebreak prevents same group always resting
            return a.random - b.random;
        });

        let autoRest = scored.slice(0, slotsLeft).map(s => s.name);
        return [...requested, ...autoRest];
    },

    // ==========================================
    // ROUND GENERATION (FIXED)
    // ==========================================
    generateRound() {
        this.shuffleCount = 0;
        this.currentRound++;

        // Save snapshot before this round for shuffle undo
        this.saveStatsSnapshot();

        const round = this.createRoundSchedule();
        this.rounds.push(round);
        this.updateStats(round);
        this.renderRound(round);
        this.showScreen('screen-round');
    },

    createRoundSchedule() {
        // All present players
        let allPresent = [...this.presentPlayers];

        // Calculate how many can play
        const courts = this.courts;
        let doublesCount = Math.min(Math.floor(allPresent.length / 4), courts);
        let remPlayers = allPresent.length - (doublesCount * 4);
        let remCourts = courts - doublesCount;
        let singlesCount = Math.min(Math.floor(remPlayers / 2), remCourts);
        let totalSlots = (doublesCount * 4) + (singlesCount * 2);
        let restCount = allPresent.length - totalSlots;

        // Fair rest selection
        let resting = this.selectRestingPlayers(allPresent, restCount);
        let playing = allPresent.filter(p => !resting.includes(p));

        // Safety check
        if (playing.length < 2 && allPresent.length >= 2) {
            playing = allPresent.slice(0, Math.min(allPresent.length, totalSlots || 2));
            resting = allPresent.filter(p => !playing.includes(p));
        }

        // Recalculate court config for actual player count
        doublesCount = Math.min(Math.floor(playing.length / 4), courts);
        remPlayers = playing.length - (doublesCount * 4);
        remCourts = courts - doublesCount;
        singlesCount = Math.min(Math.floor(remPlayers / 2), remCourts);

        // If still extra players, move to rest
        let actualPlaying = (doublesCount * 4) + (singlesCount * 2);
        if (playing.length > actualPlaying) {
            let extraCount = playing.length - actualPlaying;
            let extraRest = this.selectRestingPlayers(
                playing.filter(p => !resting.includes(p)),
                extraCount
            );
            resting = [...resting, ...extraRest];
            playing = playing.filter(p => !resting.includes(p));
        }

        // Generate matches
        const matches = this.createMatches(playing, doublesCount, singlesCount);

        return {
            roundNumber: this.currentRound,
            matches,
            resting,
            playing
        };
    },

    // ==========================================
    // MATCH CREATION
    // ==========================================
    createMatches(players, doublesCount, singlesCount) {
        const matches = [];
        let assigned = new Set();

        // Shuffle players slightly to avoid order bias
        let shuffledPlayers = [...players].sort(() => Math.random() - 0.5);

        // Doubles
        for (let i = 0; i < doublesCount; i++) {
            const available = shuffledPlayers.filter(p => !assigned.has(p));
            const teams = this.formDoublesTeams(available);

            if (teams) {
                matches.push({
                    court: matches.length + 1,
                    type: 'doubles',
                    team1: teams.team1,
                    team2: teams.team2
                });
                teams.team1.forEach(p => assigned.add(p));
                teams.team2.forEach(p => assigned.add(p));
            }
        }

        // Singles
        for (let i = 0; i < singlesCount; i++) {
            const available = shuffledPlayers.filter(p => !assigned.has(p));
            if (available.length >= 2) {
                const pair = this.formSinglesMatch(available);
                matches.push({
                    court: matches.length + 1,
                    type: 'singles',
                    team1: [pair[0]],
                    team2: [pair[1]]
                });
                assigned.add(pair[0]);
                assigned.add(pair[1]);
            }
        }

        return matches;
    },

    formDoublesTeams(available) {
        if (available.length < 4) return null;

        let pairs = [];
        for (let i = 0; i < available.length; i++) {
            for (let j = i + 1; j < available.length; j++) {
                const p1 = available[i];
                const p2 = available[j];
                const score = (this.pairingHistory[p1] && this.pairingHistory[p1][p2]) || 0;
                pairs.push({ players: [p1, p2], score });
            }
        }

        pairs.sort((a, b) => a.score - b.score);

        let bestTeams = null;
        let bestScore = Infinity;

        for (let i = 0; i < pairs.length; i++) {
            for (let j = i + 1; j < pairs.length; j++) {
                const p1 = pairs[i].players;
                const p2 = pairs[j].players;

                if (p1[0] !== p2[0] && p1[0] !== p2[1] &&
                    p1[1] !== p2[0] && p1[1] !== p2[1]) {

                    const combinedScore = pairs[i].score + pairs[j].score;
                    const oppScore = this.getOpponentScore(p1, p2);
                    // Add small random factor for variety among equal scores
                    const totalScore = combinedScore * 2 + oppScore + Math.random() * 0.5;

                    if (totalScore < bestScore) {
                        bestScore = totalScore;
                        bestTeams = { team1: [...p1], team2: [...p2] };
                    }
                }
            }
        }

        return bestTeams;
    },

    getOpponentScore(team1, team2) {
        let score = 0;
        team1.forEach(p1 => {
            team2.forEach(p2 => {
                score += (this.opponentHistory[p1] && this.opponentHistory[p1][p2]) || 0;
            });
        });
        return score;
    },

    formSinglesMatch(available) {
        if (available.length < 2) return available;

        let bestPair = [available[0], available[1]];
        let bestScore = Infinity;

        for (let i = 0; i < available.length; i++) {
            for (let j = i + 1; j < available.length; j++) {
                const score = ((this.opponentHistory[available[i]] &&
                    this.opponentHistory[available[i]][available[j]]) || 0)
                    + Math.random() * 0.5;

                if (score < bestScore) {
                    bestScore = score;
                    bestPair = [available[i], available[j]];
                }
            }
        }

        return bestPair;
    },

    // ==========================================
    // STATS UPDATE (FIXED)
    // ==========================================
    updateStats(round) {
        // Playing players
        round.playing.forEach(name => {
            if (!this.playerStats[name]) {
                this.playerStats[name] = {
                    gamesPlayed: 0, restCount: 0,
                    consecutivePlayed: 0, partners: [], opponents: []
                };
            }
            this.playerStats[name].gamesPlayed++;
            this.playerStats[name].consecutivePlayed++;
        });

        // Resting players
        round.resting.forEach(name => {
            if (!this.playerStats[name]) {
                this.playerStats[name] = {
                    gamesPlayed: 0, restCount: 0,
                    consecutivePlayed: 0, partners: [], opponents: []
                };
            }
            this.playerStats[name].restCount++;
            this.playerStats[name].consecutivePlayed = 0;
        });

        // Absent players also reset consecutive
        this.sessionPlayers.forEach(name => {
            if (!this.presentPlayers.has(name) && this.playerStats[name]) {
                this.playerStats[name].consecutivePlayed = 0;
            }
        });

        // Pairing & opponent history
        round.matches.forEach(match => {
            if (match.type === 'doubles') {
                const t1 = match.team1;
                const t2 = match.team2;

                // Partners
                this.recordPartnership(t1[0], t1[1]);
                this.recordPartnership(t2[0], t2[1]);
            }

            // Opponents
            match.team1.forEach(p1 => {
                match.team2.forEach(p2 => {
                    this.recordOpponent(p1, p2);
                });
            });
        });

        // Clear rest requests (they're one-round only)
        this.restRequests.clear();
    },

    recordPartnership(p1, p2) {
        if (this.pairingHistory[p1]) this.pairingHistory[p1][p2] = (this.pairingHistory[p1][p2] || 0) + 1;
        if (this.pairingHistory[p2]) this.pairingHistory[p2][p1] = (this.pairingHistory[p2][p1] || 0) + 1;
        if (this.playerStats[p1]) this.playerStats[p1].partners.push(p2);
        if (this.playerStats[p2]) this.playerStats[p2].partners.push(p1);
    },

    recordOpponent(p1, p2) {
        if (this.opponentHistory[p1]) this.opponentHistory[p1][p2] = (this.opponentHistory[p1][p2] || 0) + 1;
        if (this.opponentHistory[p2]) this.opponentHistory[p2][p1] = (this.opponentHistory[p2][p1] || 0) + 1;
        if (this.playerStats[p1]) this.playerStats[p1].opponents.push(p2);
        if (this.playerStats[p2]) this.playerStats[p2].opponents.push(p1);
    },

    // ==========================================
    // RENDER ROUND
    // ==========================================
    renderRound(round) {
        document.getElementById('round-number').textContent = round.roundNumber;

        const matchesContainer = document.getElementById('matches-container');
        matchesContainer.innerHTML = round.matches.map(match => `
            <div class="match-card ${match.type}">
                <div class="court-label">
                    <span>Court ${match.court}</span>
                    <span class="match-type">${match.type.toUpperCase()}</span>
                </div>
                <div class="vs-container">
                    <div class="team">
                        ${match.team1.map(p => `<span class="player-name">${p}</span>`).join('')}
                    </div>
                    <span class="vs">VS</span>
                    <div class="team">
                        ${match.team2.map(p => `<span class="player-name">${p}</span>`).join('')}
                    </div>
                </div>
            </div>
        `).join('');

        // Resting
        const restingContainer = document.getElementById('resting-container');
        const restingList = document.getElementById('resting-list');

        if (round.resting.length > 0) {
            restingContainer.classList.remove('hidden');
            restingList.innerHTML = round.resting.map(name => {
                const stats = this.playerStats[name];
                return `<span class="resting-tag">${name} (R:${stats ? stats.restCount : 0})</span>`;
            }).join('');
        } else {
            restingContainer.classList.add('hidden');
        }

        // Rest requests
        const allInRound = [...round.playing, ...round.resting].filter(p => this.presentPlayers.has(p));
        const restRequestList = document.getElementById('rest-request-list');
        restRequestList.innerHTML = allInRound.map(name => `
            <div class="rest-request-item">
                <span>${name} <small style="color:var(--text-dim)">(P:${this.playerStats[name]?.gamesPlayed || 0} R:${this.playerStats[name]?.restCount || 0})</small></span>
                <button class="rest-toggle ${this.restRequests.has(name) ? 'active' : ''}"
                        onclick="App.toggleRestRequest('${name}', this)">
                </button>
            </div>
        `).join('');

        this.shuffleCount = 0;
    },

    toggleRestRequest(name, btn) {
        if (this.restRequests.has(name)) {
            this.restRequests.delete(name);
            btn.classList.remove('active');
        } else {
            this.restRequests.add(name);
            btn.classList.add('active');
        }
    },

    // ==========================================
    // ROUND ACTIONS
    // ==========================================
    nextRound() {
        this.renderAttendance();
        this.showScreen('screen-attendance');
    },

    shuffleRound() {
        if (this.shuffleCount >= this.maxShuffles) {
            this.showToast('Max shuffles reached for this round!');
            return;
        }

        // Restore to pre-round state
        this.restoreStatsSnapshot();

        this.shuffleCount++;
        const round = this.createRoundSchedule();
        this.rounds[this.rounds.length - 1] = round;

        // Save new snapshot and apply
        this.saveStatsSnapshot();
        this.updateStats(round);
        this.renderRound(round);
        this.showToast(`Shuffled! (${this.shuffleCount}/${this.maxShuffles})`);
    },

    // ==========================================
    // END SESSION
    // ==========================================
    endSession() {
        if (!confirm('End this session?')) return;

        const summaryContent = document.getElementById('summary-content');

        let html = `
            <div class="summary-stat">
                <span class="label">Total Rounds</span>
                <span class="value">${this.rounds.length}</span>
            </div>
            <div class="summary-stat">
                <span class="label">Courts Used</span>
                <span class="value">${this.courts}</span>
            </div>
            <div class="summary-stat">
                <span class="label">Total Players</span>
                <span class="value">${Object.keys(this.playerStats).filter(n => 
                    this.playerStats[n].gamesPlayed > 0 || this.playerStats[n].restCount > 0
                ).length}</span>
            </div>
        `;

        html += `
            <table class="summary-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Played</th>
                        <th>Rested</th>
                        <th>Partners</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const sortedPlayers = Object.entries(this.playerStats)
            .filter(([_, s]) => s.gamesPlayed > 0 || s.restCount > 0)
            .sort((a, b) => b[1].gamesPlayed - a[1].gamesPlayed);

        sortedPlayers.forEach(([name, stats]) => {
            const uniquePartners = [...new Set(stats.partners)].length;
            html += `
                <tr>
                    <td><strong>${name}</strong></td>
                    <td>${stats.gamesPlayed}</td>
                    <td>${stats.restCount}</td>
                    <td>${uniquePartners}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        summaryContent.innerHTML = html;
        this.showScreen('screen-summary');
    },

    // ==========================================
    // NEW SESSION
    // ==========================================
    newSession() {
        this.sessionPlayers = [];
        this.courts = 0;
        this.rounds = [];
        this.currentRound = 0;
        this.pairingHistory = {};
        this.opponentHistory = {};
        this.playerStats = {};
        this.restRequests.clear();
        this.presentPlayers.clear();
        this.statsSnapshot = null;

        document.getElementById('player-list').innerHTML = '';
        document.querySelectorAll('.btn-court').forEach(b => b.classList.remove('selected'));
        document.querySelector('#courts-display strong').textContent = '0';
        document.getElementById('start-session-btn').disabled = true;

        this.loadSavedPlayers();
        this.renderSavedPlayers();
        this.showScreen('screen-setup');
    },

    // ==========================================
    // TOAST
    // ==========================================
    showToast(message) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 120px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--card-bg);
            color: var(--text);
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 1000;
            border: 1px solid var(--card-border);
            animation: fadeIn 0.2s ease;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
