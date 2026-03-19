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
// Computes columns and card size to guarantee everything fits the
// viewport without scrolling, on any device or orientation.
function computeLayout(numCards) {
  const header = document.querySelector('header');
  const bodyStyle = getComputedStyle(document.body);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const padH = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
  const padV = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
  const headerH = header ? header.offsetHeight + 8 : 0; // 8 = margin-bottom

  const availW = vw - padH;
  const availH = vh - padV - headerH;
  const gap = vw < 480 ? 2 : 3;

  // Pick columns: fewer on narrow screens for larger cards
  const narrow = vw < 600;
  const cols = numCards <= 36 ? (narrow ? 4 : 6) : (narrow ? 6 : 8);
  const rows = Math.ceil(numCards / cols);

  // Largest square card that fits both dimensions
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

function stopTimer() {
  clearInterval(timerInterval);
}

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
          <img src="tiles_clean/${card.tile}.png" alt="${card.tile}" draggable="false" loading="lazy">
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
function showWin() {
  document.getElementById('win-moves').textContent = moves;
  document.getElementById('win-time').textContent =
    formatTime(timerStart ? Date.now() - timerStart : 0);
  document.getElementById('win-overlay').classList.add('visible');
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

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.diff-btn').forEach(btn =>
    btn.addEventListener('click', () => setDifficulty(parseInt(btn.dataset.pairs)))
  );
  document.getElementById('new-game-btn').addEventListener('click', () => newGame());
  document.getElementById('win-new-game').addEventListener('click', () => newGame());
  window.addEventListener('resize', applyLayout);
  setDifficulty(18);
});
