// ==========================================
// BADMINTON MATCH SCHEDULER - PWA
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
        // Setup screen
        document.getElementById('add-player-btn').addEventListener('click', () => this.addPlayer());
        document.getElementById('player-name-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlayer();
        });

        document.querySelectorAll('.btn-court').forEach(btn => {
            btn.addEventListener('click', (e) => this.selectCourts(parseInt(e.target.dataset.courts)));
        });

        document.getElementById('start-session-btn').addEventListener('click', () => this.startSession());

        // Attendance screen
        document.getElementById('generate-round-btn').addEventListener('click', () => this.generateRound());
        document.getElementById('back-to-setup-btn').addEventListener('click', () => this.showScreen('screen-setup'));

        // Round screen
        document.getElementById('next-round-btn').addEventListener('click', () => this.nextRound());
        document.getElementById('shuffle-round-btn').addEventListener('click', () => this.shuffleRound());
        document.getElementById('end-session-btn').addEventListener('click', () => this.endSession());

        // Summary screen
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
        
        // Initialize stats
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

        // Initialize pairing history
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

        // All players present initially
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
        }
        this.renderAttendance();
    },

    // ==========================================
    // ROUND GENERATION
    // ==========================================
    generateRound() {
        this.shuffleCount = 0;
        this.currentRound++;
        const round = this.createRoundSchedule();
        this.rounds.push(round);
        this.updateStats(round);
        this.renderRound(round);
        this.showScreen('screen-round');
    },

    createRoundSchedule() {
        let available = [...this.presentPlayers].filter(p => !this.restRequests.has(p));
        let requestedRest = [...this.presentPlayers].filter(p => this.restRequests.has(p));

        // Determine court configuration
        const courts = this.courts;
        let doublesCount = Math.min(Math.floor(available.length / 4), courts);
        let remainingPlayers = available.length - (doublesCount * 4);
        let remainingCourts = courts - doublesCount;
        let singlesCount = Math.min(Math.floor(remainingPlayers / 2), remainingCourts);
        let totalPlaying = (doublesCount * 4) + (singlesCount * 2);
        let restCount = available.length - totalPlaying;

        // Determine who rests (fair rotation)
        let mustRest = [...requestedRest];
        let autoRest = [];

        if (restCount > 0) {
            // Sort by priority: most consecutive played, least rested, most games
            let candidates = available.sort((a, b) => {
                const sa = this.playerStats[a] || { consecutivePlayed: 0, restCount: 0, gamesPlayed: 0 };
                const sb = this.playerStats[b] || { consecutivePlayed: 0, restCount: 0, gamesPlayed: 0 };

                // Returning players (0 games) get priority to play
                if (sa.gamesPlayed === 0 && sb.gamesPlayed > 0) return -1;
                if (sb.gamesPlayed === 0 && sa.gamesPlayed > 0) return 1;

                // Most consecutive played → should rest
                if (sb.consecutivePlayed !== sa.consecutivePlayed)
                    return sb.consecutivePlayed - sa.consecutivePlayed;

                // Least rested → should rest
                if (sa.restCount !== sb.restCount)
                    return sa.restCount - sb.restCount;

                // Most games played → should rest
                return sb.gamesPlayed - sa.gamesPlayed;
            });

            autoRest = candidates.slice(0, restCount);
        }

        let allResting = [...new Set([...mustRest, ...autoRest])];
        let playing = available.filter(p => !allResting.includes(p));

        // If we have too many resting due to manual requests, recalculate
        if (playing.length < 2) {
            // Force some back
            playing = available.slice(0, Math.max(2, totalPlaying));
            allResting = available.filter(p => !playing.includes(p));
        }

        // Recalculate courts with actual playing count
        doublesCount = Math.min(Math.floor(playing.length / 4), courts);
        let remPlayers = playing.length - (doublesCount * 4);
        let remCourts = courts - doublesCount;
        singlesCount = Math.min(Math.floor(remPlayers / 2), remCourts);
        let extraRest = playing.length - (doublesCount * 4) - (singlesCount * 2);
        
        if (extraRest > 0) {
            // Move extra to resting using same fair logic
            let sorted = [...playing].sort((a, b) => {
                const sa = this.playerStats[a] || { consecutivePlayed: 0, restCount: 0, gamesPlayed: 0 };
                const sb = this.playerStats[b] || { consecutivePlayed: 0, restCount: 0, gamesPlayed: 0 };
                if (sa.gamesPlayed === 0 && sb.gamesPlayed > 0) return -1;
                if (sb.gamesPlayed === 0 && sa.gamesPlayed > 0) return 1;
                if (sb.consecutivePlayed !== sa.consecutivePlayed)
                    return sb.consecutivePlayed - sa.consecutivePlayed;
                if (sa.restCount !== sb.restCount)
                    return sa.restCount - sb.restCount;
                return sb.gamesPlayed - sa.gamesPlayed;
            });
            let extraRestPlayers = sorted.slice(0, extraRest);
            allResting = [...allResting, ...extraRestPlayers];
            playing = playing.filter(p => !extraRestPlayers.includes(p));
        }

        // Generate matches
        const matches = this.createMatches(playing, doublesCount, singlesCount);

        return {
            roundNumber: this.currentRound,
            matches: matches,
            resting: allResting,
            playing: playing
        };
    },

    createMatches(players, doublesCount, singlesCount) {
        const matches = [];
        let assigned = new Set();

        // Create doubles matches
        for (let i = 0; i < doublesCount; i++) {
            const available = players.filter(p => !assigned.has(p));
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

        // Create singles matches
        for (let i = 0; i < singlesCount; i++) {
            const available = players.filter(p => !assigned.has(p));
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

        // Generate all possible pairs and score them
        let pairs = [];
        for (let i = 0; i < available.length; i++) {
            for (let j = i + 1; j < available.length; j++) {
                const p1 = available[i];
                const p2 = available[j];
                const score = (this.pairingHistory[p1] && this.pairingHistory[p1][p2]) || 0;
                pairs.push({ players: [p1, p2], score: score });
            }
        }

        // Sort by score (least paired first)
        pairs.sort((a, b) => a.score - b.score);

        // Try to find two non-overlapping pairs with lowest combined score
        let bestTeams = null;
        let bestScore = Infinity;

        for (let i = 0; i < pairs.length; i++) {
            for (let j = i + 1; j < pairs.length; j++) {
                const p1 = pairs[i].players;
                const p2 = pairs[j].players;

                // Check no overlap
                if (p1[0] !== p2[0] && p1[0] !== p2[1] && p1[1] !== p2[0] && p1[1] !== p2[1]) {
                    const combinedScore = pairs[i].score + pairs[j].score;
                    
                    // Also consider opponent history
                    const oppScore = this.getOpponentScore(p1, p2);
                    const totalScore = combinedScore * 2 + oppScore;

                    if (totalScore < bestScore) {
                        bestScore = totalScore;
                        bestTeams = { team1: p1, team2: p2 };
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
        if (available.length < 2) return null;

        let bestPair = [available[0], available[1]];
        let bestScore = Infinity;

        for (let i = 0; i < available.length; i++) {
            for (let j = i + 1; j < available.length; j++) {
                const score = (this.opponentHistory[available[i]] && this.opponentHistory[available[i]][available[j]]) || 0;
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
        // Update playing stats
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

        // Update resting stats
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

        // Update pairing and opponent history
        round.matches.forEach(match => {
            // Partners (doubles only)
            if (match.type === 'doubles') {
                const t1 = match.team1;
                const t2 = match.team2;

                // Team 1 partners
                if (this.pairingHistory[t1[0]]) this.pairingHistory[t1[0]][t1[1]] = (this.pairingHistory[t1[0]][t1[1]] || 0) + 1;
                if (this.pairingHistory[t1[1]]) this.pairingHistory[t1[1]][t1[0]] = (this.pairingHistory[t1[1]][t1[0]] || 0) + 1;

                // Team 2 partners
                if (this.pairingHistory[t2[0]]) this.pairingHistory[t2[0]][t2[1]] = (this.pairingHistory[t2[0]][t2[1]] || 0) + 1;
                if (this.pairingHistory[t2[1]]) this.pairingHistory[t2[1]][t2[0]] = (this.pairingHistory[t2[1]][t2[0]] || 0) + 1;

                // Partners list
                if (this.playerStats[t1[0]]) this.playerStats[t1[0]].partners.push(t1[1]);
                if (this.playerStats[t1[1]]) this.playerStats[t1[1]].partners.push(t1[0]);
                if (this.playerStats[t2[0]]) this.playerStats[t2[0]].partners.push(t2[1]);
                if (this.playerStats[t2[1]]) this.playerStats[t2[1]].partners.push(t2[0]);
            }

            // Opponents
            match.team1.forEach(p1 => {
                match.team2.forEach(p2 => {
                    if (this.opponentHistory[p1]) this.opponentHistory[p1][p2] = (this.opponentHistory[p1][p2] || 0) + 1;
                    if (this.opponentHistory[p2]) this.opponentHistory[p2][p1] = (this.opponentHistory[p2][p1] || 0) + 1;
                    if (this.playerStats[p1]) this.playerStats[p1].opponents.push(p2);
                    if (this.playerStats[p2]) this.playerStats[p2].opponents.push(p1);
                });
            });
        });

        // Clear rest requests after round
        this.restRequests.clear();
    },

    // ==========================================
    // RENDER ROUND
    // ==========================================
    renderRound(round) {
        document.getElementById('round-number').textContent = round.roundNumber;

        // Matches
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
            restingList.innerHTML = round.resting.map(name => 
                `<span class="resting-tag">${name}</span>`
            ).join('');
        } else {
            restingContainer.classList.add('hidden');
        }

        // Rest requests for next round
        const allPlaying = [...round.playing, ...round.resting].filter(p => this.presentPlayers.has(p));
        const restRequestList = document.getElementById('rest-request-list');
        restRequestList.innerHTML = allPlaying.map(name => `
            <div class="rest-request-item">
                <span>${name}</span>
                <button class="rest-toggle ${this.restRequests.has(name) ? 'active' : ''}" 
                        onclick="App.toggleRestRequest('${name}', this)">
                </button>
            </div>
        `).join('');

        // Reset shuffle count
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

        // Undo last round stats
        const lastRound = this.rounds[this.rounds.length - 1];
        this.undoStats(lastRound);

        // Regenerate
        this.shuffleCount++;
        const round = this.createRoundSchedule();
        this.rounds[this.rounds.length - 1] = round;
        this.updateStats(round);
        this.renderRound(round);
        this.showToast(`Shuffled! (${this.shuffleCount}/${this.maxShuffles})`);
    },

    undoStats(round) {
        round.playing.forEach(name => {
            if (this.playerStats[name]) {
                this.playerStats[name].gamesPlayed--;
                this.playerStats[name].consecutivePlayed--;
            }
        });

        round.resting.forEach(name => {
            if (this.playerStats[name]) {
                this.playerStats[name].restCount--;
            }
        });

        round.matches.forEach(match => {
            if (match.type === 'doubles') {
                const t1 = match.team1;
                const t2 = match.team2;
                if (this.pairingHistory[t1[0]]) this.pairingHistory[t1[0]][t1[1]]--;
                if (this.pairingHistory[t1[1]]) this.pairingHistory[t1[1]][t1[0]]--;
                if (this.pairingHistory[t2[0]]) this.pairingHistory[t2[0]][t2[1]]--;
                if (this.pairingHistory[t2[1]]) this.pairingHistory[t2[1]][t2[0]]--;
            }

            match.team1.forEach(p1 => {
                match.team2.forEach(p2 => {
                    if (this.opponentHistory[p1]) this.opponentHistory[p1][p2]--;
                    if (this.opponentHistory[p2]) this.opponentHistory[p2][p1]--;
                });
            });
        });
    },

    // ==========================================
    // END SESSION
    // ==========================================
    endSession() {
        if (!confirm('End this session?')) return;

        const summaryContent = document.getElementById('summary-content');
        
        // Stats overview
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
                <span class="value">${Object.keys(this.playerStats).length}</span>
            </div>
        `;

        // Player table
        html += `
            <table class="summary-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Played</th>
                        <th>Rested</th>
                        <th>Unique Partners</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const sortedPlayers = Object.entries(this.playerStats)
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

        // Reset UI
        document.getElementById('player-list').innerHTML = '';
        document.querySelectorAll('.btn-court').forEach(b => b.classList.remove('selected'));
        document.querySelector('#courts-display strong').textContent = '0';
        document.getElementById('start-session-btn').disabled = true;

        this.loadSavedPlayers();
        this.renderSavedPlayers();
        this.showScreen('screen-setup');
    },

    // ==========================================
    // TOAST NOTIFICATION
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

// Initialize app
document.addEventListener('DOMContentLoaded', () => App.init());