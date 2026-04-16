// Smoke test: multiplayer.js loads cleanly in a browser-like environment

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Browser environment', () => {
  let dom;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="mp-section" class="hidden"></div><div id="splash"></div><header></header><div id="grid"></div></body></html>', {
      url: 'http://localhost/',
      runScripts: 'outside-only',
    });
  });

  it('multiplayer.js loads without syntax errors', () => {
    const src = readFileSync(join(__dirname, '../web/multiplayer.js'), 'utf8');
    expect(() => {
      dom.window.eval(src);
    }).not.toThrow();
  });

  it('MP is globally available after load', () => {
    const src = readFileSync(join(__dirname, '../web/multiplayer.js'), 'utf8');
    dom.window.eval(src);
    expect(dom.window.MP).toBeDefined();
    expect(typeof dom.window.MP.generateRoomCode).toBe('function');
    expect(typeof dom.window.MP.buildBoard).toBe('function');
    expect(typeof dom.window.MP.canFlip).toBe('function');
  });

  it('all public functions are exposed', () => {
    const src = readFileSync(join(__dirname, '../web/multiplayer.js'), 'utf8');
    dom.window.eval(src);
    const MP = dom.window.MP;
    expect(MP.generateRoomCode).toBeDefined();
    expect(MP.buildBoard).toBeDefined();
    expect(MP.isMyTurn).toBeDefined();
    expect(MP.canFlip).toBeDefined();
    expect(MP.checkMatch).toBeDefined();
    expect(MP.getScores).toBeDefined();
    expect(MP.getWinner).toBeDefined();
    expect(MP.isGameOver).toBeDefined();
    expect(MP.nextTurn).toBeDefined();
    expect(MP.getRole).toBeDefined();
    expect(MP.gridColumns).toBeDefined();
  });
});
