// feedback.js — Sound effects (Web Audio API) and haptic feedback (Vibration API)

let audioCtx = null;
let muted = localStorage.getItem('membery_mute') === '1';

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// --- Mute toggle ---

function isMuted() { return muted; }

function toggleMute() {
  muted = !muted;
  localStorage.setItem('membery_mute', muted ? '1' : '0');
  return muted;
}

// --- Haptics ---

function vibrate(pattern) {
  if (muted) return;
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// --- Sound synthesis helpers ---

function playTone(freq, duration, type = 'sine', volume = 0.15) {
  if (muted) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* audio not available */ }
}

function playNoise(duration, volume = 0.06) {
  if (muted) return;
  try {
    const ctx = getAudioCtx();
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  } catch (e) { /* audio not available */ }
}

// --- Game sounds ---

function sfxFlip() {
  playNoise(0.06, 0.12);
  playTone(800, 0.05, 'square', 0.04);
  vibrate(8);
}

function sfxMatch() {
  playTone(660, 0.12, 'sine', 0.15);
  setTimeout(() => playTone(880, 0.18, 'sine', 0.12), 100);
  vibrate([10, 30, 10]);
}

function sfxMismatch() {
  playTone(250, 0.25, 'triangle', 0.1);
  vibrate(25);
}

function sfxWin() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.3, 'sine', 0.12), i * 120);
  });
  vibrate([15, 40, 15, 40, 15, 40, 30]);
}

function sfxNewGame() {
  // Quick shuffle sound — a few rapid soft clicks
  for (let i = 0; i < 4; i++) {
    setTimeout(() => playNoise(0.03, 0.08), i * 50);
  }
}
