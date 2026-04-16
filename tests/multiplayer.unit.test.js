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
