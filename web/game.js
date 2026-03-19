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

// --- Adaptive grid layout ---
// Computes columns, rows, and card size to guarantee everything fits
// the viewport without scrolling, on any device.
function computeLayout(numCards) {
  const grid = document.getElementById('grid');
  const header = document.querySelector('header');

  // Available space
  const vw = window.innerWidth;
  const bodyPad = parseFloat(getComputedStyle(document.body).paddingLeft) * 2;
  const availW = Math.min(vw - bodyPad, 800); // max-width: 800px
  const headerH = header ? header.offsetHeight : 60;
  const bodyPadV = parseFloat(getComputedStyle(document.body).paddingTop)
                 + parseFloat(getComputedStyle(document.body).paddingBottom);
  const headerMargin = 8; // margin-bottom on header
  const availH = window.innerHeight - headerH - bodyPadV - headerMargin;

  const gap = vw < 480 ? 2 : 3;
  const narrow = vw < 600;

  // Pick columns
  let cols;
  if (numCards <= 24) cols = narrow ? 4 : 6;
  else if (numCards <= 36) cols = narrow ? 4 : 6;
  else cols = narrow ? 6 : 8;

  const rows = Math.ceil(numCards / cols);

  // Largest square card that fits both dimensions
  const maxByWidth = (availW - gap * (cols - 1)) / cols;
  const maxByHeight = (availH - gap * (rows - 1)) / rows;
  const cardSize = Math.floor(Math.min(maxByWidth, maxByHeight));

  return { cols, rows, cardSize, gap };
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
  const { cols, cardSize, gap } = computeLayout(cards.length);
  grid.style.gridTemplateColumns = `repeat(${cols}, ${cardSize}px)`;
  grid.style.gridAutoRows = `${cardSize}px`;
  grid.style.gap = `${gap}px`;
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

// --- Resize handler (re-layout on orientation change etc.) ---
function onResize() {
  if (cards.length === 0) return;
  const grid = document.getElementById('grid');
  const { cols, cardSize, gap } = computeLayout(cards.length);
  grid.style.gridTemplateColumns = `repeat(${cols}, ${cardSize}px)`;
  grid.style.gridAutoRows = `${cardSize}px`;
  grid.style.gap = `${gap}px`;
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
