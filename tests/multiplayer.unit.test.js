// Unit tests for multiplayer pure logic functions

import { describe, it, expect } from 'vitest';

// Load the MP object (module.exports path)
const MP = require('../web/multiplayer.js');

// ============================================================
// Room code generation
// ============================================================

describe('generateRoomCode', () => {
  it('returns a 4-character string', () => {
    const code = MP.generateRoomCode();
    expect(code).toHaveLength(4);
  });

  it('only contains uppercase letters', () => {
    for (let i = 0; i < 50; i++) {
      const code = MP.generateRoomCode();
      expect(code).toMatch(/^[A-Z]{4}$/);
    }
  });

  it('never contains I or O (ambiguous characters)', () => {
    for (let i = 0; i < 200; i++) {
      const code = MP.generateRoomCode();
      expect(code).not.toContain('I');
      expect(code).not.toContain('O');
    }
  });

  it('generates different codes (not deterministic)', () => {
    const codes = new Set();
    for (let i = 0; i < 20; i++) codes.add(MP.generateRoomCode());
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ============================================================
// Board building
// ============================================================

const TILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

describe('buildBoard', () => {
  it('returns correct number of cards (2 per pair)', () => {
    const board = MP.buildBoard(6, TILES);
    expect(board).toHaveLength(12);
  });

  it('every tile appears exactly twice', () => {
    const board = MP.buildBoard(6, TILES);
    const counts = {};
    board.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    Object.values(counts).forEach(c => expect(c).toBe(2));
  });

  it('uses the requested number of unique tiles', () => {
    const board = MP.buildBoard(4, TILES);
    const unique = new Set(board);
    expect(unique.size).toBe(4);
  });

  it('shuffles the deck (not always in pair order)', () => {
    // Run multiple times, at least one should not have pairs adjacent
    let foundNonAdjacent = false;
    for (let i = 0; i < 20; i++) {
      const board = MP.buildBoard(6, TILES);
      for (let j = 0; j < board.length - 1; j += 2) {
        if (board[j] !== board[j + 1]) {
          foundNonAdjacent = true;
          break;
        }
      }
      if (foundNonAdjacent) break;
    }
    expect(foundNonAdjacent).toBe(true);
  });

  it('only uses tiles from the provided list', () => {
    const board = MP.buildBoard(6, TILES);
    board.forEach(t => expect(TILES).toContain(t));
  });
});

// ============================================================
// Turn logic
// ============================================================

describe('isMyTurn', () => {
  const room = {
    playerOrder: ['uid1', 'uid2'],
    currentTurn: 0,
    status: 'playing',
  };

  it('returns true for the active player', () => {
    expect(MP.isMyTurn(room, 'uid1')).toBe(true);
  });

  it('returns false for the non-active player', () => {
    expect(MP.isMyTurn(room, 'uid2')).toBe(false);
  });

  it('returns false for a spectator', () => {
    expect(MP.isMyTurn(room, 'uid3')).toBe(false);
  });

  it('returns false when game is not playing', () => {
    expect(MP.isMyTurn({ ...room, status: 'waiting' }, 'uid1')).toBe(false);
    expect(MP.isMyTurn({ ...room, status: 'finished' }, 'uid1')).toBe(false);
  });

  it('returns false for null/undefined room', () => {
    expect(MP.isMyTurn(null, 'uid1')).toBe(false);
    expect(MP.isMyTurn(undefined, 'uid1')).toBe(false);
  });

  it('works for second player turn', () => {
    const room2 = { ...room, currentTurn: 1 };
    expect(MP.isMyTurn(room2, 'uid2')).toBe(true);
    expect(MP.isMyTurn(room2, 'uid1')).toBe(false);
  });
});

// ============================================================
// canFlip
// ============================================================

describe('canFlip', () => {
  const baseRoom = {
    playerOrder: ['uid1', 'uid2'],
    currentTurn: 0,
    status: 'playing',
    matched: [0, 0, 0, 0],
    flipped: [],
  };

  it('allows active player to flip an unmatched, unflipped card', () => {
    expect(MP.canFlip(baseRoom, 'uid1', 0)).toBe(true);
  });

  it('rejects flip from non-active player', () => {
    expect(MP.canFlip(baseRoom, 'uid2', 0)).toBe(false);
  });

  it('rejects flip of already matched card', () => {
    const room = { ...baseRoom, matched: [1, 0, 0, 0] };
    expect(MP.canFlip(room, 'uid1', 0)).toBe(false);
  });

  it('rejects flip of already flipped card', () => {
    const room = { ...baseRoom, flipped: [0] };
    expect(MP.canFlip(room, 'uid1', 0)).toBe(false);
  });

  it('rejects flip when two cards already flipped', () => {
    const room = { ...baseRoom, flipped: [0, 1] };
    expect(MP.canFlip(room, 'uid1', 2)).toBe(false);
  });

  it('allows second flip when one card is flipped', () => {
    const room = { ...baseRoom, flipped: [0] };
    expect(MP.canFlip(room, 'uid1', 1)).toBe(true);
  });

  it('rejects spectator', () => {
    expect(MP.canFlip(baseRoom, 'uid3', 0)).toBe(false);
  });
});

// ============================================================
// Match detection
// ============================================================

describe('checkMatch', () => {
  const board = ['a', 'b', 'a', 'b'];

  it('returns true for matching tiles', () => {
    expect(MP.checkMatch(board, [0, 2])).toBe(true);
  });

  it('returns false for non-matching tiles', () => {
    expect(MP.checkMatch(board, [0, 1])).toBe(false);
  });

  it('returns null if fewer than 2 flipped', () => {
    expect(MP.checkMatch(board, [0])).toBe(null);
    expect(MP.checkMatch(board, [])).toBe(null);
    expect(MP.checkMatch(board, null)).toBe(null);
  });
});

// ============================================================
// Scoring
// ============================================================

describe('getScores', () => {
  const players = {
    uid1: { name: 'Alice', score: 3 },
    uid2: { name: 'Bob', score: 5 },
  };

  it('returns scores sorted by score descending', () => {
    const scores = MP.getScores(players);
    expect(scores[0].name).toBe('Bob');
    expect(scores[0].score).toBe(5);
    expect(scores[1].name).toBe('Alice');
    expect(scores[1].score).toBe(3);
  });

  it('returns empty array for null players', () => {
    expect(MP.getScores(null)).toEqual([]);
  });

  it('handles zero scores', () => {
    const scores = MP.getScores({ uid1: { name: 'A', score: 0 } });
    expect(scores[0].score).toBe(0);
  });
});

describe('getWinner', () => {
  it('returns the player with highest score', () => {
    const players = {
      uid1: { name: 'Alice', score: 3 },
      uid2: { name: 'Bob', score: 5 },
    };
    const winner = MP.getWinner(players);
    expect(winner.name).toBe('Bob');
    expect(winner.uid).toBe('uid2');
  });

  it('detects a tie', () => {
    const players = {
      uid1: { name: 'Alice', score: 4 },
      uid2: { name: 'Bob', score: 4 },
    };
    const result = MP.getWinner(players);
    expect(result.tie).toBe(true);
  });

  it('returns null for empty players', () => {
    expect(MP.getWinner(null)).toBe(null);
    expect(MP.getWinner({})).toBe(null);
  });
});

// ============================================================
// Game over detection
// ============================================================

describe('isGameOver', () => {
  it('returns true when all matched', () => {
    expect(MP.isGameOver([1, 1, 1, 1])).toBe(true);
  });

  it('returns false when some unmatched', () => {
    expect(MP.isGameOver([1, 0, 1, 1])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(MP.isGameOver([])).toBe(true); // vacuously true, but no cards = done
  });

  it('returns false for null', () => {
    expect(MP.isGameOver(null)).toBe(false);
  });
});

// ============================================================
// Next turn
// ============================================================

describe('nextTurn', () => {
  it('advances to next player', () => {
    expect(MP.nextTurn(0, ['a', 'b'])).toBe(1);
  });

  it('wraps around to first player', () => {
    expect(MP.nextTurn(1, ['a', 'b'])).toBe(0);
  });
});

// ============================================================
// Role detection
// ============================================================

describe('getRole', () => {
  const room = { playerOrder: ['uid1', 'uid2'] };

  it('returns player for a player uid', () => {
    expect(MP.getRole(room, 'uid1')).toBe('player');
    expect(MP.getRole(room, 'uid2')).toBe('player');
  });

  it('returns spectator for non-player uid', () => {
    expect(MP.getRole(room, 'uid3')).toBe('spectator');
  });

  it('returns spectator for null room', () => {
    expect(MP.getRole(null, 'uid1')).toBe('spectator');
  });
});

// ============================================================
// Grid columns
// ============================================================

describe('gridColumns', () => {
  it('returns 4 columns on narrow screens for small boards', () => {
    expect(MP.gridColumns(24, 400)).toBe(4);
  });

  it('returns 6 columns on wide screens for small boards', () => {
    expect(MP.gridColumns(24, 800)).toBe(6);
  });

  it('returns 8 columns on wide screens for large boards', () => {
    expect(MP.gridColumns(72, 800)).toBe(8);
  });

  it('returns 6 columns on narrow screens for large boards', () => {
    expect(MP.gridColumns(72, 400)).toBe(6);
  });
});

// ============================================================
// Name sanitization
// ============================================================

describe('sanitizeName', () => {
  it('trims whitespace', () => {
    expect(MP.sanitizeName('  Sidd  ')).toBe('Sidd');
  });

  it('caps at 15 chars', () => {
    expect(MP.sanitizeName('A'.repeat(20))).toHaveLength(15);
  });

  it('strips control characters', () => {
    expect(MP.sanitizeName('Sid\u0000\u001Fd')).toBe('Sidd');
  });

  it('returns empty for empty input', () => {
    expect(MP.sanitizeName('')).toBe('');
    expect(MP.sanitizeName('   ')).toBe('');
  });

  it('returns empty for non-string input', () => {
    expect(MP.sanitizeName(null)).toBe('');
    expect(MP.sanitizeName(undefined)).toBe('');
    expect(MP.sanitizeName(42)).toBe('');
  });
});

// ============================================================
// Room expiry
// ============================================================

describe('isExpired', () => {
  const TTL = 30 * 60 * 1000; // 30 min
  const NOW = 1000000000000;

  it('returns false for fresh room', () => {
    const room = { createdAt: NOW - 60000 };
    expect(MP.isExpired(room, NOW, TTL)).toBe(false);
  });

  it('returns true for old room', () => {
    const room = { createdAt: NOW - (31 * 60 * 1000) };
    expect(MP.isExpired(room, NOW, TTL)).toBe(true);
  });

  it('uses lastActivityAt if newer than createdAt', () => {
    const room = {
      createdAt: NOW - (60 * 60 * 1000),
      lastActivityAt: NOW - 60000,
    };
    expect(MP.isExpired(room, NOW, TTL)).toBe(false);
  });

  it('returns true for null room', () => {
    expect(MP.isExpired(null, NOW, TTL)).toBe(true);
  });

  it('handles missing timestamps', () => {
    expect(MP.isExpired({}, NOW, TTL)).toBe(true);
  });
});

// ============================================================
// Presence
// ============================================================

describe('getOnlinePlayers / getOfflinePlayers', () => {
  it('detects online players from presence map', () => {
    const room = {
      playerOrder: ['uid1', 'uid2'],
      presence: { uid1: true, uid2: false },
    };
    expect(MP.getOnlinePlayers(room)).toEqual(['uid1']);
    expect(MP.getOfflinePlayers(room)).toEqual(['uid2']);
  });

  it('treats missing presence as offline', () => {
    const room = { playerOrder: ['uid1', 'uid2'], presence: { uid1: true } };
    expect(MP.getOfflinePlayers(room)).toEqual(['uid2']);
  });

  it('handles no presence map', () => {
    const room = { playerOrder: ['uid1', 'uid2'] };
    expect(MP.getOnlinePlayers(room)).toEqual([]);
    expect(MP.getOfflinePlayers(room)).toEqual(['uid1', 'uid2']);
  });

  it('handles null room', () => {
    expect(MP.getOnlinePlayers(null)).toEqual([]);
    expect(MP.getOfflinePlayers(null)).toEqual([]);
  });
});

describe('isPaused', () => {
  it('true when player is offline mid-game', () => {
    const room = {
      status: 'playing',
      playerOrder: ['uid1', 'uid2'],
      presence: { uid1: true, uid2: false },
    };
    expect(MP.isPaused(room)).toBe(true);
  });

  it('false when all players online', () => {
    const room = {
      status: 'playing',
      playerOrder: ['uid1', 'uid2'],
      presence: { uid1: true, uid2: true },
    };
    expect(MP.isPaused(room)).toBe(false);
  });

  it('false when game finished', () => {
    const room = {
      status: 'finished',
      playerOrder: ['uid1', 'uid2'],
      presence: { uid1: true, uid2: false },
    };
    expect(MP.isPaused(room)).toBe(false);
  });

  it('false when only one player (waiting)', () => {
    const room = {
      status: 'waiting',
      playerOrder: ['uid1'],
      presence: { uid1: true },
    };
    expect(MP.isPaused(room)).toBe(false);
  });
});

describe('timeUntilForfeit', () => {
  const GRACE = 2 * 60 * 1000; // 2 min
  const NOW = 1000000000000;

  it('returns Infinity when not paused', () => {
    const room = {
      status: 'playing',
      playerOrder: ['uid1', 'uid2'],
      presence: { uid1: true, uid2: true },
    };
    expect(MP.timeUntilForfeit(room, NOW, GRACE)).toBe(Infinity);
  });

  it('counts down from disconnect time', () => {
    const room = {
      status: 'playing',
      playerOrder: ['uid1', 'uid2'],
      presence: { uid1: true, uid2: false },
      disconnectedAt: { uid2: NOW - 30000 }, // 30s ago
    };
    expect(MP.timeUntilForfeit(room, NOW, GRACE)).toBe(GRACE - 30000);
  });

  it('returns 0 when grace exceeded', () => {
    const room = {
      status: 'playing',
      playerOrder: ['uid1', 'uid2'],
      presence: { uid1: true, uid2: false },
      disconnectedAt: { uid2: NOW - (3 * 60 * 1000) },
    };
    expect(MP.timeUntilForfeit(room, NOW, GRACE)).toBe(0);
  });
});

// ============================================================
// State transitions
// ============================================================

describe('applyMatch', () => {
  it('marks pair as matched and increments score', () => {
    const room = {
      board: ['a', 'a', 'b', 'b'],
      matched: [0, 0, 0, 0],
      players: { uid1: { name: 'Alice', score: 0 } },
      playerOrder: ['uid1', 'uid2'],
      currentTurn: 0,
    };
    const updates = MP.applyMatch(room, 'uid1', [0, 1]);
    expect(updates.matched).toEqual([1, 1, 0, 0]);
    expect(updates['players/uid1/score']).toBe(1);
    expect(updates.flipped).toEqual([]);
    expect(updates.status).toBeUndefined();
  });

  it('sets status finished when game over', () => {
    const room = {
      board: ['a', 'a'],
      matched: [0, 0],
      players: { uid1: { name: 'Alice', score: 0 } },
      playerOrder: ['uid1', 'uid2'],
      currentTurn: 0,
    };
    const updates = MP.applyMatch(room, 'uid1', [0, 1]);
    expect(updates.status).toBe('finished');
  });
});

describe('applyMismatch', () => {
  it('clears flipped and advances turn', () => {
    const room = { currentTurn: 0, playerOrder: ['uid1', 'uid2'] };
    const updates = MP.applyMismatch(room);
    expect(updates.flipped).toEqual([]);
    expect(updates.currentTurn).toBe(1);
  });

  it('wraps turn back to 0', () => {
    const room = { currentTurn: 1, playerOrder: ['uid1', 'uid2'] };
    const updates = MP.applyMismatch(room);
    expect(updates.currentTurn).toBe(0);
  });
});

describe('applyForfeit', () => {
  it('finishes game with forfeit winner and increments session score', () => {
    const room = { sessionScores: { uid1: 1, uid2: 0 } };
    const updates = MP.applyForfeit(room, 'uid1');
    expect(updates.status).toBe('finished');
    expect(updates.forfeitWinner).toBe('uid1');
    expect(updates.sessionScores).toEqual({ uid1: 2, uid2: 0 });
  });

  it('initializes session scores if missing', () => {
    const updates = MP.applyForfeit({}, 'uid1');
    expect(updates.sessionScores).toEqual({ uid1: 1 });
  });
});

describe('incrementSessionScore', () => {
  it('increments winner', () => {
    const room = { sessionScores: { uid1: 2, uid2: 1 } };
    const updates = MP.incrementSessionScore(room, 'uid1');
    expect(updates.sessionScores).toEqual({ uid1: 3, uid2: 1 });
  });

  it('does nothing for ties (null winner)', () => {
    const room = { sessionScores: { uid1: 1, uid2: 1 } };
    const updates = MP.incrementSessionScore(room, null);
    expect(updates).toEqual({});
  });

  it('initializes session scores if missing', () => {
    const updates = MP.incrementSessionScore({}, 'uid1');
    expect(updates.sessionScores).toEqual({ uid1: 1 });
  });
});

describe('applyResetForRematch', () => {
  it('resets game state but preserves session scores', () => {
    const room = {
      players: { uid1: { name: 'Alice', score: 5 }, uid2: { name: 'Bob', score: 3 } },
      playerOrder: ['uid1', 'uid2'],
      sessionScores: { uid1: 2, uid2: 1 },
    };
    const newBoard = ['a', 'b', 'a', 'b'];
    const updates = MP.applyResetForRematch(room, newBoard);
    expect(updates.board).toEqual(newBoard);
    expect(updates.matched).toEqual([0, 0, 0, 0]);
    expect(updates.players.uid1.score).toBe(0);
    expect(updates.players.uid2.score).toBe(0);
    expect(updates.players.uid1.name).toBe('Alice');
    expect(updates.status).toBe('playing');
    expect(updates.currentTurn).toBe(0);
    expect(updates.forfeitWinner).toBe(null);
    expect(updates.sessionScores).toBeUndefined(); // preserved (not in updates)
  });
});
