// ==========================================
// BADMINTON MATCH SCHEDULER - PWA v2
// ==========================================

const App = {
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

    // ==========================================
    // INIT
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
                .catch(err => console.log('SW failed:', err));
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

    persistSavedPlayers() {
        const allNames = [...new Set([...this.savedPlayers, ...this.sessionPlayers])];
        this.savedPlayers = allNames;
        localStorage.setItem('badminton_saved_players', JSON.stringify(allNames));
    },

    // ==========================================
    // EVENTS
    // ==========================================
    bindEvents() {
        // Setup
        document.getElementById('add-player-btn').addEventListener('click', () => this.addPlayerSetup());
        document.getElementById('player-name-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlayerSetup();
        });

        document.querySelectorAll('.btn-court').forEach(btn => {
            btn.addEventListener('click', (e) => this.selectCourts(parseInt(e.target.dataset.courts)));
        });

        document.getElementById('start-session-btn').addEventListener('click', () => this.startSession());

        // Attendance
        document.getElementById('add-new-player-btn').addEventListener('click', () => this.addPlayerMidSession());
        document.getElementById('new-player-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlayerMidSession();
        });
        document.getElementById('generate-round-btn').addEventListener('click', () => this.generateRound());
        document.getElementById('back-to-setup-btn').addEventListener('click', () => this.showScreen('screen-setup'));

        // Round
        document.getElementById('next-round-btn').addEventListener('click', () => this.nextRound());
        document.getElementById('end-session-btn').addEventListener('click', () => this.endSession());

        // Summary
        document.getElementById('new-session-btn').addEventListener('click', () => this.newSession());
    },

    // ==========================================
    // SCREENS
    // ==========================================
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
        window.scrollTo(0, 0);
    },

    // ==========================================
    // SETUP: PLAYER MANAGEMENT
    // ==========================================
    addPlayerSetup() {
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
            container.innerHTML = '<span style="color:var(--text-dim);font-size:13px;">No saved players yet</span>';
        }
    },

    // ==========================================
    // COURTS
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
        this.persistSavedPlayers();

        this.playerStats = {};
        this.pairingHistory = {};
        this.opponentHistory = {};

        this.sessionPlayers.forEach(name => {
            this.initPlayerData(name);
        });

        this.rounds = [];
        this.currentRound = 0;
        this.restRequests.clear();
        this.presentPlayers = new Set(this.sessionPlayers);

        this.renderAttendance();
        this.showScreen('screen-attendance');
    },

    // ==========================================
    // 🔑 INITIALIZE PLAYER DATA (reusable)
    // ==========================================
    initPlayerData(name) {
        // Stats
        if (!this.playerStats[name]) {
            this.playerStats[name] = {
                gamesPlayed: 0,
                restCount: 0,
                consecutivePlayed: 0,
                partners: [],
                opponents: [],
                joinedAtRound: this.currentRound
            };
        }

        // Pairing history
        if (!this.pairingHistory[name]) {
            this.pairingHistory[name] = {};
        }
        if (!this.opponentHistory[name]) {
            this.opponentHistory[name] = {};
        }

        // Cross-reference with ALL existing players
        const allKnown = Object.keys(this.playerStats);
        allKnown.forEach(other => {
            if (other !== name) {
                if (this.pairingHistory[name][other] === undefined) {
                    this.pairingHistory[name][other] = 0;
                }
                if (this.pairingHistory[other] && this.pairingHistory[other][name] === undefined) {
                    this.pairingHistory[other][name] = 0;
                }
                if (this.opponentHistory[name][other] === undefined) {
                    this.opponentHistory[name][other] = 0;
                }
                if (this.opponentHistory[other] && this.opponentHistory[other][name] === undefined) {
                    this.opponentHistory[other][name] = 0;
                }
            }
        });
    },

    // ==========================================
    // 🔑 ADD PLAYER MID-SESSION
    // ==========================================
    addPlayerMidSession() {
        const input = document.getElementById('new-player-input');
        const name = input.value.trim();
        if (!name) return;

        // Check duplicates
        if (this.sessionPlayers.find(p => p.toLowerCase() === name.toLowerCase())) {
            this.showToast('Player already exists!');
            return;
        }

        // Add to session
        this.sessionPlayers.push(name);

        // Initialize all data structures
        this.initPlayerData(name);

        // Mark as present
        this.presentPlayers.add(name);

        // Save to persistent storage
        this.persistSavedPlayers();

        input.value = '';
        this.renderAttendance();
        this.showToast(`${name} added! They'll get priority to play.`);
    },

    // ==========================================
    // ATTENDANCE
    // ==========================================
    renderAttendance() {
        const container = document.getElementById('attendance-list');
        container.innerHTML = this.sessionPlayers.map(name => {
            const isPresent = this.presentPlayers.has(name);
            const stats = this.playerStats[name];
            const isNew = stats && stats.gamesPlayed === 0 && stats.joinedAtRound > 0;

            return `
                <div class="attendance-item ${isPresent ? 'present' : 'absent'}"
                     onclick="App.toggleAttendance('${name}')">
                    <div class="player-info">
                        <span>
                            ${name}
                            ${isNew ? '<span class="new-badge">NEW</span>' : ''}
                        </span>
                        <span class="player-stats-line">
                            Played: ${stats?.gamesPlayed || 0} | Rested: ${stats?.restCount || 0}
                        </span>
                    </div>
                    <span class="attendance-status">${isPresent ? '✅' : '❌'}</span>
                </div>
            `;
        }).join('');

        // Summary
        const presentCount = [...this.presentPlayers].length;
        const doublesMax = Math.min(Math.floor(presentCount / 4), this.courts);
        const remP = presentCount - (doublesMax * 4);
        const remC = this.courts - doublesMax;
        const singlesMax = Math.min(Math.floor(remP / 2), remC);
        const totalPlaying = (doublesMax * 4) + (singlesMax * 2);
        const restingCount = presentCount - totalPlaying;

        document.getElementById('attendance-summary').innerHTML = `
            <strong>${presentCount}</strong> present |
            <strong>${doublesMax}</strong> doubles${singlesMax > 0 ? ` + <strong>${singlesMax}</strong> singles` : ''} |
            <strong>${restingCount}</strong> resting
        `;

        document.getElementById('generate-round-btn').disabled = presentCount < 2;
    },

    toggleAttendance(name) {
        if (this.presentPlayers.has(name)) {
            this.presentPlayers.delete(name);
        } else {
            this.presentPlayers.add(name);
            this.initPlayerData(name);
        }
        this.renderAttendance();
    },

    // ==========================================
    // 🔑 FAIR REST SELECTION
    // ==========================================
    selectRestingPlayers(available, restCount) {
        if (restCount <= 0) return [];

        let requested = available.filter(p => this.restRequests.has(p));
        let remaining = available.filter(p => !this.restRequests.has(p));
        let slotsLeft = restCount - requested.length;

        if (slotsLeft <= 0) return requested.slice(0, restCount);

        let scored = remaining.map(name => {
            const s = this.playerStats[name] || {
                gamesPlayed: 0, restCount: 0, consecutivePlayed: 0
            };
            return {
                name,
                gamesPlayed: s.gamesPlayed,
                restCount: s.restCount,
                consecutivePlayed: s.consecutivePlayed,
                // Net play score: higher = more overdue for rest
                netPlay: s.gamesPlayed - s.restCount,
                random: Math.random()
            };
        });

        scored.sort((a, b) => {
            // New/returning players (0 games) → BOTTOM (they play first)
            if (a.gamesPlayed === 0 && b.gamesPlayed > 0) return 1;
            if (b.gamesPlayed === 0 && a.gamesPlayed > 0) return -1;

            // Most overdue for rest → TOP (they rest)
            if (a.netPlay !== b.netPlay) return b.netPlay - a.netPlay;

            // Most consecutive → TOP
            if (a.consecutivePlayed !== b.consecutivePlayed)
                return b.consecutivePlayed - a.consecutivePlayed;

            // Random tiebreak
            return a.random - b.random;
        });

        let autoRest = scored.slice(0, slotsLeft).map(s => s.name);
        return [...requested, ...autoRest];
    },

    // ==========================================
    // ROUND GENERATION
    // ==========================================
    generateRound() {
        this.currentRound++;
        const round = this.createRoundSchedule();
        this.rounds.push(round);
        this.updateStats(round);
        this.renderRound(round);
        this.showScreen('screen-round');
    },

    createRoundSchedule() {
        let allPresent = [...this.presentPlayers];
        const courts = this.courts;

        // Calculate court config
        let doublesCount = Math.min(Math.floor(allPresent.length / 4), courts);
        let remPlayers = allPresent.length - (doublesCount * 4);
        let remCourts = courts - doublesCount;
        let singlesCount = Math.min(Math.floor(remPlayers / 2), remCourts);
        let totalSlots = (doublesCount * 4) + (singlesCount * 2);
        let restCount = allPresent.length - totalSlots;

        // Select who rests
        let resting = this.selectRestingPlayers(allPresent, restCount);
        let playing = allPresent.filter(p => !resting.includes(p));

        // Recalculate with actual playing count
        doublesCount = Math.min(Math.floor(playing.length / 4), courts);
        remPlayers = playing.length - (doublesCount * 4);
        remCourts = courts - doublesCount;
        singlesCount = Math.min(Math.floor(remPlayers / 2), remCourts);

        let actualSlots = (doublesCount * 4) + (singlesCount * 2);
        if (playing.length > actualSlots) {
            let extra = this.selectRestingPlayers(
                playing, playing.length - actualSlots
            );
            resting = [...resting, ...extra];
            playing = playing.filter(p => !resting.includes(p));
        }

        // Safety
        if (playing.length < 2 && allPresent.length >= 2) {
            playing = allPresent.slice(0, 2);
            resting = allPresent.filter(p => !playing.includes(p));
            doublesCount = 0;
            singlesCount = 1;
        }

        const matches = this.createMatches(playing, doublesCount, singlesCount);

        return {
            roundNumber: this.currentRound,
            matches,
            resting,
            playing
        };
    },

    createMatches(players, doublesCount, singlesCount) {
        const matches = [];
        let assigned = new Set();

        // Slight shuffle for variety
        let pool = [...players].sort(() => Math.random() - 0.5);

        for (let i = 0; i < doublesCount; i++) {
            const available = pool.filter(p => !assigned.has(p));
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

        for (let i = 0; i < singlesCount; i++) {
            const available = pool.filter(p => !assigned.has(p));
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
                const score = (this.pairingHistory[p1]?.[p2]) || 0;
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

                    const pairScore = pairs[i].score + pairs[j].score;
                    const oppScore = this.getOpponentScore(p1, p2);
                    const totalScore = pairScore * 2 + oppScore + Math.random() * 0.3;

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
                score += (this.opponentHistory[p1]?.[p2]) || 0;
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
                const score = (this.opponentHistory[available[i]]?.[available[j]] || 0)
                    + Math.random() * 0.3;
                if (score < bestScore) {
                    bestScore = score;
                    bestPair = [available[i], available[j]];
                }
            }
        }

        return bestPair;
    },

    // ==========================================
    // STATS UPDATE
    // ==========================================
    updateStats(round) {
        round.playing.forEach(name => {
            const s = this.playerStats[name];
            if (s) {
                s.gamesPlayed++;
                s.consecutivePlayed++;
            }
        });

        round.resting.forEach(name => {
            const s = this.playerStats[name];
            if (s) {
                s.restCount++;
                s.consecutivePlayed = 0;
            }
        });

        // Absent players reset consecutive
        this.sessionPlayers.forEach(name => {
            if (!this.presentPlayers.has(name) && this.playerStats[name]) {
                this.playerStats[name].consecutivePlayed = 0;
            }
        });

        // Record partnerships and opponents
        round.matches.forEach(match => {
            if (match.type === 'doubles') {
                this.recordPartnership(match.team1[0], match.team1[1]);
                this.recordPartnership(match.team2[0], match.team2[1]);
            }
            match.team1.forEach(p1 => {
                match.team2.forEach(p2 => {
                    this.recordOpponent(p1, p2);
                });
            });
        });

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

        // Matches
        const mc = document.getElementById('matches-container');
        mc.innerHTML = round.matches.map(match => `
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
        const rc = document.getElementById('resting-container');
        const rl = document.getElementById('resting-list');
        if (round.resting.length > 0) {
            rc.classList.remove('hidden');
            rl.innerHTML = round.resting.map(name => {
                const s = this.playerStats[name];
                return `<span class="resting-tag">${name} (P:${s?.gamesPlayed || 0} R:${s?.restCount || 0})</span>`;
            }).join('');
        } else {
            rc.classList.add('hidden');
        }

        // Rest requests
        const allInRound = [...round.playing, ...round.resting]
            .filter(p => this.presentPlayers.has(p));

        const rrl = document.getElementById('rest-request-list');
        rrl.innerHTML = allInRound.map(name => {
            const s = this.playerStats[name];
            return `
                <div class="rest-request-item">
                    <div class="player-label">
                        <span>${name}</span>
                        <span class="mini-stats">Played: ${s?.gamesPlayed || 0} | Rested: ${s?.restCount || 0}</span>
                    </div>
                    <button class="rest-toggle ${this.restRequests.has(name) ? 'active' : ''}"
                            onclick="App.toggleRestRequest('${name}', this)">
                    </button>
                </div>
            `;
        }).join('');
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
    // ACTIONS
    // ==========================================
    nextRound() {
        this.renderAttendance();
        this.showScreen('screen-attendance');
    },

    endSession() {
        if (!confirm('End this session?')) return;

        const sc = document.getElementById('summary-content');
        let html = `
            <div class="summary-stat">
                <span class="label">Total Rounds</span>
                <span class="value">${this.rounds.length}</span>
            </div>
            <div class="summary-stat">
                <span class="label">Courts</span>
                <span class="value">${this.courts}</span>
            </div>
            <div class="summary-stat">
                <span class="label">Players</span>
                <span class="value">${Object.keys(this.playerStats).filter(n =>
                    this.playerStats[n].gamesPlayed > 0 || this.playerStats[n].restCount > 0
                ).length}</span>
            </div>
            <table class="summary-table">
                <thead>
                    <tr><th>Player</th><th>Played</th><th>Rested</th><th>Partners</th></tr>
                </thead>
                <tbody>
        `;

        Object.entries(this.playerStats)
            .filter(([_, s]) => s.gamesPlayed > 0 || s.restCount > 0)
            .sort((a, b) => b[1].gamesPlayed - a[1].gamesPlayed)
            .forEach(([name, stats]) => {
                const up = [...new Set(stats.partners)].length;
                html += `
                    <tr>
                        <td><strong>${name}</strong></td>
                        <td>${stats.gamesPlayed}</td>
                        <td>${stats.restCount}</td>
                        <td>${up}</td>
                    </tr>
                `;
            });

        html += '</tbody></table>';
        sc.innerHTML = html;
        this.showScreen('screen-summary');
    },

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
        setTimeout(() => toast.remove(), 2500);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
