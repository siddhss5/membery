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

    function getUid() {
      const user = firebase.auth().currentUser;
      return user ? user.uid : null;
    }

    // --- Room creation ---
    async function createRoom(difficulty) {
      await authPromise;
      myUid = getUid();
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
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      };

      await getDb().ref(`rooms/${code}`).set(roomData);
      roomCode = code;
      listenToRoom(code);
      showLobby(code);
    }

    // --- Room joining ---
    async function joinRoom(code) {
      await authPromise;
      myUid = getUid();
      if (!myUid) { alert('Authentication failed. Please refresh.'); return; }

      code = code.toUpperCase().trim();
      const snap = await getDb().ref(`rooms/${code}`).once('value');
      if (!snap.exists()) { alert('Room not found.'); return; }

      const room = snap.val();

      // Already a player?
      if (room.players && room.players[myUid]) {
        roomCode = code;
        listenToRoom(code);
        return;
      }

      // Room full? → spectator
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
      await getDb().ref().update(updates);

      roomCode = code;
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

    // --- Firebase listener ---
    let lastRoomState = null;

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
      if (roomRef && roomListener) roomRef.off('value', roomListener);
      roomRef = null;
      roomListener = null;
      currentRoom = null;
      roomCode = null;
      lastRoomState = null;
      if (flipTimeout) clearTimeout(flipTimeout);
      flipTimeout = null;
    }

    // --- Card flip ---
    async function onMultiplayerCardClick(idx) {
      if (!currentRoom || !myUid) return;
      if (!MP.canFlip(currentRoom, myUid, idx)) return;

      const newFlipped = [...(currentRoom.flipped || []), idx];
      await getDb().ref(`rooms/${roomCode}/flipped`).set(newFlipped);

      sfxFlip();

      if (newFlipped.length === 2) {
        // Let the listener handle match check after a delay
        // (both clients will see flipped state, then we resolve)
        const isMatch = MP.checkMatch(currentRoom.board, newFlipped);

        if (flipTimeout) clearTimeout(flipTimeout);
        flipTimeout = setTimeout(async () => {
          if (isMatch) {
            sfxMatch();
            const updates = {};
            const newMatched = [...currentRoom.matched];
            newMatched[newFlipped[0]] = 1;
            newMatched[newFlipped[1]] = 1;
            updates[`rooms/${roomCode}/matched`] = newMatched;
            updates[`rooms/${roomCode}/flipped`] = [];
            updates[`rooms/${roomCode}/players/${myUid}/score`] =
              (currentRoom.players[myUid].score || 0) + 1;

            if (MP.isGameOver(newMatched)) {
              updates[`rooms/${roomCode}/status`] = 'finished';
            }
            // Match = same player goes again (no turn change)
            await getDb().ref().update(updates);
          } else {
            sfxMismatch();
            const updates = {};
            updates[`rooms/${roomCode}/flipped`] = [];
            updates[`rooms/${roomCode}/currentTurn`] =
              MP.nextTurn(currentRoom.currentTurn, currentRoom.playerOrder);
            await getDb().ref().update(updates);
          }
        }, 900);
      }
    }

    // --- Share ---
    function shareRoom(code) {
      const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
      const shareData = {
        title: 'Membery',
        text: 'Play memory with me!',
        url,
      };

      if (navigator.share) {
        navigator.share(shareData).catch(() => {});
      } else {
        navigator.clipboard.writeText(url).then(() => {
          showToast('Link copied!');
        }).catch(() => {
          prompt('Copy this link:', url);
        });
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
          <h2>Room: <span class="mp-code">${code}</span></h2>
          <p class="mp-waiting">Waiting for a friend to join...</p>
          <button id="mp-share-btn" class="mp-primary-btn">Share Invite</button>
          <button class="mp-back-btn" id="mp-lobby-back">Cancel</button>
        </div>
      `;

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
        const winner = MP.getWinner(room.players);
        if (winner.tie) {
          turnText = "It's a tie!";
        } else {
          turnText = winner.uid === myUid ? 'You win!' : `${winner.name} wins!`;
        }
      } else if (role === 'spectator') {
        turnText = `${currentPlayerName}'s turn (Spectating)`;
      } else if (isMyTurn) {
        turnText = 'Your turn — flip a card!';
      } else {
        turnText = `Waiting for ${currentPlayerName}...`;
      }

      // Score bar
      const scoreHtml = scores.map(s => {
        const isActive = s.uid === currentPlayerUid && room.status !== 'finished';
        const isMe = s.uid === myUid;
        return `<span class="mp-score ${isActive ? 'mp-score-active' : ''} ${isMe ? 'mp-score-me' : ''}">${s.name}: ${s.score}</span>`;
      }).join('<span class="mp-score-sep">·</span>');

      // Build header + grid
      const cols = MP.gridColumns(room.board.length, window.innerWidth);

      mpSection.innerHTML = `
        <div class="mp-game">
          <div class="mp-header">
            <div class="mp-turn">${turnText}</div>
            <div class="mp-scores">${scoreHtml}</div>
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
              const matched = new Array(board.length).fill(0);
              const resetPlayers = {};
              for (const uid of room.playerOrder) {
                resetPlayers[uid] = { name: room.players[uid].name, score: 0 };
              }
              await getDb().ref(`rooms/${roomCode}`).update({
                board,
                matched,
                flipped: [],
                players: resetPlayers,
                currentTurn: 0,
                status: 'playing',
              });
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

      // Check for ?room= in URL
      checkUrlForRoom();
    });
  })();
}
