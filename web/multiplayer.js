// multiplayer.js — Real-time multiplayer via Firebase Realtime Database
//
// Architecture: pure logic functions (testable, no DOM) + thin UI layer.
// Firebase state is the source of truth; all clients render from it.

// ============================================================
// Pure logic (exported for testing via globalThis in browser)
// ============================================================

const MP = {};

// --- Room code generation ---
MP.generateRoomCode = function() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O (avoid confusion with 1, 0)
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

// --- Board building (same shuffle as single-player) ---
MP.buildBoard = function(numPairs, tileNames) {
  const shuffled = [...tileNames];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selected = shuffled.slice(0, numPairs);
  const deck = selected.flatMap(name => [name, name]);
  // Shuffle the deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

// --- Turn logic ---
MP.isMyTurn = function(room, myUid) {
  if (!room || !room.playerOrder || room.status !== 'playing') return false;
  const currentUid = room.playerOrder[room.currentTurn];
  return currentUid === myUid;
};

MP.canFlip = function(room, myUid, cardIdx) {
  if (!MP.isMyTurn(room, myUid)) return false;
  if (room.matched && room.matched[cardIdx]) return false;
  if (room.flipped && room.flipped.includes(cardIdx)) return false;
  if (room.flipped && room.flipped.length >= 2) return false;
  return true;
};

// --- Match detection ---
MP.checkMatch = function(board, flipped) {
  if (!flipped || flipped.length !== 2) return null;
  const [a, b] = flipped;
  return board[a] === board[b];
};

// --- Scoring ---
MP.getScores = function(players) {
  if (!players) return [];
  return Object.entries(players).map(([uid, p]) => ({
    uid,
    name: p.name,
    score: p.score || 0,
  })).sort((a, b) => b.score - a.score);
};

MP.getWinner = function(players) {
  const scores = MP.getScores(players);
  if (scores.length === 0) return null;
  if (scores.length === 1) return scores[0];
  if (scores[0].score === scores[1].score) return { tie: true, scores };
  return scores[0];
};

// --- Game over detection ---
MP.isGameOver = function(matched) {
  if (!matched) return false;
  return matched.every(m => m === 1);
};

// --- Next turn ---
MP.nextTurn = function(currentTurn, playerOrder) {
  return (currentTurn + 1) % playerOrder.length;
};

// --- Role detection ---
MP.getRole = function(room, myUid) {
  if (!room || !room.playerOrder) return 'spectator';
  if (room.playerOrder.includes(myUid)) return 'player';
  return 'spectator';
};

// --- Grid columns (reuse single-player logic) ---
MP.gridColumns = function(numCards, viewportWidth) {
  const narrow = viewportWidth < 600;
  if (numCards <= 24) return narrow ? 4 : 6;
  if (numCards <= 36) return narrow ? 4 : 6;
  return narrow ? 6 : 8;
};

// --- Name sanitization ---
MP.sanitizeName = function(raw) {
  if (typeof raw !== 'string') return '';
  // Strip control characters, trim, cap length
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, 15);
};

// --- Room expiry ---
MP.isExpired = function(room, now, ttlMs) {
  if (!room) return true;
  const created = room.createdAt || 0;
  const lastActivity = room.lastActivityAt || created;
  const age = now - Math.max(created, lastActivity);
  return age > ttlMs;
};

// --- Presence ---
MP.getOnlinePlayers = function(room) {
  if (!room || !room.playerOrder) return [];
  return room.playerOrder.filter(uid =>
    room.presence && room.presence[uid] === true
  );
};

MP.getOfflinePlayers = function(room) {
  if (!room || !room.playerOrder) return [];
  return room.playerOrder.filter(uid =>
    !room.presence || room.presence[uid] !== true
  );
};

MP.isPaused = function(room) {
  if (!room || room.status !== 'playing') return false;
  if (!room.playerOrder || room.playerOrder.length < 2) return false;
  return MP.getOfflinePlayers(room).length > 0;
};

// --- Forfeit grace period ---
// Returns ms remaining until forfeit eligible. 0 means already eligible.
MP.timeUntilForfeit = function(room, now, gracePeriodMs) {
  if (!MP.isPaused(room)) return Infinity;
  const offline = MP.getOfflinePlayers(room);
  if (offline.length === 0) return Infinity;
  const disconnectedAts = (room.disconnectedAt || {});
  const earliestDisconnect = Math.min(
    ...offline.map(uid => disconnectedAts[uid] || now)
  );
  const elapsed = now - earliestDisconnect;
  return Math.max(0, gracePeriodMs - elapsed);
};

// --- State transition builders (return Firebase update objects, no IO) ---

MP.applyMatch = function(room, uid, flippedIndices) {
  const newMatched = [...(room.matched || [])];
  newMatched[flippedIndices[0]] = 1;
  newMatched[flippedIndices[1]] = 1;
  const updates = {
    matched: newMatched,
    flipped: [],
    [`players/${uid}/score`]: ((room.players[uid] || {}).score || 0) + 1,
    lastActivityAt: { '.sv': 'timestamp' },
  };
  if (MP.isGameOver(newMatched)) {
    updates.status = 'finished';
  }
  return updates;
};

MP.applyMismatch = function(room) {
  return {
    flipped: [],
    currentTurn: MP.nextTurn(room.currentTurn, room.playerOrder),
    lastActivityAt: { '.sv': 'timestamp' },
  };
};

MP.applyForfeit = function(room, winnerUid) {
  const newSessionScores = { ...(room.sessionScores || {}) };
  newSessionScores[winnerUid] = (newSessionScores[winnerUid] || 0) + 1;
  return {
    status: 'finished',
    forfeitWinner: winnerUid,
    sessionScores: newSessionScores,
    lastActivityAt: { '.sv': 'timestamp' },
  };
};

// Increments session score for the given winner. Returns updates object.
// Pass winnerUid=null for ties (no increment).
MP.incrementSessionScore = function(room, winnerUid) {
  if (!winnerUid) return {};
  const newSessionScores = { ...(room.sessionScores || {}) };
  newSessionScores[winnerUid] = (newSessionScores[winnerUid] || 0) + 1;
  return { sessionScores: newSessionScores };
};

// Reset only the in-game state for a "Play Again", preserving session scores.
MP.applyResetForRematch = function(room, newBoard) {
  const matched = new Array(newBoard.length).fill(0);
  const resetPlayers = {};
  for (const uid of room.playerOrder) {
    resetPlayers[uid] = {
      name: room.players[uid].name,
      score: 0,
    };
  }
  return {
    board: newBoard,
    matched,
    flipped: [],
    players: resetPlayers,
    currentTurn: 0,
    status: 'playing',
    forfeitWinner: null,
    lastActivityAt: { '.sv': 'timestamp' },
    // sessionScores preserved
  };
};

// Expose for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MP;
} else {
  globalThis.MP = MP;
}

// ============================================================
// Browser UI layer (only runs in browser with DOM + Firebase)
// ============================================================

if (typeof document !== 'undefined') {
  (function() {
    const TILE_NAMES = [
      "cherries", "ellipse", "sparrow", "beetle",
      "black_haired_boy", "ant", "diamonds", "triangle",
      "lion", "bananas", "cardinal", "tulip",
      "red_haired_boy", "canary", "dice", "rabbit",
      "red_circle", "hexagon", "skipping_rope", "bee",
      "lemon", "daisy", "checkerboard", "sunflower",
      "roller_skate", "grasshopper", "owls", "parrot",
      "peacock", "strawberry", "doll", "baby_carriage",
      "flag", "rose", "tiger", "stripes",
    ];

    let roomRef = null;
    let roomListener = null;
    let myUid = null;
    let currentRoom = null;
    let roomCode = null;
    let flipTimeout = null;

    function getDb() { return firebase.database(); }

    // Resolve with the authenticated user's UID, or null if auth fails.
    // Waits for both the authPromise AND onAuthStateChanged to ensure
    // currentUser is populated.
    function waitForUid() {
      return new Promise((resolve) => {
        const currentUser = firebase.auth().currentUser;
        if (currentUser) { resolve(currentUser.uid); return; }

        const unsub = firebase.auth().onAuthStateChanged(user => {
          if (user) { unsub(); resolve(user.uid); }
        });

        // Safety timeout
        setTimeout(() => {
          unsub();
          const u = firebase.auth().currentUser;
          resolve(u ? u.uid : null);
        }, 5000);
      });
    }

    // --- Room creation ---
    async function createRoom(difficulty) {
      myUid = await waitForUid();
      if (!myUid) { alert('Authentication failed. Please refresh.'); return; }

      const name = getPlayerName();
      if (!name) return;

      // Generate unique code
      let code;
      for (let attempt = 0; attempt < 10; attempt++) {
        code = MP.generateRoomCode();
        const snap = await getDb().ref(`rooms/${code}`).once('value');
        if (!snap.exists()) break;
        if (attempt === 9) { alert('Could not create room. Try again.'); return; }
      }

      const board = MP.buildBoard(difficulty, TILE_NAMES);
      const matched = new Array(board.length).fill(0);

      const roomData = {
        board,
        matched,
        flipped: [],
        players: { [myUid]: { name, score: 0 } },
        playerOrder: [myUid],
        currentTurn: 0,
        status: 'waiting',
        difficulty,
        sessionScores: { [myUid]: 0 },
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        lastActivityAt: firebase.database.ServerValue.TIMESTAMP,
      };

      await getDb().ref(`rooms/${code}`).set(roomData);
      roomCode = code;
      setupPresence(code, myUid);
      listenToRoom(code);
      showLobby(code);
    }

    // --- Room joining ---
    const ROOM_TTL_MS = 30 * 60 * 1000; // 30 minutes

    async function joinRoom(code) {
      myUid = await waitForUid();
      if (!myUid) { alert('Authentication failed. Please refresh.'); return; }

      code = code.toUpperCase().trim();
      const snap = await getDb().ref(`rooms/${code}`).once('value');
      if (!snap.exists()) { alert('Room not found.'); return; }

      const room = snap.val();

      // Reap expired rooms
      if (MP.isExpired(room, Date.now(), ROOM_TTL_MS)) {
        await getDb().ref(`rooms/${code}`).remove();
        alert('That room has expired.');
        return;
      }

      // Already a player? (e.g., reconnecting after page refresh)
      if (room.players && room.players[myUid]) {
        // If we're the only player AND status is waiting, we're the host re-attaching
        if (room.playerOrder.length === 1 && room.status === 'waiting') {
          alert('You cannot join your own room. Open the link in a different browser or an incognito window.');
          return;
        }
        // Reconnecting as an existing player
        roomCode = code;
        setupPresence(code, myUid);
        listenToRoom(code);
        return;
      }

      // Room full? → spectator (no presence registration)
      if (room.playerOrder && room.playerOrder.length >= 2) {
        roomCode = code;
        listenToRoom(code);
        return;
      }

      const name = getPlayerName();
      if (!name) return;

      // Join as player 2
      const updates = {};
      updates[`rooms/${code}/players/${myUid}`] = { name, score: 0 };
      updates[`rooms/${code}/playerOrder`] = [...room.playerOrder, myUid];
      updates[`rooms/${code}/status`] = 'playing';
      updates[`rooms/${code}/sessionScores/${myUid}`] = 0;
      updates[`rooms/${code}/lastActivityAt`] = firebase.database.ServerValue.TIMESTAMP;
      await getDb().ref().update(updates);

      roomCode = code;
      setupPresence(code, myUid);
      listenToRoom(code);
    }

    // --- Player name ---
    function getPlayerName() {
      let name = localStorage.getItem('membery_name');
      if (!name) {
        name = prompt('Enter your name:');
        if (!name || !name.trim()) return null;
        name = name.trim().slice(0, 15);
        localStorage.setItem('membery_name', name);
      }
      return name;
    }

    // --- Presence ---
    let presenceRef = null;
    let presenceDisconnectRef = null;

    function setupPresence(code, uid) {
      teardownPresence();
      presenceRef = getDb().ref(`rooms/${code}/presence/${uid}`);
      presenceDisconnectRef = getDb().ref(`rooms/${code}/disconnectedAt/${uid}`);

      // Mark online now; on disconnect mark offline + record timestamp
      presenceRef.set(true);
      presenceRef.onDisconnect().set(false);
      presenceDisconnectRef.onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);

      // Reconnect: clear disconnectedAt
      presenceDisconnectRef.set(null);
    }

    function teardownPresence() {
      if (presenceRef) {
        presenceRef.onDisconnect().cancel();
        presenceRef.set(false).catch(() => {});
        presenceRef = null;
      }
      if (presenceDisconnectRef) {
        presenceDisconnectRef.onDisconnect().cancel();
        presenceDisconnectRef = null;
      }
    }

    // --- Firebase listener ---
    let lastRoomState = null;
    let pauseCountdownInterval = null;
    const FORFEIT_GRACE_MS = 2 * 60 * 1000;

    function listenToRoom(code) {
      if (roomListener) roomRef.off('value', roomListener);
      roomRef = getDb().ref(`rooms/${code}`);
      roomListener = roomRef.on('value', snap => {
        const room = snap.val();
        if (!room) { showMultiplayerMenu(); return; }

        // Play feedback sounds on state transitions (for spectators + opponent)
        if (lastRoomState) {
          const prevFlipped = lastRoomState.flipped || [];
          const curFlipped = room.flipped || [];
          const prevMatchedCount = (lastRoomState.matched || []).filter(m => m === 1).length;
          const curMatchedCount = (room.matched || []).filter(m => m === 1).length;

          // New card flipped?
          if (curFlipped.length > prevFlipped.length) {
            // Opponent/spectator flip — play flip sound (not on our own, already played)
            const wasMyFlip = MP.isMyTurn(lastRoomState, myUid);
            if (!wasMyFlip) sfxFlip();
          }

          // Pair resolved?
          if (prevFlipped.length === 2 && curFlipped.length === 0) {
            const wasMyTurn = MP.isMyTurn(lastRoomState, myUid);
            if (!wasMyTurn) {
              // We didn't trigger this — play sound now
              if (curMatchedCount > prevMatchedCount) sfxMatch();
              else sfxMismatch();
            }
          }
        }

        lastRoomState = room;
        currentRoom = room;
        renderMultiplayerState(room);
      });
    }

    function leaveRoom() {
      teardownPresence();
      if (roomRef && roomListener) roomRef.off('value', roomListener);
      roomRef = null;
      roomListener = null;
      currentRoom = null;
      roomCode = null;
      lastRoomState = null;
      if (flipTimeout) clearTimeout(flipTimeout);
      flipTimeout = null;
      if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
      pauseCountdownInterval = null;
    }

    // --- Card flip ---
    async function onMultiplayerCardClick(idx) {
      if (!currentRoom || !myUid) return;
      if (!MP.canFlip(currentRoom, myUid, idx)) return;

      const newFlipped = [...(currentRoom.flipped || []), idx];
      await getDb().ref(`rooms/${roomCode}/flipped`).set(newFlipped);

      sfxFlip();

      if (newFlipped.length === 2) {
        const isMatch = MP.checkMatch(currentRoom.board, newFlipped);

        if (flipTimeout) clearTimeout(flipTimeout);
        flipTimeout = setTimeout(async () => {
          let logicalUpdates;
          if (isMatch) {
            sfxMatch();
            logicalUpdates = MP.applyMatch(currentRoom, myUid, newFlipped);

            // If game just ended, increment session score for the winner
            if (logicalUpdates.status === 'finished') {
              const finalScores = { ...currentRoom.players };
              finalScores[myUid] = {
                ...finalScores[myUid],
                score: logicalUpdates[`players/${myUid}/score`],
              };
              const winner = MP.getWinner(finalScores);
              const winnerUid = winner && !winner.tie ? winner.uid : null;
              if (winnerUid) {
                Object.assign(logicalUpdates, MP.incrementSessionScore(currentRoom, winnerUid));
              }
            }
          } else {
            sfxMismatch();
            logicalUpdates = MP.applyMismatch(currentRoom);
          }
          // Convert serverTimestamp marker to Firebase's actual sentinel
          await getDb().ref(`rooms/${roomCode}`).update(
            substituteServerValues(logicalUpdates)
          );
        }, 900);
      }
    }

    // Escape HTML to prevent XSS from user-supplied names
    function escapeHtml(str) {
      if (str == null) return '';
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    }

    // Pause overlay management — shows "opponent disconnected" with countdown
    function updatePauseOverlay(room) {
      // Tear down any existing overlay/interval
      if (pauseCountdownInterval) {
        clearInterval(pauseCountdownInterval);
        pauseCountdownInterval = null;
      }
      const existing = document.getElementById('mp-pause-overlay');
      if (existing) existing.remove();

      if (!MP.isPaused(room)) return;

      // Find the offline player(s)
      const offline = MP.getOfflinePlayers(room);
      const offlineUid = offline[0];
      const offlineName = (room.players[offlineUid] || {}).name || 'opponent';
      const iAmOnline = !offline.includes(myUid);

      const overlay = document.createElement('div');
      overlay.id = 'mp-pause-overlay';
      overlay.className = 'mp-pause-overlay';
      overlay.innerHTML = `
        <div class="mp-pause-card">
          <h3>${escapeHtml(offlineName)} disconnected</h3>
          <div class="mp-pause-countdown" id="mp-pause-countdown">--:--</div>
          <p class="mp-pause-hint">Waiting for them to reconnect...</p>
          ${iAmOnline ? `<button class="mp-primary-btn mp-forfeit-btn" id="mp-forfeit-btn" disabled>Win by forfeit</button>` : ''}
        </div>
      `;
      document.body.appendChild(overlay);

      const countdownEl = document.getElementById('mp-pause-countdown');
      const forfeitBtn = document.getElementById('mp-forfeit-btn');

      function tick() {
        const remaining = MP.timeUntilForfeit(room, Date.now(), FORFEIT_GRACE_MS);
        if (remaining === Infinity) {
          // No longer paused (player came back)
          updatePauseOverlay(currentRoom);
          return;
        }
        const secs = Math.ceil(remaining / 1000);
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        if (countdownEl) {
          countdownEl.textContent = remaining > 0
            ? `${m}:${s.toString().padStart(2, '0')}`
            : '0:00';
        }
        if (remaining <= 0 && forfeitBtn) {
          forfeitBtn.disabled = false;
          forfeitBtn.textContent = 'Win by forfeit';
        }
      }

      tick();
      pauseCountdownInterval = setInterval(tick, 250);

      if (forfeitBtn) {
        forfeitBtn.addEventListener('click', async () => {
          if (forfeitBtn.disabled) return;
          forfeitBtn.disabled = true;
          // myUid must be the winner (the online player)
          const updates = MP.applyForfeit(currentRoom, myUid);
          await getDb().ref(`rooms/${roomCode}`).update(substituteServerValues(updates));
        });
      }
    }

    // Name editing
    async function promptNameEdit() {
      if (!currentRoom || !myUid) return;
      const currentName = (currentRoom.players[myUid] || {}).name || '';
      const raw = prompt('Edit your name:', currentName);
      if (raw === null) return; // cancelled
      const sanitized = MP.sanitizeName(raw);
      if (!sanitized) { alert('Name cannot be empty.'); return; }
      if (sanitized === currentName) return;
      localStorage.setItem('membery_name', sanitized);
      await getDb().ref(`rooms/${roomCode}/players/${myUid}/name`).set(sanitized);
    }

    // Mid-game leave: forfeit to opponent
    async function onLeaveDuringGame() {
      if (!currentRoom || !myUid) return;
      if (!confirm('Leave the game? Your opponent will win this round.')) return;

      // Find the opponent (the other player in playerOrder)
      const opponentUid = currentRoom.playerOrder.find(uid => uid !== myUid);
      if (opponentUid && currentRoom.status === 'playing') {
        const updates = MP.applyForfeit(currentRoom, opponentUid);
        await getDb().ref(`rooms/${roomCode}`).update(substituteServerValues(updates));
      }

      leaveRoom();
      showMultiplayerMenu();
    }

    // Replace { '.sv': 'timestamp' } markers with Firebase ServerValue sentinels.
    function substituteServerValues(obj) {
      if (obj && typeof obj === 'object' && obj['.sv'] === 'timestamp') {
        return firebase.database.ServerValue.TIMESTAMP;
      }
      if (Array.isArray(obj)) return obj.map(substituteServerValues);
      if (obj && typeof obj === 'object') {
        const out = {};
        for (const k of Object.keys(obj)) {
          out[k] = substituteServerValues(obj[k]);
        }
        return out;
      }
      return obj;
    }

    // --- Share ---
    // Simple copy-to-clipboard. Works identically on all devices.
    function shareRoom(code) {
      const url = `${window.location.origin}${window.location.pathname}?room=${code}`;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast('Link copied! Paste it to your friend.');
        }).catch(() => {
          prompt('Copy this link:', url);
        });
      } else {
        // Legacy fallback for older browsers
        prompt('Copy this link:', url);
      }
    }

    function showToast(msg) {
      const el = document.createElement('div');
      el.className = 'mp-toast';
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2000);
    }

    // --- Rendering ---
    function renderMultiplayerState(room) {
      const mpSection = document.getElementById('mp-section');

      if (room.status === 'waiting') {
        showLobby(roomCode);
        return;
      }

      if (room.status === 'playing' || room.status === 'finished') {
        renderMultiplayerGame(room);
        return;
      }
    }

    function showMultiplayerMenu() {
      const mpSection = document.getElementById('mp-section');
      mpSection.classList.remove('hidden');
      document.getElementById('splash').classList.add('hidden');
      document.querySelector('header').classList.add('hidden');
      document.getElementById('grid').classList.add('hidden');

      mpSection.innerHTML = `
        <div class="mp-menu">
          <h2>Play with Friends</h2>
          <div class="mp-menu-buttons">
            <div class="mp-difficulty-select">
              <label>Difficulty:</label>
              <div class="mp-diff-buttons">
                <button class="diff-btn" data-mp-diff="12">Easy</button>
                <button class="diff-btn active" data-mp-diff="18">Medium</button>
                <button class="diff-btn" data-mp-diff="36">Hard</button>
              </div>
            </div>
            <button id="mp-create-btn" class="mp-primary-btn">Create Room</button>
            <div class="mp-divider">or</div>
            <div class="mp-join-row">
              <input type="text" id="mp-join-input" placeholder="Room code" maxlength="4" autocomplete="off" autocapitalize="characters">
              <button id="mp-join-btn" class="mp-primary-btn">Join</button>
            </div>
          </div>
          <button class="mp-back-btn" id="mp-back-btn">Back</button>
        </div>
      `;

      let selectedDiff = 18;

      mpSection.querySelectorAll('[data-mp-diff]').forEach(btn => {
        btn.addEventListener('click', () => {
          mpSection.querySelectorAll('[data-mp-diff]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedDiff = parseInt(btn.dataset.mpDiff);
        });
      });

      document.getElementById('mp-create-btn').addEventListener('click', () => createRoom(selectedDiff));

      document.getElementById('mp-join-btn').addEventListener('click', () => {
        const code = document.getElementById('mp-join-input').value;
        if (code.trim().length === 4) joinRoom(code);
      });

      document.getElementById('mp-join-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const code = e.target.value;
          if (code.trim().length === 4) joinRoom(code);
        }
      });

      document.getElementById('mp-back-btn').addEventListener('click', () => {
        leaveRoom();
        mpSection.classList.add('hidden');
        document.getElementById('splash').classList.remove('hidden');
      });
    }

    function showLobby(code) {
      const mpSection = document.getElementById('mp-section');
      mpSection.classList.remove('hidden');
      document.getElementById('splash').classList.add('hidden');
      document.querySelector('header').classList.add('hidden');
      document.getElementById('grid').classList.add('hidden');

      mpSection.innerHTML = `
        <div class="mp-lobby">
          <h2>Room Code</h2>
          <input class="mp-code-display" value="${code}" readonly>
          <p class="mp-waiting">Waiting for a friend to join...</p>
          <button id="mp-share-btn" class="mp-primary-btn">Copy Invite Link</button>
          <button class="mp-back-btn" id="mp-lobby-back">Cancel</button>
        </div>
      `;

      // Auto-select on focus/tap for easy copying
      const codeInput = mpSection.querySelector('.mp-code-display');
      codeInput.addEventListener('focus', e => e.target.select());
      codeInput.addEventListener('click', e => e.target.select());

      document.getElementById('mp-share-btn').addEventListener('click', () => shareRoom(code));
      document.getElementById('mp-lobby-back').addEventListener('click', () => {
        // Clean up room if we're the only player
        if (currentRoom && currentRoom.playerOrder && currentRoom.playerOrder.length <= 1) {
          getDb().ref(`rooms/${roomCode}`).remove();
        }
        leaveRoom();
        showMultiplayerMenu();
      });
    }

    function renderMultiplayerGame(room) {
      const mpSection = document.getElementById('mp-section');
      mpSection.classList.remove('hidden');
      document.getElementById('splash').classList.add('hidden');
      document.querySelector('header').classList.add('hidden');
      document.getElementById('grid').classList.add('hidden');

      const role = MP.getRole(room, myUid);
      const scores = MP.getScores(room.players);
      const isMyTurn = MP.isMyTurn(room, myUid);
      const currentPlayerUid = room.playerOrder[room.currentTurn];
      const currentPlayerName = room.players[currentPlayerUid]?.name || '?';

      // Turn indicator
      let turnText;
      if (room.status === 'finished') {
        // Forfeit overrides regular winner determination
        if (room.forfeitWinner) {
          if (room.forfeitWinner === myUid) {
            turnText = 'You win — opponent left!';
          } else {
            const winnerName = (room.players[room.forfeitWinner] || {}).name || '?';
            turnText = role === 'player'
              ? `You forfeited. ${winnerName} wins.`
              : `${winnerName} wins by forfeit.`;
          }
        } else {
          const winner = MP.getWinner(room.players);
          if (winner.tie) {
            turnText = "It's a tie!";
          } else {
            turnText = winner.uid === myUid ? 'You win!' : `${winner.name} wins!`;
          }
        }
      } else if (role === 'spectator') {
        turnText = `${currentPlayerName}'s turn`;
      } else if (isMyTurn) {
        turnText = 'Your turn — flip a card!';
      } else {
        turnText = `Waiting for ${currentPlayerName}...`;
      }

      // Score bar (current game)
      const scoreHtml = scores.map(s => {
        const isActive = s.uid === currentPlayerUid && room.status !== 'finished';
        const isMe = s.uid === myUid;
        const editIcon = isMe
          ? `<button class="mp-edit-name" data-edit-name title="Edit name">&#9998;</button>`
          : '';
        return `<span class="mp-score ${isActive ? 'mp-score-active' : ''} ${isMe ? 'mp-score-me' : ''}">${escapeHtml(s.name)}: ${s.score}${editIcon}</span>`;
      }).join('<span class="mp-score-sep">·</span>');

      // Session scoreline (across rematches)
      let sessionHtml = '';
      const sessionScores = room.sessionScores || {};
      const sessionTotal = Object.values(sessionScores).reduce((a, b) => a + b, 0);
      if (sessionTotal > 0 && room.playerOrder.length === 2) {
        const parts = room.playerOrder.map(uid => {
          const name = (room.players[uid] || {}).name || '?';
          const wins = sessionScores[uid] || 0;
          return `${escapeHtml(name)} ${wins}`;
        });
        sessionHtml = `<div class="mp-session">Session: ${parts.join(' &mdash; ')}
          <button class="mp-session-reset" id="mp-session-reset" title="Reset session">&#8635;</button>
        </div>`;
      }

      // Build header + grid
      const cols = MP.gridColumns(room.board.length, window.innerWidth);

      const spectatorBadge = role === 'spectator'
        ? `<div class="mp-spectator-badge">Spectating</div>` : '';

      const leaveBtnHeader = role === 'player' && room.status === 'playing'
        ? `<button class="mp-leave-header" id="mp-leave-header" title="Leave game">&times;</button>` : '';

      mpSection.innerHTML = `
        <div class="mp-game ${role === 'spectator' ? 'mp-spectating' : ''}">
          <div class="mp-header">
            ${leaveBtnHeader}
            ${spectatorBadge}
            <div class="mp-turn">${turnText}</div>
            <div class="mp-scores">${scoreHtml}</div>
            ${sessionHtml}
          </div>
          <div id="mp-grid" class="mp-grid"></div>
          ${room.status === 'finished' ? `
            <div class="mp-finished-buttons">
              <button id="mp-play-again" class="mp-primary-btn">Play Again</button>
              <button id="mp-leave" class="mp-back-btn">Leave</button>
            </div>
          ` : ''}
        </div>
      `;

      // Wire session reset
      const resetBtn = document.getElementById('mp-session-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
          if (!confirm('Reset session score to 0-0?')) return;
          const cleared = {};
          for (const uid of room.playerOrder) cleared[uid] = 0;
          await getDb().ref(`rooms/${roomCode}/sessionScores`).set(cleared);
        });
      }

      // Wire mid-game leave
      const leaveHeaderBtn = document.getElementById('mp-leave-header');
      if (leaveHeaderBtn) {
        leaveHeaderBtn.addEventListener('click', () => onLeaveDuringGame());
      }

      // Wire name edit
      const editBtn = mpSection.querySelector('[data-edit-name]');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); promptNameEdit(); });
      }

      // Pause overlay (disconnect)
      updatePauseOverlay(room);

      // Render cards
      const grid = document.getElementById('mp-grid');
      const bodyStyle = getComputedStyle(document.body);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const padH = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
      const padV = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
      const headerEl = mpSection.querySelector('.mp-header');
      const headerH = headerEl ? headerEl.offsetHeight + 8 : 60;
      const finishedH = room.status === 'finished' ? 60 : 0;
      const availW = vw - padH;
      const availH = vh - padV - headerH - finishedH;
      const gap = vw < 480 ? 2 : 3;
      const rows = Math.ceil(room.board.length / cols);
      const maxByWidth = (availW - gap * (cols - 1)) / cols;
      const maxByHeight = (availH - gap * (rows - 1)) / rows;
      const cardSize = Math.floor(Math.min(maxByWidth, maxByHeight));

      grid.style.gridTemplateColumns = `repeat(${cols}, ${cardSize}px)`;
      grid.style.gridAutoRows = `${cardSize}px`;
      grid.style.gap = `${gap}px`;

      room.board.forEach((tile, idx) => {
        const isFlipped = room.flipped && room.flipped.includes(idx);
        const isMatched = room.matched && room.matched[idx];

        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        if (isFlipped) cardEl.classList.add('flipped');
        if (isMatched) cardEl.classList.add('matched');

        cardEl.innerHTML = `
          <div class="card-inner">
            <div class="card-front"></div>
            <div class="card-back">
              <img src="tiles_clean/${tile}.png" alt="${tile}" draggable="false">
            </div>
          </div>
        `;

        cardEl.addEventListener('click', () => onMultiplayerCardClick(idx));
        grid.appendChild(cardEl);
      });

      // Wire finished buttons
      if (room.status === 'finished') {
        sfxWin();
        const playAgainBtn = document.getElementById('mp-play-again');
        if (playAgainBtn) {
          playAgainBtn.addEventListener('click', async () => {
            // Host creates new game with same code and difficulty
            if (room.playerOrder[0] === myUid) {
              const board = MP.buildBoard(room.difficulty, TILE_NAMES);
              const updates = MP.applyResetForRematch(room, board);
              await getDb().ref(`rooms/${roomCode}`).update(
                substituteServerValues(updates)
              );
            }
          });
        }

        const leaveBtn = document.getElementById('mp-leave');
        if (leaveBtn) {
          leaveBtn.addEventListener('click', () => {
            leaveRoom();
            showMultiplayerMenu();
          });
        }
      }
    }

    // --- Auto-join from URL ---
    function checkUrlForRoom() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('room');
      if (code && code.length === 4) {
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
        joinRoom(code.toUpperCase());
      }
    }

    // --- Init ---
    document.addEventListener('DOMContentLoaded', () => {
      // "Play with Friends" button on splash
      const friendsBtn = document.getElementById('play-friends-btn');
      if (friendsBtn) {
        friendsBtn.addEventListener('click', () => showMultiplayerMenu());
      }

      // Re-render multiplayer grid on viewport changes
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        if (!currentRoom) return;
        if (currentRoom.status !== 'playing' && currentRoom.status !== 'finished') return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderMultiplayerState(currentRoom), 100);
      });

      window.addEventListener('orientationchange', () => {
        if (!currentRoom) return;
        setTimeout(() => renderMultiplayerState(currentRoom), 200);
      });

      // Check for ?room= in URL
      checkUrlForRoom();
    });
  })();
}
