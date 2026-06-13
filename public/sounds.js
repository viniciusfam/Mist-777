/**
 * sounds.js — Blackjack 21 PvP Sound Engine
 * All sounds generated procedurally via Web Audio API.
 * No external files. Tuned for maximum dopamine response.
 */

const Sounds = (() => {
  let ctx = null;
  let masterGain = null;
  let enabled = true;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.7;
      masterGain.connect(ctx.destination);
    }
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── Utility: connect node chain ─────────────────────────────────────────────
  function chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i].connect(nodes[i + 1]);
    }
    nodes[nodes.length - 1].connect(masterGain);
  }

  // ── Oscillator helper ────────────────────────────────────────────────────────
  function osc(type, freq, startTime, duration, gainStart, gainEnd) {
    const c = getCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, startTime);
    g.gain.setValueAtTime(gainStart, startTime);
    g.gain.exponentialRampToValueAtTime(Math.max(gainEnd, 0.001), startTime + duration);
    o.connect(g);
    g.connect(masterGain);
    o.start(startTime);
    o.stop(startTime + duration + 0.05);
    return { osc: o, gain: g };
  }

  // ── Noise burst helper ───────────────────────────────────────────────────────
  function noise(duration, gainVal, filterFreq, filterType = 'bandpass') {
    const c = getCtx();
    const bufferSize = c.sampleRate * duration;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    src.buffer = buffer;

    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.5;

    const g = c.createGain();
    g.gain.setValueAtTime(gainVal, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(c.currentTime);
    src.stop(c.currentTime + duration);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SOUND DEFINITIONS
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * 🃏 Card Deal — crisp paper swoosh
   * Short filtered white noise burst with subtle tone.
   * Fires every time a card appears on the table.
   */
  function cardDeal() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // High-passed noise burst → paper swoosh
    noise(0.08, 0.35, 3200, 'highpass');

    // Subtle thud at the end
    osc('sine', 180, t + 0.04, 0.06, 0.15, 0.001);
  }

  /**
   * 🃏 Hit (Ninja Shuriken Slash) — aggressive blade swish + heavy snap
   * Maximum dopamine for drawing a card in the Kirigakure theme.
   */
  function hit() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // Layer 1: Blade Swish (High pitched metallic noise slice)
    const swishSize = Math.floor(c.sampleRate * 0.1);
    const swishBuf  = c.createBuffer(1, swishSize, c.sampleRate);
    const swishData = swishBuf.getChannelData(0);
    for (let i = 0; i < swishSize; i++) {
      // Exponential decay envelope for sharp slice
      const env = Math.exp(-i / (swishSize * 0.2));
      swishData[i] = (Math.random() * 2 - 1) * env;
    }
    const swishSrc = c.createBufferSource();
    swishSrc.buffer = swishBuf;
    
    const swishFilter = c.createBiquadFilter();
    swishFilter.type = 'highpass';
    swishFilter.frequency.value = 6000;
    
    const swishGain = c.createGain();
    swishGain.gain.setValueAtTime(0.6, t);
    swishGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    
    swishSrc.connect(swishFilter);
    swishFilter.connect(swishGain);
    swishGain.connect(masterGain);
    swishSrc.start(t);
    swishSrc.stop(t + 0.1);

    // Layer 2: Metallic Ring (Kunai resonance)
    const ring = c.createOscillator();
    ring.type = 'triangle';
    ring.frequency.setValueAtTime(3200, t);
    ring.frequency.exponentialRampToValueAtTime(1800, t + 0.08);
    const ringGain = c.createGain();
    ringGain.gain.setValueAtTime(0.15, t);
    ringGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    ring.connect(ringGain);
    ringGain.connect(masterGain);
    ring.start(t);
    ring.stop(t + 0.1);

    // Layer 3: Heavy Snap Impact (Card slamming into table)
    const snap = c.createOscillator();
    snap.type = 'square';
    snap.frequency.setValueAtTime(400, t + 0.02);
    snap.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    const snapGain = c.createGain();
    snapGain.gain.setValueAtTime(0.4, t + 0.02);
    snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    snap.connect(snapGain);
    snapGain.connect(masterGain);
    snap.start(t + 0.02);
    snap.stop(t + 0.1);
  }

  /**
   * ✋ Stand Button — firm lock-in click
   */
  function stand() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('square', 300, t, 0.04, 0.12, 0.001);
    osc('sine',   150, t, 0.07, 0.08, 0.001);
  }

  /**
   * ⏱️ Timer Tick — urgent metronome pulse (last 5 seconds)
   */
  function timerTick() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('square', 880, t,        0.03, 0.06, 0.001);
    osc('sine',   440, t + 0.01, 0.04, 0.04, 0.001);
  }

  /**
   * 💥 Bust — descending "wah wah" failure tone
   * Classic losing sound, slightly dramatic.
   */
  function bust() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // Descending wah sequence
    const freqs = [400, 320, 260, 180];
    freqs.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      const wah = c.createBiquadFilter();
      wah.type = 'bandpass';
      wah.frequency.value = f * 2;
      wah.Q.value = 3;

      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t + i * 0.13);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + i * 0.13 + 0.12);

      g.gain.setValueAtTime(0.18, t + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.13 + 0.15);

      o.connect(wah);
      wah.connect(g);
      g.connect(masterGain);
      o.start(t + i * 0.13);
      o.stop(t + i * 0.13 + 0.2);
    });
  }

  /**
   * ✨ Hit 21 (mid-game) — rising sparkle arpeggio
   * Exciting but not as big as blackjack — encourages "so close!" feeling.
   */
  function hit21() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // Rising arpeggio: C4 E4 G4 C5
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, i) => {
      const delay = i * 0.08;
      osc('sine',     freq,      t + delay, 0.25, 0.22, 0.001);
      osc('triangle', freq * 2,  t + delay, 0.18, 0.08, 0.001);
    });

    // Coin shimmer
    setTimeout(() => {
      for (let i = 0; i < 4; i++) {
        setTimeout(() => noise(0.04, 0.12, 8000 + Math.random() * 4000, 'highpass'), i * 50);
      }
    }, 300);
  }

  /**
   * 🔔 Your Turn — clear, attention-grabbing double chime
   * A synthetic bell that cuts through the mix to alert the player.
   */
  function yourTurn() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // High, bright double bell
    const notes = [
      [880, 0.0],       // A5
      [1108.73, 0.12]   // C#6
    ];

    notes.forEach(([freq, delay]) => {
      osc('sine',     freq,       t + delay, 0.3, 0.15, 0.001);
      osc('triangle', freq * 1.5, t + delay, 0.2, 0.05, 0.001);
    });
  }

  /**
   * ♠ BLACKJACK NATURAL — full dopamine explosion
   * Triumphant fanfare + coin rain cascade.
   * The biggest reward sound in the game.
   */
  function blackjack() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // ── Fanfare chord progression ──────────────────────────────────────────────
    // G major → C major → G major (triumphant)
    const fanfare = [
      // [freq, startDelay, duration, gain]
      [392.00, 0.00, 0.5,  0.25], // G4
      [493.88, 0.05, 0.45, 0.20], // B4
      [587.33, 0.10, 0.40, 0.20], // D5
      [783.99, 0.15, 0.50, 0.18], // G5 — peak
      [523.25, 0.50, 0.60, 0.22], // C5
      [659.25, 0.55, 0.55, 0.18], // E5
      [783.99, 0.60, 0.55, 0.20], // G5
      [1046.5, 0.70, 0.80, 0.15], // C6 — glory note
    ];

    fanfare.forEach(([freq, delay, dur, gain]) => {
      osc('sine',     freq,     t + delay, dur, gain,  0.001);
      osc('triangle', freq * 2, t + delay, dur * 0.7, gain * 0.3, 0.001);
    });

    // ── Bass punch ─────────────────────────────────────────────────────────────
    osc('sine', 98,  t,        0.3, 0.35, 0.001);
    osc('sine', 130, t + 0.01, 0.3, 0.25, 0.001);

    // ── Coin cascade rain ──────────────────────────────────────────────────────
    // 20 coin "tings" with random timing and pitch variation
    for (let i = 0; i < 20; i++) {
      const coinDelay = 0.1 + Math.random() * 1.2;
      const coinFreq  = 2000 + Math.random() * 3000;
      const coinGain  = 0.06 + Math.random() * 0.10;
      setTimeout(() => {
        const coinC = getCtx();
        const coinT = coinC.currentTime;
        osc('sine', coinFreq,       coinT,        0.06, coinGain, 0.001);
        osc('sine', coinFreq * 1.5, coinT + 0.01, 0.04, coinGain * 0.5, 0.001);
      }, coinDelay * 1000);
    }

    // ── Noise shimmer burst ────────────────────────────────────────────────────
    setTimeout(() => noise(0.15, 0.2, 6000, 'highpass'), 150);
    setTimeout(() => noise(0.15, 0.15, 8000, 'highpass'), 400);
    setTimeout(() => noise(0.1, 0.12, 10000, 'highpass'), 700);
  }

  /**
   * 👑 Win — victory jingle + coin shower
   * Played when a player wins the round.
   * Shorter than blackjack but still satisfying.
   */
  function win() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // Rising victory arpeggio
    const winNotes = [
      [261.63, 0.00, 0.3, 0.20], // C4
      [329.63, 0.12, 0.3, 0.20], // E4
      [392.00, 0.24, 0.3, 0.22], // G4
      [523.25, 0.36, 0.5, 0.25], // C5
      [659.25, 0.48, 0.6, 0.20], // E5
    ];

    winNotes.forEach(([freq, delay, dur, gain]) => {
      osc('sine',     freq,     t + delay, dur, gain, 0.001);
      osc('triangle', freq * 2, t + delay, dur * 0.5, gain * 0.25, 0.001);
    });

    // Coin shower (12 coins)
    for (let i = 0; i < 12; i++) {
      const d = 0.3 + Math.random() * 0.9;
      setTimeout(() => {
        const nc = getCtx();
        const nt = nc.currentTime;
        const f = 1800 + Math.random() * 2500;
        osc('sine', f, nt, 0.07, 0.08 + Math.random() * 0.06, 0.001);
      }, d * 1000);
    }

    setTimeout(() => noise(0.1, 0.18, 5000, 'highpass'), 200);
  }

  /**
   * 🏦 House Wins — dramatic low downer
   * The house takes the pot.
   */
  function houseWins() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // Dramatic descending bass
    const drama = [
      [220, 0.00, 0.4, 0.30],
      [185, 0.25, 0.4, 0.28],
      [155, 0.50, 0.4, 0.25],
      [110, 0.75, 0.7, 0.22],
    ];

    drama.forEach(([freq, delay, dur, gain]) => {
      osc('sawtooth', freq, t + delay, dur, gain, 0.001);
      osc('sine',     freq * 0.5, t + delay, dur, gain * 0.5, 0.001);
    });

    // Low rumble
    noise(1.2, 0.12, 120, 'lowpass');
  }

  /**
   * 🤝 Push (tie) — neutral short chime
   */
  function push() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('sine', 440, t,        0.2, 0.15, 0.001);
    osc('sine', 550, t + 0.05, 0.2, 0.12, 0.001);
    osc('sine', 440, t + 0.15, 0.3, 0.10, 0.001);
  }

  /**
   * 🚪 Player Joined — soft welcome chime
   */
  function playerJoined() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('sine', 523.25, t,        0.15, 0.12, 0.001); // C5
    osc('sine', 659.25, t + 0.10, 0.15, 0.10, 0.001); // E5
  }

  /**
   * 🚶 Player Left — soft exit tone
   */
  function playerLeft() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('sine', 392, t,        0.15, 0.10, 0.001);
    osc('sine', 330, t + 0.10, 0.15, 0.08, 0.001);
  }

  /**
   * 🎮 Game Start — drum roll + energetic kick
   */
  function gameStart() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;

    // Drum roll
    for (let i = 0; i < 8; i++) {
      const delay = i * 0.06;
      setTimeout(() => noise(0.05, 0.15 + i * 0.02, 2000, 'bandpass'), delay * 1000);
    }

    // Kick on beat
    setTimeout(() => {
      const kc = getCtx();
      const kt = kc.currentTime;
      osc('sine', 80, kt,        0.3, 0.5, 0.001);
      osc('sine', 60, kt + 0.05, 0.3, 0.3, 0.001);
      noise(0.08, 0.25, 3000, 'highpass');
    }, 480);
  }

  const literalCall = new Audio('/sounds/call.wav');
  literalCall.volume = 0.8;
  const literalFold = new Audio('/sounds/fold.mp3');
  literalFold.volume = 0.8;

  /**
   * 🃏 Call — wooden table knock (literal WAV or fallback)
   */
  function call() {
    if (!enabled) return;
    literalCall.currentTime = 0;
    literalCall.play().catch(() => {
      // Fallback
      const c = getCtx();
      const t = c.currentTime;
      osc('square', 120, t, 0.05, 0.3, 0.001);
      osc('square', 120, t + 0.15, 0.05, 0.3, 0.001);
      noise(0.05, 0.1, 800, 'bandpass');
      setTimeout(() => noise(0.05, 0.1, 800, 'bandpass'), 150);
    });
  }

  /**
   * 🔥 All In — heavy dramatic thud + escalating chime
   */
  function allIn() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    // Heavy thud
    osc('sawtooth', 80, t, 0.5, 0.6, 0.001);
    osc('sine', 50, t, 0.6, 0.8, 0.001);
    // Escalating chime
    osc('sine', 440, t, 0.2, 0.3, 0.001);
    osc('sine', 554.37, t + 0.1, 0.2, 0.3, 0.001); // C#5
    osc('sine', 659.25, t + 0.2, 0.4, 0.4, 0.001); // E5
  }

  /**
   * 🐔 Fold — Chicken cluck / squawk (literal MP3 or fallback)
   */
  function fold() {
    if (!enabled) return;
    literalFold.currentTime = 0;
    literalFold.play().catch(() => {
      // Fallback
      const c = getCtx();
      const t = c.currentTime;
      osc('sawtooth', 400, t, 0.1, 0.2, 0.001);
      osc('sawtooth', 350, t + 0.1, 0.1, 0.2, 0.001);
      osc('square', 450, t + 0.2, 0.15, 0.3, 0.001);
      noise(0.1, 0.1, 2000, 'bandpass');
    });
  }

  // Toggle sound on/off
  function toggle() {
    enabled = !enabled;
    return enabled;
  }

  function isEnabled() { return enabled; }

  // Public API
  return {
    cardDeal,
    hit,
    stand,
    yourTurn,
    timerTick,
    bust,
    hit21,
    blackjack,
    win,
    houseWins,
    push,
    playerJoined,
    playerLeft,
    gameStart,
    allIn,
    call,
    fold,
    toggle,
    isEnabled,
    init: getCtx,
  };
})();
