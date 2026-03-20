// Scores module — Firebase leaderboard read/write

const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Sign in anonymously (invisible to user).
// Store the promise so submitScore can await it.
const authPromise = firebase.auth().signInAnonymously()
  .then(() => true)
  .catch(err => {
    console.warn('Anonymous auth failed:', err.message);
    return false;
  });

// --- Read top 10 ---

async function getTopByTime(difficulty, limit = 10) {
  const snap = await db.ref(`scores/${difficulty}`)
    .orderByChild('time_ms')
    .limitToFirst(limit)
    .once('value');
  return snapshotToArray(snap);
}

async function getTopByMoves(difficulty, limit = 10) {
  const snap = await db.ref(`scores/${difficulty}`)
    .orderByChild('moves')
    .limitToFirst(limit)
    .once('value');
  return snapshotToArray(snap);
}

function snapshotToArray(snap) {
  const results = [];
  snap.forEach(child => {
    results.push({ key: child.key, ...child.val() });
  });
  return results;
}

// --- Check if score qualifies for top 10 ---

async function isTopScore(difficulty, moves, timeMs) {
  const [topTime, topMoves] = await Promise.all([
    getTopByTime(difficulty),
    getTopByMoves(difficulty),
  ]);

  const qualifiesTime = topTime.length < 10 || timeMs < topTime[topTime.length - 1].time_ms;
  const qualifiesMoves = topMoves.length < 10 || moves < topMoves[topMoves.length - 1].moves;

  return qualifiesTime || qualifiesMoves;
}

// --- Submit score ---

async function submitScore(difficulty, name, moves, timeMs) {
  const authed = await authPromise;
  if (!authed) {
    throw new Error('Authentication failed — cannot submit score');
  }

  const entry = {
    name: name.trim().slice(0, 15),
    moves,
    time_ms: timeMs,
    date: new Date().toISOString().split('T')[0],
  };

  const ref = await db.ref(`scores/${difficulty}`).push(entry);
  return ref.key;
}

// --- Render leaderboard tables ---

function renderLeaderboardTable(scores, category, highlightKey) {
  if (scores.length === 0) {
    return '<div class="lb-empty">No scores yet</div>';
  }

  const rows = scores.map((s, i) => {
    const highlight = s.key === highlightKey ? ' class="lb-highlight"' : '';
    const value = category === 'time'
      ? formatTimeMs(s.time_ms)
      : s.moves;
    return `<tr${highlight}><td class="lb-rank">${i + 1}</td><td class="lb-name">${escapeHtml(s.name)}</td><td class="lb-value">${value}</td></tr>`;
  }).join('');

  return `<table class="lb-table"><tbody>${rows}</tbody></table>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// formatTime is defined in game.js, but we need it here too
function formatTimeMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
