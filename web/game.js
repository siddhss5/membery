// Membery — Memory matching game engine

const TILE_NAMES = [
  "cherries", "plums", "sparrows", "beetle",
  "boy", "ant", "diamonds", "triangles",
  "chipmunk", "bananas", "cardinal", "tulips",
  "curly_boy", "canary", "dice", "rabbit",
  "red_circle", "hexagons", "worms", "bee",
  "lemons", "daisies", "checkerboard", "sunflower",
  "roller_skates", "grasshopper", "owl", "parrot",
  "peacock", "strawberry", "doll", "baby_carriage",
  "flag", "rose", "tiger", "stripes",
];

// --- State ---
let cards = [];
let flipped = [];       // indices of currently face-up cards (max 2)
let matchedCount = 0;
let totalPairs = 0;
let moves = 0;
let timerStart = null;
let timerInterval = null;
let locked = false;      // block clicks while checking a pair

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
  // Each tile appears twice
  const deck = selected.flatMap(name => [
    { tile: name, matched: false, id: crypto.randomUUID() },
    { tile: name, matched: false, id: crypto.randomUUID() },
  ]);
  return shuffle(deck);
}

// --- Grid layout ---
function gridColumns(numCards) {
  if (numCards <= 24) return 6;  // 12 pairs = 24 cards -> 6x4
  if (numCards <= 36) return 6;  // 18 pairs = 36 cards -> 6x6
  return 8;                      // 36 pairs = 72 cards -> 8x9
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

// --- Render ---
function render() {
  const grid = document.getElementById('grid');
  grid.style.gridTemplateColumns = `repeat(${gridColumns(cards.length)}, 1fr)`;
  grid.innerHTML = '';

  cards.forEach((card, idx) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    if (card.matched) cardEl.classList.add('matched');
    if (flipped.includes(idx)) cardEl.classList.add('flipped');

    cardEl.innerHTML = `
      <div class="card-inner">
        <div class="card-front"></div>
        <div class="card-back">
          <img src="tiles_clean/${card.tile}.png" alt="${card.tile}" draggable="false">
        </div>
      </div>
    `;

    cardEl.addEventListener('click', () => onCardClick(idx));
    grid.appendChild(cardEl);
  });

  document.getElementById('moves').textContent = moves;
}

// --- Click handler ---
function onCardClick(idx) {
  if (locked) return;
  if (flipped.includes(idx)) return;
  if (cards[idx].matched) return;

  // Start timer on first flip
  startTimer();

  flipped.push(idx);
  render();

  if (flipped.length === 2) {
    moves++;
    document.getElementById('moves').textContent = moves;
    checkMatch();
  }
}

function checkMatch() {
  const [a, b] = flipped;
  if (cards[a].tile === cards[b].tile) {
    // Match!
    cards[a].matched = true;
    cards[b].matched = true;
    matchedCount++;
    flipped = [];
    render();

    if (matchedCount === totalPairs) {
      stopTimer();
      showWin();
    }
  } else {
    // No match — flip back after delay
    locked = true;
    setTimeout(() => {
      flipped = [];
      locked = false;
      render();
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
  render();
}

// --- Difficulty selector ---
function setDifficulty(numPairs) {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.pairs) === numPairs);
  });
  newGame(numPairs);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => setDifficulty(parseInt(btn.dataset.pairs)));
  });

  document.getElementById('new-game-btn').addEventListener('click', () => newGame());
  document.getElementById('win-new-game').addEventListener('click', () => newGame());

  setDifficulty(18);
});
