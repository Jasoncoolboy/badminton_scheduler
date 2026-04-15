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
    swRegistration: null,
    hasPendingRefresh: false,

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
                .then(registration => {
                    this.swRegistration = registration;
                    console.log('SW registered');

                    if (registration.waiting) {
                        this.showUpdatePrompt(registration.waiting);
                    }

                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        if (!newWorker) return;

                        newWorker.addEventListener('statechange', () => {
                            if (
                                newWorker.state === 'installed' &&
                                navigator.serviceWorker.controller
                            ) {
                                this.showUpdatePrompt(newWorker);
                            }
                        });
                    });
                })
                .catch(err => console.log('SW failed:', err));

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (this.hasPendingRefresh) return;
                this.hasPendingRefresh = true;
                window.location.reload();
            });
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

        document.getElementById('player-list').addEventListener('click', (event) => {
            const removeBtn = event.target.closest('.remove-player');
            if (!removeBtn) return;
            this.removePlayer(removeBtn.dataset.name || '');
        });

        document.getElementById('saved-player-list').addEventListener('click', (event) => {
            const deleteBtn = event.target.closest('.delete-saved');
            if (deleteBtn) {
                this.deleteSavedPlayer(deleteBtn.dataset.name || '');
                return;
            }

            const tag = event.target.closest('.saved-player-tag');
            if (tag) this.addSavedPlayer(tag.dataset.name || '');
        });

        document.getElementById('attendance-list').addEventListener('click', (event) => {
            const row = event.target.closest('.attendance-item');
            if (row) this.toggleAttendance(row.dataset.name || '');
        });

        document.getElementById('rest-request-list').addEventListener('click', (event) => {
            const toggleBtn = event.target.closest('.rest-toggle');
            if (toggleBtn) this.toggleRestRequest(toggleBtn.dataset.name || '', toggleBtn);
        });
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

    deleteSavedPlayer(name) {
        this.savedPlayers = this.savedPlayers.filter(p => p !== name);
        localStorage.setItem('badminton_saved_players', JSON.stringify(this.savedPlayers));
        this.renderSavedPlayers();
    },

    renderPlayerList() {
        const container = document.getElementById('player-list');
        container.innerHTML = '';

        this.sessionPlayers.forEach(name => {
            const tag = document.createElement('span');
            tag.className = 'player-tag';

            const label = document.createElement('span');
            label.textContent = name;
            tag.appendChild(label);

            const removeBtn = document.createElement('span');
            removeBtn.className = 'remove-player';
            removeBtn.dataset.name = name;
            removeBtn.textContent = '\u00D7';
            tag.appendChild(removeBtn);

            container.appendChild(tag);
        });
    },

    renderSavedPlayers() {
        const container = document.getElementById('saved-player-list');
        const sessionLower = this.sessionPlayers.map(p => p.toLowerCase());
        container.innerHTML = '';

        this.savedPlayers.forEach(name => {
            const added = sessionLower.includes(name.toLowerCase());
            const tag = document.createElement('span');
            tag.className = `saved-player-tag ${added ? 'added' : ''}`.trim();
            tag.dataset.name = name;

            const label = document.createElement('span');
            label.textContent = name;
            tag.appendChild(label);

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'delete-saved';
            deleteBtn.dataset.name = name;
            deleteBtn.textContent = '\u00D7';
            tag.appendChild(deleteBtn);

            container.appendChild(tag);
        });

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
        container.innerHTML = '';

        this.sessionPlayers.forEach(name => {
            const isPresent = this.presentPlayers.has(name);
            const stats = this.playerStats[name];
            const isNew = stats && stats.gamesPlayed === 0 && stats.joinedAtRound > 0;
            const row = document.createElement('div');
            row.className = `attendance-item ${isPresent ? 'present' : 'absent'}`;
            row.dataset.name = name;

            const info = document.createElement('div');
            info.className = 'player-info';

            const topLine = document.createElement('span');
            topLine.textContent = name;

            if (isNew) {
                const badge = document.createElement('span');
                badge.className = 'new-badge';
                badge.textContent = 'NEW';
                topLine.appendChild(document.createTextNode(' '));
                topLine.appendChild(badge);
            }

            const statsLine = document.createElement('span');
            statsLine.className = 'player-stats-line';
            statsLine.textContent = `Played: ${stats?.gamesPlayed || 0} | Rested: ${stats?.restCount || 0}`;

            info.appendChild(topLine);
            info.appendChild(statsLine);

            const status = document.createElement('span');
            status.className = 'attendance-status';
            status.textContent = isPresent ? '✅' : '❌';

            row.appendChild(info);
            row.appendChild(status);
            container.appendChild(row);
        });

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
        mc.innerHTML = '';
        round.matches.forEach(match => {
            const card = document.createElement('div');
            card.className = `match-card ${match.type}`;

            const label = document.createElement('div');
            label.className = 'court-label';

            const court = document.createElement('span');
            court.textContent = `Court ${match.court}`;
            const type = document.createElement('span');
            type.className = 'match-type';
            type.textContent = match.type.toUpperCase();
            label.appendChild(court);
            label.appendChild(type);

            const vsWrap = document.createElement('div');
            vsWrap.className = 'vs-container';

            const team1 = document.createElement('div');
            team1.className = 'team';
            match.team1.forEach(player => {
                const p = document.createElement('span');
                p.className = 'player-name';
                p.textContent = player;
                team1.appendChild(p);
            });

            const vs = document.createElement('span');
            vs.className = 'vs';
            vs.textContent = 'VS';

            const team2 = document.createElement('div');
            team2.className = 'team';
            match.team2.forEach(player => {
                const p = document.createElement('span');
                p.className = 'player-name';
                p.textContent = player;
                team2.appendChild(p);
            });

            vsWrap.appendChild(team1);
            vsWrap.appendChild(vs);
            vsWrap.appendChild(team2);
            card.appendChild(label);
            card.appendChild(vsWrap);
            mc.appendChild(card);
        });

        // Resting
        const rc = document.getElementById('resting-container');
        const rl = document.getElementById('resting-list');
        if (round.resting.length > 0) {
            rc.classList.remove('hidden');
            rl.innerHTML = '';
            round.resting.forEach(name => {
                const s = this.playerStats[name];
                const tag = document.createElement('span');
                tag.className = 'resting-tag';
                tag.textContent = `${name} (P:${s?.gamesPlayed || 0} R:${s?.restCount || 0})`;
                rl.appendChild(tag);
            });
        } else {
            rc.classList.add('hidden');
        }

        // Rest requests
        const allInRound = [...round.playing, ...round.resting]
            .filter(p => this.presentPlayers.has(p));

        const rrl = document.getElementById('rest-request-list');
        rrl.innerHTML = '';
        allInRound.forEach(name => {
            const s = this.playerStats[name];
            const item = document.createElement('div');
            item.className = 'rest-request-item';

            const playerLabel = document.createElement('div');
            playerLabel.className = 'player-label';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            const statsSpan = document.createElement('span');
            statsSpan.className = 'mini-stats';
            statsSpan.textContent = `Played: ${s?.gamesPlayed || 0} | Rested: ${s?.restCount || 0}`;

            playerLabel.appendChild(nameSpan);
            playerLabel.appendChild(statsSpan);

            const button = document.createElement('button');
            button.className = `rest-toggle ${this.restRequests.has(name) ? 'active' : ''}`.trim();
            button.dataset.name = name;

            item.appendChild(playerLabel);
            item.appendChild(button);
            rrl.appendChild(item);
        });
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
        sc.innerHTML = '';
        const activePlayers = Object.entries(this.playerStats)
            .filter(([_, s]) => s.gamesPlayed > 0 || s.restCount > 0)
            .sort((a, b) => b[1].gamesPlayed - a[1].gamesPlayed);

        const summaryStats = [
            { label: 'Total Rounds', value: this.rounds.length },
            { label: 'Courts', value: this.courts },
            { label: 'Players', value: activePlayers.length }
        ];

        summaryStats.forEach(stat => {
            const card = document.createElement('div');
            card.className = 'summary-stat';
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = stat.label;
            const value = document.createElement('span');
            value.className = 'value';
            value.textContent = String(stat.value);
            card.appendChild(label);
            card.appendChild(value);
            sc.appendChild(card);
        });

        const table = document.createElement('table');
        table.className = 'summary-table';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Player', 'Played', 'Rested', 'Partners'].forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);

        const tbody = document.createElement('tbody');
        activePlayers.forEach(([name, stats]) => {
            const row = document.createElement('tr');
            const uniquePartners = [...new Set(stats.partners)].length;
            const values = [name, stats.gamesPlayed, stats.restCount, uniquePartners];

            values.forEach((value, index) => {
                const cell = document.createElement('td');
                if (index === 0) {
                    const strong = document.createElement('strong');
                    strong.textContent = String(value);
                    cell.appendChild(strong);
                } else {
                    cell.textContent = String(value);
                }
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });

        table.appendChild(thead);
        table.appendChild(tbody);
        sc.appendChild(table);
        this.showScreen('screen-summary');
    },

    showUpdatePrompt(worker) {
        const existing = document.getElementById('update-toast');
        if (existing) return;

        const toast = document.createElement('div');
        toast.id = 'update-toast';
        toast.className = 'toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 120px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--card-bg);
            color: var(--text);
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 1100;
            border: 1px solid var(--card-border);
            display: flex;
            align-items: center;
            gap: 10px;
        `;

        const text = document.createElement('span');
        text.textContent = 'New version available.';

        const button = document.createElement('button');
        button.className = 'btn btn-primary';
        button.textContent = 'Refresh';
        button.addEventListener('click', () => {
            worker.postMessage({ type: 'SKIP_WAITING' });
            toast.remove();
        });

        toast.appendChild(text);
        toast.appendChild(button);
        document.body.appendChild(toast);
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
