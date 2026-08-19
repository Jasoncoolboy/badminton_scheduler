// ==========================================
// BADMINTON MATCH SCHEDULER - PWA
// ==========================================

const APP_VERSION = '2.3.0';
const SESSION_STORAGE_KEY = 'badminton_active_session';
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_CHECK_THROTTLE_MS = 30 * 1000;

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
    roundSnapshots: [],
    activeScreen: 'screen-setup',
    sessionActive: false,
    swRegistration: null,
    hasPendingRefresh: false,
    lastUpdateCheck: 0,

    // ==========================================
    // INIT
    // ==========================================
    init() {
        this.loadSavedPlayers();
        this.bindEvents();
        this.renderSavedPlayers();
        this.renderVersion();
        this.registerSW();
        this.watchForUpdates();

        if (this.restoreSession()) {
            this.showToast('Session restored after refresh');
        }
    },

    // ==========================================
    // 🔑 VERSION + UPDATES
    // ==========================================
    renderVersion(status) {
        const label = document.getElementById('version-label');
        if (label) label.textContent = `v${APP_VERSION}`;

        const statusEl = document.getElementById('version-status');
        if (statusEl) statusEl.textContent = status || 'Tap to check for updates';
    },

    registerSW() {
        if (!('serviceWorker' in navigator)) return;

        // Register a STABLE url: a versioned one (sw.js?v=x) is only ever as
        // fresh as the cached app.js that names it, so a stuck device would
        // keep asking for the version it already has. updateViaCache:'none'
        // stops the HTTP cache answering the update check as well.
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
            .then(registration => {
                this.swRegistration = registration;

                if (registration.waiting && navigator.serviceWorker.controller) {
                    this.applyUpdate(registration.waiting);
                }

                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (!newWorker) return;

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.applyUpdate(newWorker);
                        }
                    });
                });
            })
            .catch(err => console.log('SW failed:', err));

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (this.hasPendingRefresh) return;
            this.hasPendingRefresh = true;
            this.persistSession();
            window.location.reload();
        });
    },

    applyUpdate(worker) {
        this.renderVersion('Update ready — reloading…');
        worker.postMessage({ type: 'SKIP_WAITING' });

        // If the new worker never takes control, offer the manual button
        // rather than looping on reloads.
        setTimeout(() => {
            if (!this.hasPendingRefresh) this.showUpdatePrompt(worker);
        }, 4000);
    },

    // An installed Android PWA can go days without a fresh navigation, and
    // nothing else prompts the browser to look for a new service worker.
    // Ask it explicitly whenever the app comes back into use.
    watchForUpdates() {
        const check = () => this.checkForUpdate();

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') check();
        });
        window.addEventListener('focus', check);
        window.addEventListener('online', check);
        setInterval(check, UPDATE_CHECK_INTERVAL_MS);
        check();
    },

    checkForUpdate(manual = false) {
        const now = Date.now();
        if (!manual && now - this.lastUpdateCheck < UPDATE_CHECK_THROTTLE_MS) {
            return Promise.resolve();
        }
        this.lastUpdateCheck = now;
        if (manual) this.renderVersion('Checking…');

        const swCheck = this.swRegistration
            ? this.swRegistration.update().catch(() => {})
            : Promise.resolve();

        // version.json is a second opinion: it still spots a new release when
        // the service worker itself is the thing that is stuck.
        const publishedCheck = fetch(`version.json?t=${now}`, { cache: 'no-store' })
            .then(response => (response.ok ? response.json() : null))
            .catch(() => null);

        return Promise.all([swCheck, publishedCheck]).then(([, published]) => {
            const latest = published && published.version;

            if (latest && latest !== APP_VERSION) {
                this.renderVersion(`v${latest} available`);
                if (manual) {
                    this.showToast(`Updating to v${latest}…`);
                    this.forceReload();
                }
                return;
            }

            this.renderVersion(manual ? 'Up to date' : '');
            if (manual) this.showToast(`You're on the latest version (v${APP_VERSION})`);
        });
    },

    // Last resort for a device still serving an old cache: bin every cache
    // and reload. The session is in localStorage, so nothing is lost.
    forceReload() {
        const cleared = 'caches' in window
            ? caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).catch(() => {})
            : Promise.resolve();

        cleared.then(() => {
            this.hasPendingRefresh = true;
            this.persistSession();
            window.location.reload();
        });
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

    persistSession() {
        if (!this.sessionActive || this.courts <= 0 || this.sessionPlayers.length < 2) {
            return;
        }

        try {
            const payload = {
                version: APP_VERSION,
                sessionPlayers: this.sessionPlayers,
                courts: this.courts,
                rounds: this.rounds,
                currentRound: this.currentRound,
                pairingHistory: this.pairingHistory,
                opponentHistory: this.opponentHistory,
                playerStats: this.playerStats,
                restRequests: [...this.restRequests],
                presentPlayers: [...this.presentPlayers],
                roundSnapshots: this.roundSnapshots,
                activeScreen: this.activeScreen
            };
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn('Could not save session:', e);
        }
    },

    clearSession() {
        localStorage.removeItem(SESSION_STORAGE_KEY);
    },

    restoreSession() {
        try {
            const raw = localStorage.getItem(SESSION_STORAGE_KEY);
            if (!raw) return false;

            const data = JSON.parse(raw);
            if (!data.sessionPlayers?.length || !data.courts) return false;

            this.sessionPlayers = data.sessionPlayers;
            this.courts = data.courts;
            this.rounds = data.rounds || [];
            this.currentRound = data.currentRound || 0;
            this.pairingHistory = data.pairingHistory || {};
            this.opponentHistory = data.opponentHistory || {};
            this.playerStats = data.playerStats || {};
            this.restRequests = new Set(data.restRequests || []);
            this.presentPlayers = new Set(data.presentPlayers || this.sessionPlayers);
            this.roundSnapshots = data.roundSnapshots || [];
            this.activeScreen = data.activeScreen || 'screen-attendance';
            this.sessionActive = true;

            this.renderPlayerList();
            this.validateSetup();

            if (this.activeScreen === 'screen-round' && this.rounds.length > 0) {
                this.renderRound(this.rounds[this.rounds.length - 1]);
            } else if (this.activeScreen === 'screen-summary') {
                this.activeScreen = 'screen-attendance';
            } else {
                this.renderAttendance();
            }

            this.showScreen(this.activeScreen);
            return true;
        } catch (e) {
            console.warn('Could not restore session:', e);
            this.clearSession();
            return false;
        }
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
        document.getElementById('version-badge').addEventListener('click', () => this.checkForUpdate(true));

        // Attendance
        document.getElementById('add-new-player-btn').addEventListener('click', () => this.addPlayerMidSession());
        document.getElementById('new-player-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlayerMidSession();
        });
        document.getElementById('generate-round-btn').addEventListener('click', () => this.generateRound());
        document.getElementById('back-to-setup-btn').addEventListener('click', () => this.showScreen('screen-setup'));

        // Round
        document.getElementById('next-round-btn').addEventListener('click', () => this.nextRound());
        document.getElementById('undo-round-btn').addEventListener('click', () => this.undoLastRound());
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
            const removeBtn = event.target.closest('.remove-attendance-player');
            if (removeBtn) {
                this.removePlayerFromSession(removeBtn.dataset.name || '');
                return;
            }

            const row = event.target.closest('.attendance-item');
            if (row) this.toggleAttendance(row.dataset.name || '');
        });

        document.getElementById('attendance-court-selector').addEventListener('click', (event) => {
            const btn = event.target.closest('.btn-court');
            if (btn) this.selectCourts(parseInt(btn.dataset.courts, 10), true);
        });

        document.getElementById('rest-request-list').addEventListener('click', (event) => {
            const toggleBtn = event.target.closest('.rest-toggle');
            if (toggleBtn) this.toggleRestRequest(toggleBtn.dataset.name || '', toggleBtn);
        });

        window.addEventListener('pagehide', () => this.persistSession());
    },

    // ==========================================
    // SCREENS
    // ==========================================
    showScreen(screenId) {
        this.activeScreen = screenId;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
        window.scrollTo(0, 0);
        this.persistSession();
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
    selectCourts(num, fromAttendance = false) {
        const prev = this.courts;
        this.courts = num;

        document.querySelectorAll('#screen-setup .btn-court, #attendance-court-selector .btn-court')
            .forEach(btn => {
                btn.classList.toggle('selected', parseInt(btn.dataset.courts, 10) === num);
            });

        const setupDisplay = document.querySelector('#courts-display strong');
        if (setupDisplay) setupDisplay.textContent = num;

        const attendanceDisplay = document.querySelector('#attendance-courts-display strong');
        if (attendanceDisplay) attendanceDisplay.textContent = num;

        this.validateSetup();

        if (fromAttendance && prev !== num) {
            this.renderAttendance();
            this.persistSession();
            this.showToast(`Courts set to ${num}`);
        }
    },

    syncCourtSelectors() {
        if (this.courts > 0) {
            this.selectCourts(this.courts);
        }
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
        this.sessionActive = true;

        this.playerStats = {};
        this.pairingHistory = {};
        this.opponentHistory = {};

        this.sessionPlayers.forEach(name => {
            this.initPlayerData(name);
        });

        this.rounds = [];
        this.currentRound = 0;
        this.roundSnapshots = [];
        this.restRequests.clear();
        this.presentPlayers = new Set(this.sessionPlayers);

        this.syncCourtSelectors();
        this.renderAttendance();
        this.showScreen('screen-attendance');
        this.persistSession();
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
        this.persistSession();
        this.showToast(`${name} added! They'll get priority to play.`);
    },

    removePlayerFromSession(name) {
        if (!name) return;

        const stats = this.playerStats[name];
        const hasHistory = stats && (stats.gamesPlayed > 0 || stats.restCount > 0);
        const msg = hasHistory
            ? `Remove ${name} from this session? Their stats for today will be kept in the summary.`
            : `Remove ${name} from this session?`;

        if (!confirm(msg)) return;

        this.sessionPlayers = this.sessionPlayers.filter(p => p !== name);
        this.presentPlayers.delete(name);
        this.restRequests.delete(name);

        if (this.sessionPlayers.length < 2) {
            this.showToast('Need at least 2 players. End session or add players.');
        }

        this.renderAttendance();
        this.persistSession();
        this.showToast(`${name} removed from session`);
    },

    // ==========================================
    // ATTENDANCE
    // ==========================================
    renderAttendance() {
        this.syncCourtSelectors();
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

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'remove-attendance-player';
            removeBtn.dataset.name = name;
            removeBtn.setAttribute('aria-label', `Remove ${name}`);
            removeBtn.textContent = '\u00D7';

            row.appendChild(info);
            row.appendChild(status);
            row.appendChild(removeBtn);
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
        this.persistSession();
    },

    // ==========================================
    // 🔑 PAIRING / OPPONENT HISTORY INDEX
    // ==========================================
    // Rebuilt from this.rounds before every search, so it always matches the
    // real match log — including after an Undo.
    buildHistoryIndex() {
        const index = {
            roundNumber: Math.max(this.currentRound, this.rounds.length + 1),
            partnerCount: {},
            partnerLast: {},
            opponentCount: {},
            opponentLast: {}
        };

        const bump = (counts, last, a, b, roundNumber) => {
            if (!counts[a]) counts[a] = {};
            if (!last[a]) last[a] = {};
            counts[a][b] = (counts[a][b] || 0) + 1;
            last[a][b] = Math.max(last[a][b] || 0, roundNumber);
        };

        this.rounds.forEach((round, i) => {
            const roundNumber = round.roundNumber || i + 1;
            (round.matches || []).forEach(match => {
                if (match.type === 'doubles') {
                    [match.team1, match.team2].forEach(team => {
                        if (!team || team.length !== 2) return;
                        bump(index.partnerCount, index.partnerLast, team[0], team[1], roundNumber);
                        bump(index.partnerCount, index.partnerLast, team[1], team[0], roundNumber);
                    });
                }
                (match.team1 || []).forEach(p1 => {
                    (match.team2 || []).forEach(p2 => {
                        bump(index.opponentCount, index.opponentLast, p1, p2, roundNumber);
                        bump(index.opponentCount, index.opponentLast, p2, p1, roundNumber);
                    });
                });
            });
        });

        return index;
    },

    // ==========================================
    // 🔑 COST MODEL
    // ==========================================
    // Costs are vectors compared LEXICOGRAPHICALLY: an earlier entry always
    // outranks every later one. That is what keeps partnerships unique — a
    // repeated pairing can never be traded away for fresher opponents, no
    // matter how many opponent repeats the trade would save.
    //
    //   [0] partner repeats   sum of count^2 over the round's partnerships
    //   [1] partner recency   how recently those repeats last happened
    //   [2] opponent repeats  sum of count^2 over the round's opponent pairs
    //   [3] opponent recency  how recently those repeats last happened
    //
    // count^2 rather than count spreads repeats around: pairing two different
    // duos for a 2nd time (1+1) beats pairing one duo for a 3rd time (4).
    RECENCY_SPAN: 8,

    zeroCost() {
        return [0, 0, 0, 0];
    },

    addCost(a, b) {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
    },

    compareCost(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] - b[i];
        }
        return 0;
    },

    isZeroCost(cost) {
        return cost.every(value => value === 0);
    },

    recencyWeight(lastRound, currentRound) {
        if (!lastRound) return 0;
        const gap = Math.max(1, currentRound - lastRound);
        return gap >= this.RECENCY_SPAN ? 0 : this.RECENCY_SPAN - gap;
    },

    addPartnershipCost(cost, index, p1, p2) {
        const count = index.partnerCount[p1]?.[p2] || 0;
        if (!count) return;
        cost[0] += count * count;
        cost[1] += this.recencyWeight(index.partnerLast[p1]?.[p2], index.roundNumber);
    },

    addOpponentCost(cost, index, p1, p2) {
        const count = index.opponentCount[p1]?.[p2] || 0;
        if (!count) return;
        cost[2] += count * count;
        cost[3] += this.recencyWeight(index.opponentLast[p1]?.[p2], index.roundNumber);
    },

    doublesMatchCost(index, team1, team2) {
        const cost = this.zeroCost();
        this.addPartnershipCost(cost, index, team1[0], team1[1]);
        this.addPartnershipCost(cost, index, team2[0], team2[1]);
        team1.forEach(p1 => team2.forEach(p2 => this.addOpponentCost(cost, index, p1, p2)));
        return cost;
    },

    singlesMatchCost(index, p1, p2) {
        const cost = this.zeroCost();
        this.addOpponentCost(cost, index, p1, p2);
        return cost;
    },

    // ==========================================
    // 🔑 FAIR REST SELECTION
    // ==========================================
    // Every group this returns is EQUALLY fair to sit out, so the caller can
    // choose between them on pairing freshness without trading away fairness.
    // Swapping resters helps most when few people are on court (6 players on
    // 1 court live or die by who sits out); with a big playing group it buys
    // little and every extra group costs another search.
    restCandidateLimit(playingCount) {
        if (playingCount <= 8) return 24;
        if (playingCount <= 12) return 12;
        return 6;
    },

    restFairnessKey(name) {
        const s = this.playerStats[name] || { gamesPlayed: 0, restCount: 0, consecutivePlayed: 0 };
        return [
            // new/returning players (0 games) sort last, so they play first
            s.gamesPlayed === 0 ? 1 : 0,
            -(s.gamesPlayed - s.restCount),   // most overdue for a rest first
            -s.consecutivePlayed              // longest unbroken run first
        ];
    },

    buildRestCandidates(available, restCount) {
        if (restCount <= 0) return [[]];
        const limit = this.restCandidateLimit(available.length - restCount);

        const requested = available.filter(p => this.restRequests.has(p));
        if (requested.length >= restCount) {
            return [this.shuffled(requested).slice(0, restCount)];
        }

        const pool = available.filter(p => !this.restRequests.has(p));
        let slotsLeft = restCount - requested.length;

        const keyed = pool.map(name => ({ name, key: this.restFairnessKey(name) }));
        keyed.sort((a, b) => this.compareCost(a.key, b.key));

        // players sharing a fairness key are interchangeable
        const groups = [];
        keyed.forEach(entry => {
            const last = groups[groups.length - 1];
            if (last && this.compareCost(last.key, entry.key) === 0) last.names.push(entry.name);
            else groups.push({ key: entry.key, names: [entry.name] });
        });

        const forced = [];
        let boundary = null;
        for (const group of groups) {
            if (slotsLeft <= 0) break;
            if (group.names.length <= slotsLeft) {
                forced.push(...group.names);
                slotsLeft -= group.names.length;
            } else {
                boundary = { names: group.names, pick: slotsLeft };
                slotsLeft = 0;
            }
        }

        if (!boundary) return [[...requested, ...forced]];

        // only the group straddling the cut has a genuine choice in it
        return this.shuffled(this.combinations(boundary.names, boundary.pick))
            .slice(0, limit)
            .map(option => [...requested, ...forced, ...option]);
    },

    selectRestingPlayers(available, restCount) {
        return this.buildRestCandidates(available, restCount)[0] || [];
    },

    // ==========================================
    // ROUND GENERATION
    // ==========================================
    deepClone(value) {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    },

    shuffled(list) {
        const arr = [...list];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    },

    captureRoundSnapshot() {
        this.roundSnapshots.push({
            sessionPlayers: [...this.sessionPlayers],
            courts: this.courts,
            rounds: this.deepClone(this.rounds),
            currentRound: this.currentRound,
            pairingHistory: this.deepClone(this.pairingHistory),
            opponentHistory: this.deepClone(this.opponentHistory),
            playerStats: this.deepClone(this.playerStats),
            restRequests: [...this.restRequests],
            presentPlayers: [...this.presentPlayers]
        });
    },

    restoreRoundSnapshot(snapshot) {
        this.sessionPlayers = [...snapshot.sessionPlayers];
        this.courts = snapshot.courts;
        this.rounds = this.deepClone(snapshot.rounds);
        this.currentRound = snapshot.currentRound;
        this.pairingHistory = this.deepClone(snapshot.pairingHistory);
        this.opponentHistory = this.deepClone(snapshot.opponentHistory);
        this.playerStats = this.deepClone(snapshot.playerStats);
        this.restRequests = new Set(snapshot.restRequests);
        this.presentPlayers = new Set(snapshot.presentPlayers);
    },

    generateRound() {
        this.captureRoundSnapshot();
        this.currentRound++;
        const round = this.createRoundSchedule();
        this.rounds.push(round);
        this.updateStats(round);
        this.renderRound(round);
        this.showScreen('screen-round');
        this.persistSession();
    },

    planCourts(playerCount, courts) {
        const doubles = Math.min(Math.floor(playerCount / 4), courts);
        const leftoverPlayers = playerCount - (doubles * 4);
        const leftoverCourts = courts - doubles;
        const singles = Math.min(Math.floor(leftoverPlayers / 2), leftoverCourts);
        const slots = (doubles * 4) + (singles * 2);
        return { doubles, singles, slots, resting: playerCount - slots };
    },

    createRoundSchedule() {
        const allPresent = [...this.presentPlayers];
        const index = this.buildHistoryIndex();
        const plan = this.planCourts(allPresent.length, this.courts);

        // Who sits out decides which pairings are even reachable, so try every
        // equally-fair rest group and keep whichever gives the freshest round.
        const budget = this.newSearchBudget();
        let best = null;
        for (const resting of this.buildRestCandidates(allPresent, plan.resting)) {
            const playing = allPresent.filter(p => !resting.includes(p));
            const schedule = this.findBestSchedule(index, playing, plan.doubles, plan.singles, budget);
            if (!schedule) continue;
            if (!best || this.compareCost(schedule.cost, best.schedule.cost) < 0) {
                best = { resting, playing, schedule };
            }
            if (this.isZeroCost(best.schedule.cost)) break;
        }

        if (best) {
            return {
                roundNumber: this.currentRound,
                matches: best.schedule.matches,
                resting: best.resting,
                playing: best.playing
            };
        }

        // Safety net: only reached if the exact search ran out of budget.
        const resting = this.selectRestingPlayers(allPresent, plan.resting);
        const playing = allPresent.filter(p => !resting.includes(p));
        return {
            roundNumber: this.currentRound,
            matches: this.buildScheduleGreedy(index, playing, plan.doubles, plan.singles),
            resting,
            playing
        };
    },

    combinations(arr, k) {
        if (k === 0) return [[]];
        if (arr.length < k) return [];
        const [first, ...rest] = arr;
        return [
            ...this.combinations(rest, k - 1).map(combo => [first, ...combo]),
            ...this.combinations(rest, k)
        ];
    },

    getAllTeamSplits(fourPlayers) {
        const [a, b, c, d] = fourPlayers;
        return [
            { team1: [a, b], team2: [c, d] },
            { team1: [a, c], team2: [b, d] },
            { team1: [a, d], team2: [b, c] }
        ];
    },

    // ==========================================
    // 🔑 SCHEDULE SEARCH (branch and bound)
    // ==========================================
    // Every way of splitting the playing group across the courts is reachable:
    // the first still-unassigned player anchors the next match, so each layout
    // is generated exactly once. Candidates are tried cheapest-first, which
    // makes the very first complete layout a strong bound — everything that
    // cannot beat it is pruned, and a zero-repeat layout cuts the branch dead.
    // One budget covers the whole round, shared across every rest group, so a
    // big session can never freeze the phone. Running out is safe: the search
    // always finishes its first cheapest-first dive before the budget applies,
    // so it still returns a layout — just a less polished one.
    SEARCH_NODE_BUDGET: 80000,
    SEARCH_TIME_BUDGET_MS: 500,

    newSearchBudget() {
        return { nodes: this.SEARCH_NODE_BUDGET, deadline: Date.now() + this.SEARCH_TIME_BUDGET_MS };
    },

    findBestSchedule(index, players, doublesCount, singlesCount, budget) {
        if (players.length !== (doublesCount * 4) + (singlesCount * 2)) return null;
        if (!players.length) return { matches: [], cost: this.zeroCost() };

        budget = budget || this.newSearchBudget();
        let best = null;
        const spent = () => best && (budget.nodes <= 0 || Date.now() > budget.deadline);

        const search = (remaining, doublesLeft, singlesLeft, chosen, costSoFar) => {
            if (!remaining.length) {
                if (doublesLeft === 0 && singlesLeft === 0 &&
                    (!best || this.compareCost(costSoFar, best.cost) < 0)) {
                    best = { matches: chosen.slice(), cost: costSoFar };
                }
                return;
            }
            if (spent()) return;

            const anchor = remaining[0];
            const rest = remaining.slice(1);
            const candidates = [];

            if (doublesLeft > 0 && rest.length >= 3) {
                for (const trio of this.combinations(rest, 3)) {
                    for (const split of this.getAllTeamSplits([anchor, ...trio])) {
                        candidates.push({
                            type: 'doubles',
                            team1: split.team1,
                            team2: split.team2,
                            cost: this.doublesMatchCost(index, split.team1, split.team2)
                        });
                    }
                }
            }
            if (singlesLeft > 0) {
                rest.forEach(opponent => {
                    candidates.push({
                        type: 'singles',
                        team1: [anchor],
                        team2: [opponent],
                        cost: this.singlesMatchCost(index, anchor, opponent)
                    });
                });
            }

            budget.nodes -= candidates.length;

            // cheapest first, ties shuffled so equally fresh rounds still vary
            candidates.forEach(candidate => { candidate.tiebreak = Math.random(); });
            candidates.sort((a, b) => this.compareCost(a.cost, b.cost) || a.tiebreak - b.tiebreak);

            for (const candidate of candidates) {
                const nextCost = this.addCost(costSoFar, candidate.cost);
                // sorted ascending, so once one candidate cannot beat the
                // incumbent, none of the ones behind it can either
                if (best && this.compareCost(nextCost, best.cost) >= 0) break;

                const used = new Set([...candidate.team1, ...candidate.team2]);
                chosen.push(candidate);
                search(
                    rest.filter(p => !used.has(p)),
                    doublesLeft - (candidate.type === 'doubles' ? 1 : 0),
                    singlesLeft - (candidate.type === 'singles' ? 1 : 0),
                    chosen,
                    nextCost
                );
                chosen.pop();

                if (spent()) return;
            }
        };

        search(this.shuffled(players), doublesCount, singlesCount, [], this.zeroCost());
        if (!best) return null;

        return { matches: this.numberCourts(best.matches), cost: best.cost };
    },

    // doubles courts first, then singles, so court numbers read consistently
    numberCourts(matches) {
        return [
            ...matches.filter(m => m.type === 'doubles'),
            ...matches.filter(m => m.type === 'singles')
        ].map((match, i) => ({
            court: i + 1,
            type: match.type,
            team1: [...match.team1],
            team2: [...match.team2]
        }));
    },

    buildScheduleGreedy(index, players, doublesCount, singlesCount) {
        const matches = [];
        let pool = this.shuffled(players);

        for (let i = 0; i < doublesCount && pool.length >= 4; i++) {
            let pick = null;
            for (const trio of this.combinations(pool.slice(1), 3)) {
                const four = [pool[0], ...trio];
                for (const split of this.getAllTeamSplits(four)) {
                    const cost = this.doublesMatchCost(index, split.team1, split.team2);
                    if (!pick || this.compareCost(cost, pick.cost) < 0) {
                        pick = { type: 'doubles', team1: split.team1, team2: split.team2, four, cost };
                    }
                }
            }
            if (!pick) break;
            matches.push(pick);
            pool = pool.filter(p => !pick.four.includes(p));
        }

        for (let i = 0; i < singlesCount && pool.length >= 2; i++) {
            let pick = null;
            for (let j = 1; j < pool.length; j++) {
                const cost = this.singlesMatchCost(index, pool[0], pool[j]);
                if (!pick || this.compareCost(cost, pick.cost) < 0) {
                    pick = { type: 'singles', team1: [pool[0]], team2: [pool[j]], cost };
                }
            }
            if (!pick) break;
            matches.push(pick);
            pool = pool.filter(p => p !== pick.team1[0] && p !== pick.team2[0]);
        }

        return this.numberCourts(matches);
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
        this.persistSession();
    },

    // ==========================================
    // ACTIONS
    // ==========================================
    nextRound() {
        this.renderAttendance();
        this.showScreen('screen-attendance');
        this.persistSession();
    },

    undoLastRound() {
        if (this.roundSnapshots.length === 0 || this.rounds.length === 0) {
            this.showToast('No round to undo.');
            return;
        }

        const roundToUndo = this.currentRound;
        if (!confirm(`Undo Round ${roundToUndo}? This will restore stats and pairings to the previous state.`)) {
            return;
        }

        const snapshot = this.roundSnapshots.pop();
        this.restoreRoundSnapshot(snapshot);

        if (this.rounds.length > 0) {
            this.renderRound(this.rounds[this.rounds.length - 1]);
            this.showScreen('screen-round');
            this.showToast(`Round ${this.currentRound + 1} undone.`);
            this.persistSession();
            return;
        }

        this.renderAttendance();
        this.showScreen('screen-attendance');
        this.showToast('Round 1 undone.');
        this.persistSession();
    },

    endSession() {
        if (!confirm('End this session?')) return;

        this.sessionActive = false;
        this.clearSession();

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
        text.textContent = 'Update ready. Tap Refresh to load it.';

        const button = document.createElement('button');
        button.className = 'btn btn-primary';
        button.textContent = 'Refresh';
        button.addEventListener('click', () => {
            toast.remove();
            if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
            this.forceReload();
        });

        toast.appendChild(text);
        toast.appendChild(button);
        document.body.appendChild(toast);
    },

    newSession() {
        this.sessionActive = false;
        this.clearSession();
        this.sessionPlayers = [];
        this.courts = 0;
        this.rounds = [];
        this.currentRound = 0;
        this.roundSnapshots = [];
        this.pairingHistory = {};
        this.opponentHistory = {};
        this.playerStats = {};
        this.restRequests.clear();
        this.presentPlayers.clear();
        this.activeScreen = 'screen-setup';

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
