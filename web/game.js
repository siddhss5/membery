// Membery — Memory matching game engine

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

let cards = [];
let cardElements = [];
let flipped = [];
let matchedCount = 0;
let totalPairs = 0;
let moves = 0;
let timerStart = null;
let timerInterval = null;
let locked = false;

// --- Shuffle (Fisher-Yates) ---
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- Build card deck ---
function buildDeck(numPairs) {
  const selected = shuffle([...TILE_NAMES]).slice(0, numPairs);
  return shuffle(selected.flatMap(name => [
    { tile: name, matched: false },
    { tile: name, matched: false },
  ]));
}

// --- Layout ---
function computeLayout(numCards) {
  const header = document.querySelector('header');
  const bodyStyle = getComputedStyle(document.body);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const padH = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
  const padV = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
  const headerH = header ? header.offsetHeight + 8 : 0;

  const availW = vw - padH;
  const availH = vh - padV - headerH;
  const gap = vw < 480 ? 2 : 3;

  const narrow = vw < 600;
  const cols = numCards <= 36 ? (narrow ? 4 : 6) : (narrow ? 6 : 8);
  const rows = Math.ceil(numCards / cols);

  const maxByWidth = (availW - gap * (cols - 1)) / cols;
  const maxByHeight = (availH - gap * (rows - 1)) / rows;
  const cardSize = Math.floor(Math.min(maxByWidth, maxByHeight));

  return { cols, cardSize, gap };
}

function applyLayout() {
  if (cards.length === 0) return;
  const grid = document.getElementById('grid');
  const { cols, cardSize, gap } = computeLayout(cards.length);
  grid.style.gridTemplateColumns = `repeat(${cols}, ${cardSize}px)`;
  grid.style.gridAutoRows = `${cardSize}px`;
  grid.style.gap = `${gap}px`;
}

// --- Timer ---
function startTimer() {
  if (timerStart) return;
  timerStart = Date.now();
  timerInterval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

function stopTimer() { clearInterval(timerInterval); }

function resetTimer() {
  stopTimer();
  timerStart = null;
  updateTimerDisplay();
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  if (el) el.textContent = formatTime(timerStart ? Date.now() - timerStart : 0);
}

// --- Grid ---
function buildGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  cardElements = [];

  cards.forEach((card, idx) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-inner">
        <div class="card-front"></div>
        <div class="card-back">
          <img src="tiles_clean/${card.tile}.png" alt="${card.tile}" draggable="false">
        </div>
      </div>
    `;
    el.addEventListener('click', () => onCardClick(idx));
    grid.appendChild(el);
    cardElements.push(el);
  });

  applyLayout();
  updateStats();
}

function updateCards() {
  cards.forEach((card, idx) => {
    const el = cardElements[idx];
    if (!el) return;
    el.classList.toggle('flipped', flipped.includes(idx));
    el.classList.toggle('matched', card.matched);
  });
  updateStats();
}

function updateStats() {
  document.getElementById('moves').textContent = moves;
}

// --- Game logic ---
function onCardClick(idx) {
  if (locked || flipped.includes(idx) || cards[idx].matched) return;
  startTimer();
  flipped.push(idx);
  updateCards();

  if (flipped.length === 2) {
    moves++;
    updateStats();
    checkMatch();
  }
}

function checkMatch() {
  const [a, b] = flipped;
  if (cards[a].tile === cards[b].tile) {
    cards[a].matched = true;
    cards[b].matched = true;
    matchedCount++;
    flipped = [];
    updateCards();
    if (matchedCount === totalPairs) {
      stopTimer();
      showWin();
    }
  } else {
    locked = true;
    setTimeout(() => {
      flipped = [];
      locked = false;
      updateCards();
    }, 900);
  }
}

// --- Win screen ---
async function showWin() {
  const timeMs = timerStart ? Date.now() - timerStart : 0;

  document.getElementById('win-moves').textContent = moves;
  document.getElementById('win-time').textContent = formatTime(timeMs);

  // Reset win card state
  const hsSection = document.getElementById('win-highscore');
  const lbSection = document.getElementById('win-leaderboard');
  hsSection.classList.add('hidden');
  lbSection.classList.add('hidden');
  lbSection.innerHTML = '';

  document.getElementById('win-overlay').classList.add('visible');

  // Check if this is a top score
  try {
    const isTop = await isTopScore(totalPairs, moves, timeMs);
    if (isTop) {
      hsSection.classList.remove('hidden');
      const nameInput = document.getElementById('name-input');
      const savedName = localStorage.getItem('membery_name') || '';
      nameInput.value = savedName;
      nameInput.focus();

      // Wire submit (once)
      const submitBtn = document.getElementById('submit-score-btn');
      const newSubmitBtn = submitBtn.cloneNode(true);
      submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

      const doSubmit = async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        localStorage.setItem('membery_name', name);
        newSubmitBtn.disabled = true;
        newSubmitBtn.textContent = '...';

        try {
          const key = await submitScore(totalPairs, name, moves, timeMs);
          hsSection.classList.add('hidden');
          await showWinLeaderboard(totalPairs, key);
        } catch (err) {
          newSubmitBtn.textContent = 'Retry';
          newSubmitBtn.disabled = false;
          console.error('Score submit failed:', err);
        }
      };

      newSubmitBtn.addEventListener('click', doSubmit);
      nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
    }
  } catch (err) {
    console.warn('Leaderboard check failed:', err.message);
  }
}

async function showWinLeaderboard(difficulty, highlightKey) {
  const lbSection = document.getElementById('win-leaderboard');
  try {
    const [topTime, topMoves] = await Promise.all([
      getTopByTime(difficulty),
      getTopByMoves(difficulty),
    ]);

    lbSection.innerHTML = `
      <div class="lb-section">
        <h3>Fastest Time</h3>
        ${renderLeaderboardTable(topTime, 'time', highlightKey)}
      </div>
      <div class="lb-section">
        <h3>Fewest Moves</h3>
        ${renderLeaderboardTable(topMoves, 'moves', highlightKey)}
      </div>
    `;
    lbSection.classList.remove('hidden');
  } catch (err) {
    console.warn('Failed to load leaderboard:', err.message);
  }
}

// --- Leaderboard overlay ---
let currentLbDifficulty = 18;

async function showLeaderboard(difficulty) {
  currentLbDifficulty = difficulty || currentLbDifficulty;

  // Update tab styling
  document.querySelectorAll('.lb-diff-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.diff) === currentLbDifficulty);
  });

  const timeDiv = document.getElementById('lb-time');
  const movesDiv = document.getElementById('lb-moves');
  timeDiv.innerHTML = '<div class="lb-empty">Loading...</div>';
  movesDiv.innerHTML = '<div class="lb-empty">Loading...</div>';

  document.getElementById('leaderboard-overlay').classList.add('visible');

  try {
    const [topTime, topMoves] = await Promise.all([
      getTopByTime(currentLbDifficulty),
      getTopByMoves(currentLbDifficulty),
    ]);
    timeDiv.innerHTML = renderLeaderboardTable(topTime, 'time');
    movesDiv.innerHTML = renderLeaderboardTable(topMoves, 'moves');
  } catch (err) {
    timeDiv.innerHTML = '<div class="lb-empty">Offline</div>';
    movesDiv.innerHTML = '<div class="lb-empty">Offline</div>';
  }
}

function hideLeaderboard() {
  document.getElementById('leaderboard-overlay').classList.remove('visible');
}

// --- New game ---
function newGame(numPairs) {
  document.getElementById('win-overlay').classList.remove('visible');
  totalPairs = numPairs || totalPairs || 18;
  cards = buildDeck(totalPairs);
  flipped = [];
  matchedCount = 0;
  moves = 0;
  locked = false;
  resetTimer();
  buildGrid();
}

function setDifficulty(numPairs) {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.pairs) === numPairs);
  });
  newGame(numPairs);
}

// --- Splash screen ---
function hideSplash() {
  document.getElementById('splash').classList.add('hidden');
  document.querySelector('header').classList.remove('hidden');
  document.getElementById('grid').classList.remove('hidden');
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('header').classList.add('hidden');
  document.getElementById('grid').classList.add('hidden');

  document.getElementById('play-btn').addEventListener('click', () => {
    hideSplash();
    setDifficulty(18);
  });

  document.querySelectorAll('.diff-btn').forEach(btn =>
    btn.addEventListener('click', () => setDifficulty(parseInt(btn.dataset.pairs)))
  );
  document.getElementById('new-game-btn').addEventListener('click', () => newGame());
  document.getElementById('win-new-game').addEventListener('click', () => newGame());
  window.addEventListener('resize', applyLayout);

  // Trophy buttons
  document.getElementById('trophy-btn').addEventListener('click', () => showLeaderboard(totalPairs));
  document.getElementById('splash-trophy-btn').addEventListener('click', () => showLeaderboard(18));
  document.getElementById('leaderboard-close').addEventListener('click', hideLeaderboard);

  // Leaderboard difficulty tabs
  document.querySelectorAll('.lb-diff-btn').forEach(btn =>
    btn.addEventListener('click', () => showLeaderboard(parseInt(btn.dataset.diff)))
  );

  // Close leaderboard on overlay click
  document.getElementById('leaderboard-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideLeaderboard();
  });
});
