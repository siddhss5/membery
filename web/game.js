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

// --- State ---
let cards = [];
let cardElements = []; // DOM references for each card
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
  const deck = selected.flatMap(name => [
    { tile: name, matched: false },
    { tile: name, matched: false },
  ]);
  return shuffle(deck);
}

// --- Adaptive grid columns ---
function gridColumns(numCards) {
  const narrow = window.innerWidth < 600;
  if (numCards <= 24) return narrow ? 4 : 6;
  if (numCards <= 36) return narrow ? 4 : 6;
  return narrow ? 6 : 8;
}

// --- Timer ---
function startTimer() {
  if (timerStart) return;
  timerStart = Date.now();
  timerInterval = setInterval(updateTimerDisplay, 100);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function resetTimer() {
  stopTimer();
  timerStart = null;
  updateTimerDisplay();
}

function elapsed() {
  if (!timerStart) return 0;
  return (Date.now() - timerStart) / 1000;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  if (el) el.textContent = formatTime(elapsed());
}

// --- Build grid (DOM creation, done once per new game) ---
function buildGrid() {
  const grid = document.getElementById('grid');
  const cols = gridColumns(cards.length);
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.innerHTML = '';
  cardElements = [];

  cards.forEach((card, idx) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-inner">
        <div class="card-front"></div>
        <div class="card-back">
          <img src="tiles_clean/${card.tile}.png" alt="${card.tile}" draggable="false" loading="lazy">
        </div>
      </div>
    `;
    el.addEventListener('click', () => onCardClick(idx));
    grid.appendChild(el);
    cardElements.push(el);
  });

  updateStats();
}

// --- Update card classes (no DOM rebuild) ---
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

// --- Click handler ---
function onCardClick(idx) {
  if (locked) return;
  if (flipped.includes(idx)) return;
  if (cards[idx].matched) return;

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
function showWin() {
  const overlay = document.getElementById('win-overlay');
  document.getElementById('win-moves').textContent = moves;
  document.getElementById('win-time').textContent = formatTime(elapsed());
  overlay.classList.add('visible');
}

function hideWin() {
  document.getElementById('win-overlay').classList.remove('visible');
}

// --- New game ---
function newGame(numPairs) {
  hideWin();
  totalPairs = numPairs || totalPairs || 18;
  cards = buildDeck(totalPairs);
  flipped = [];
  matchedCount = 0;
  moves = 0;
  locked = false;
  resetTimer();
  buildGrid();
}

// --- Difficulty selector ---
function setDifficulty(numPairs) {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.pairs) === numPairs);
  });
  newGame(numPairs);
}

// --- Resize handler (re-layout grid columns) ---
function onResize() {
  if (cards.length === 0) return;
  const grid = document.getElementById('grid');
  grid.style.gridTemplateColumns = `repeat(${gridColumns(cards.length)}, 1fr)`;
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => setDifficulty(parseInt(btn.dataset.pairs)));
  });

  document.getElementById('new-game-btn').addEventListener('click', () => newGame());
  document.getElementById('win-new-game').addEventListener('click', () => newGame());

  window.addEventListener('resize', onResize);

  setDifficulty(18);
});
