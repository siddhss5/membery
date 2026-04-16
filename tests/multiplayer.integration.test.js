// Integration tests for multiplayer game flow
// Uses a mock Firebase to simulate two-player game end-to-end

import { describe, it, expect, beforeEach } from 'vitest';

const MP = require('../web/multiplayer.js');

// ============================================================
// Mock Firebase — in-memory state store
// ============================================================

class MockFirebaseDb {
  constructor() { this.data = {}; }

  set(path, val) { this._setPath(path, val); }
  get(path) { return this._getPath(path); }
  update(updates) {
    for (const [path, val] of Object.entries(updates)) {
      this._setPath(path, val);
    }
  }

  _setPath(path, val) {
    const parts = path.replace(/^\//, '').split('/');
    let obj = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = JSON.parse(JSON.stringify(val));
  }

  _getPath(path) {
    const parts = path.replace(/^\//, '').split('/');
    let obj = this.data;
    for (const p of parts) {
      if (!obj || typeof obj !== 'object') return undefined;
      obj = obj[p];
    }
    return obj !== undefined ? JSON.parse(JSON.stringify(obj)) : undefined;
  }
}

// ============================================================
// Game simulation helpers
// ============================================================

function createRoom(db, code, difficulty, hostUid, hostName, tileNames) {
  const board = MP.buildBoard(difficulty, tileNames);
  const matched = new Array(board.length).fill(0);
  db.set(`rooms/${code}`, {
    board,
    matched,
    flipped: [],
    players: { [hostUid]: { name: hostName, score: 0 } },
    playerOrder: [hostUid],
    currentTurn: 0,
    status: 'waiting',
    difficulty,
    createdAt: Date.now(),
  });
  return board;
}

function joinRoom(db, code, guestUid, guestName) {
  const room = db.get(`rooms/${code}`);
  room.players[guestUid] = { name: guestName, score: 0 };
  room.playerOrder.push(guestUid);
  room.status = 'playing';
  db.set(`rooms/${code}`, room);
}

function flipCard(db, code, uid, cardIdx) {
  const room = db.get(`rooms/${code}`);
  if (!MP.canFlip(room, uid, cardIdx)) return { error: 'cannot flip' };
  const newFlipped = [...(room.flipped || []), cardIdx];
  db.set(`rooms/${code}/flipped`, newFlipped);

  if (newFlipped.length === 2) {
    const isMatch = MP.checkMatch(room.board, newFlipped);
    if (isMatch) {
      const newMatched = [...room.matched];
      newMatched[newFlipped[0]] = 1;
      newMatched[newFlipped[1]] = 1;
      db.update({
        [`rooms/${code}/matched`]: newMatched,
        [`rooms/${code}/flipped`]: [],
        [`rooms/${code}/players/${uid}/score`]: (room.players[uid].score || 0) + 1,
        ...(MP.isGameOver(newMatched) ? { [`rooms/${code}/status`]: 'finished' } : {}),
      });
      return { match: true, gameOver: MP.isGameOver(newMatched) };
    } else {
      db.update({
        [`rooms/${code}/flipped`]: [],
        [`rooms/${code}/currentTurn`]: MP.nextTurn(room.currentTurn, room.playerOrder),
      });
      return { match: false };
    }
  }
  return { flipped: newFlipped.length };
}

// ============================================================
// Integration tests
// ============================================================

const TILES = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('Full game flow', () => {
  let db;

  beforeEach(() => {
    db = new MockFirebaseDb();
  });

  it('host creates room in waiting state', () => {
    createRoom(db, 'ABCD', 3, 'host1', 'Alice', TILES);
    const room = db.get('rooms/ABCD');
    expect(room.status).toBe('waiting');
    expect(room.playerOrder).toEqual(['host1']);
    expect(room.board).toHaveLength(6);
    expect(room.matched).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('guest joins and game starts', () => {
    createRoom(db, 'ABCD', 3, 'host1', 'Alice', TILES);
    joinRoom(db, 'ABCD', 'guest1', 'Bob');
    const room = db.get('rooms/ABCD');
    expect(room.status).toBe('playing');
    expect(room.playerOrder).toEqual(['host1', 'guest1']);
    expect(room.players.guest1.name).toBe('Bob');
  });

  it('only active player can flip cards', () => {
    createRoom(db, 'ABCD', 3, 'host1', 'Alice', TILES);
    joinRoom(db, 'ABCD', 'guest1', 'Bob');

    // Host (player 0) should be able to flip
    const result = flipCard(db, 'ABCD', 'host1', 0);
    expect(result.error).toBeUndefined();

    // Guest should NOT be able to flip
    const result2 = flipCard(db, 'ABCD', 'guest1', 1);
    expect(result2.error).toBe('cannot flip');
  });

  it('matching pair stays up and same player continues', () => {
    // Use a fixed board so we know which cards match
    db.set('rooms/ABCD', {
      board: ['a', 'a', 'b', 'b', 'c', 'c'],
      matched: [0, 0, 0, 0, 0, 0],
      flipped: [],
      players: { host1: { name: 'Alice', score: 0 }, guest1: { name: 'Bob', score: 0 } },
      playerOrder: ['host1', 'guest1'],
      currentTurn: 0,
      status: 'playing',
      difficulty: 3,
    });

    flipCard(db, 'ABCD', 'host1', 0); // flip 'a'
    const result = flipCard(db, 'ABCD', 'host1', 1); // flip 'a' — match!
    expect(result.match).toBe(true);

    const room = db.get('rooms/ABCD');
    expect(room.matched).toEqual([1, 1, 0, 0, 0, 0]);
    expect(room.players.host1.score).toBe(1);
    expect(room.currentTurn).toBe(0); // same player continues
    expect(room.flipped).toEqual([]);
  });

  it('mismatch flips cards back and passes turn', () => {
    db.set('rooms/ABCD', {
      board: ['a', 'b', 'a', 'b', 'c', 'c'],
      matched: [0, 0, 0, 0, 0, 0],
      flipped: [],
      players: { host1: { name: 'Alice', score: 0 }, guest1: { name: 'Bob', score: 0 } },
      playerOrder: ['host1', 'guest1'],
      currentTurn: 0,
      status: 'playing',
      difficulty: 3,
    });

    flipCard(db, 'ABCD', 'host1', 0); // flip 'a'
    const result = flipCard(db, 'ABCD', 'host1', 1); // flip 'b' — no match
    expect(result.match).toBe(false);

    const room = db.get('rooms/ABCD');
    expect(room.currentTurn).toBe(1); // turn passes to guest
    expect(room.flipped).toEqual([]); // cards flipped back
    expect(room.matched).toEqual([0, 0, 0, 0, 0, 0]); // nothing matched
  });

  it('turn passes back and forth correctly', () => {
    db.set('rooms/ABCD', {
      board: ['a', 'b', 'c', 'a', 'b', 'c'],
      matched: [0, 0, 0, 0, 0, 0],
      flipped: [],
      players: { host1: { name: 'Alice', score: 0 }, guest1: { name: 'Bob', score: 0 } },
      playerOrder: ['host1', 'guest1'],
      currentTurn: 0,
      status: 'playing',
      difficulty: 3,
    });

    // Host mismatches
    flipCard(db, 'ABCD', 'host1', 0);
    flipCard(db, 'ABCD', 'host1', 1);
    expect(db.get('rooms/ABCD').currentTurn).toBe(1);

    // Guest mismatches
    flipCard(db, 'ABCD', 'guest1', 2);
    flipCard(db, 'ABCD', 'guest1', 1);
    expect(db.get('rooms/ABCD').currentTurn).toBe(0);

    // Back to host
    expect(MP.isMyTurn(db.get('rooms/ABCD'), 'host1')).toBe(true);
  });

  it('cannot flip same card twice', () => {
    db.set('rooms/ABCD', {
      board: ['a', 'b', 'a', 'b'],
      matched: [0, 0, 0, 0],
      flipped: [0],
      players: { host1: { name: 'Alice', score: 0 }, guest1: { name: 'Bob', score: 0 } },
      playerOrder: ['host1', 'guest1'],
      currentTurn: 0,
      status: 'playing',
      difficulty: 2,
    });

    const result = flipCard(db, 'ABCD', 'host1', 0);
    expect(result.error).toBe('cannot flip');
  });

  it('cannot flip already matched card', () => {
    db.set('rooms/ABCD', {
      board: ['a', 'b', 'a', 'b'],
      matched: [1, 0, 1, 0],
      flipped: [],
      players: { host1: { name: 'Alice', score: 1 }, guest1: { name: 'Bob', score: 0 } },
      playerOrder: ['host1', 'guest1'],
      currentTurn: 0,
      status: 'playing',
      difficulty: 2,
    });

    const result = flipCard(db, 'ABCD', 'host1', 0);
    expect(result.error).toBe('cannot flip');
  });

  it('game ends when all pairs matched', () => {
    db.set('rooms/ABCD', {
      board: ['a', 'a', 'b', 'b'],
      matched: [1, 1, 0, 0],
      flipped: [],
      players: { host1: { name: 'Alice', score: 1 }, guest1: { name: 'Bob', score: 0 } },
      playerOrder: ['host1', 'guest1'],
      currentTurn: 0,
      status: 'playing',
      difficulty: 2,
    });

    flipCard(db, 'ABCD', 'host1', 2);
    const result = flipCard(db, 'ABCD', 'host1', 3);
    expect(result.match).toBe(true);
    expect(result.gameOver).toBe(true);

    const room = db.get('rooms/ABCD');
    expect(room.status).toBe('finished');
    expect(room.matched).toEqual([1, 1, 1, 1]);
  });

  it('winner is the player with most pairs', () => {
    const players = {
      host1: { name: 'Alice', score: 5 },
      guest1: { name: 'Bob', score: 3 },
    };
    const winner = MP.getWinner(players);
    expect(winner.name).toBe('Alice');
  });

  it('detects tie correctly', () => {
    const players = {
      host1: { name: 'Alice', score: 4 },
      guest1: { name: 'Bob', score: 4 },
    };
    const result = MP.getWinner(players);
    expect(result.tie).toBe(true);
  });

  it('spectator cannot flip cards', () => {
    db.set('rooms/ABCD', {
      board: ['a', 'a', 'b', 'b'],
      matched: [0, 0, 0, 0],
      flipped: [],
      players: { host1: { name: 'Alice', score: 0 }, guest1: { name: 'Bob', score: 0 } },
      playerOrder: ['host1', 'guest1'],
      currentTurn: 0,
      status: 'playing',
      difficulty: 2,
    });

    const result = flipCard(db, 'ABCD', 'spectator1', 0);
    expect(result.error).toBe('cannot flip');
  });

  it('full game: both players find all pairs', () => {
    db.set('rooms/ABCD', {
      board: ['a', 'b', 'a', 'b'],
      matched: [0, 0, 0, 0],
      flipped: [],
      players: { host1: { name: 'Alice', score: 0 }, guest1: { name: 'Bob', score: 0 } },
      playerOrder: ['host1', 'guest1'],
      currentTurn: 0,
      status: 'playing',
      difficulty: 2,
    });

    // Host finds pair 'a'
    flipCard(db, 'ABCD', 'host1', 0);
    flipCard(db, 'ABCD', 'host1', 2);
    let room = db.get('rooms/ABCD');
    expect(room.players.host1.score).toBe(1);
    expect(room.currentTurn).toBe(0); // match — same player

    // Host mismatches
    flipCard(db, 'ABCD', 'host1', 1);
    flipCard(db, 'ABCD', 'host1', 0); // already matched — can't flip
    // Actually card 0 is matched, so this should fail
    room = db.get('rooms/ABCD');

    // Let's do it properly — host tries to find 'b' but mismatches
    // Card 1 is 'b', card 3 is 'b' — but host flipped card 1, now needs second
    // Reset flipped state after the failed flip of matched card
    db.set('rooms/ABCD/flipped', []);

    // Host flips b pair
    flipCard(db, 'ABCD', 'host1', 1);
    const finalResult = flipCard(db, 'ABCD', 'host1', 3);
    expect(finalResult.match).toBe(true);
    expect(finalResult.gameOver).toBe(true);

    room = db.get('rooms/ABCD');
    expect(room.status).toBe('finished');
    expect(room.players.host1.score).toBe(2);
  });
});

// ============================================================
// Edge cases
// ============================================================

describe('Edge cases', () => {
  let db;

  beforeEach(() => {
    db = new MockFirebaseDb();
  });

  it('handles room with only one player trying to play', () => {
    db.set('rooms/ABCD', {
      board: ['a', 'a'],
      matched: [0, 0],
      flipped: [],
      players: { host1: { name: 'Alice', score: 0 } },
      playerOrder: ['host1'],
      currentTurn: 0,
      status: 'waiting', // still waiting
      difficulty: 1,
    });

    // Can't flip when waiting
    const result = flipCard(db, 'ABCD', 'host1', 0);
    expect(result.error).toBe('cannot flip');
  });

  it('handles large board (36 pairs = 72 cards)', () => {
    const tiles = Array.from({ length: 36 }, (_, i) => `tile_${i}`);
    const board = MP.buildBoard(36, tiles);
    expect(board).toHaveLength(72);
    const unique = new Set(board);
    expect(unique.size).toBe(36);
  });
});
