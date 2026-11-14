/*
 * audio.js — SFX sintetis kecil (tanpa aset), pakai WebAudio.
 */
(function () {
  'use strict';

  var ac = null;
  var muted = false;
  var master = null;

  function ensure() {
    if (ac) return ac;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(ac.destination);
    } catch (err) {
      ac = null;
    }
    return ac;
  }

  function tone(freq, dur, opt) {
    if (muted) return;
    var c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    opt = opt || {};
    var t0 = c.currentTime + (opt.delay || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opt.slide) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(24, freq + opt.slide), t0 + dur);
    }
    var peak = opt.gain === undefined ? 0.07 : opt.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Derau pendek untuk tembakan. */
  function noise(dur, gain, filterFreq) {
    if (muted) return;
    var c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();

    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    var src = c.createBufferSource();
    src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq || 1400;
    f.Q.value = 0.8;
    var g = c.createGain();
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start();
  }

  window.Sound = {
    step: function () {
      tone(150 + Math.random() * 50, 0.05, { type: 'triangle', gain: 0.018 });
    },
    key: function () {
      tone(880, 0.12, { type: 'triangle', gain: 0.08 });
      tone(1320, 0.18, { type: 'triangle', gain: 0.055, delay: 0.07 });
    },
    bump: function () {
      tone(96, 0.09, { type: 'square', gain: 0.03, slide: -30 });
    },
    win: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone(f, 0.2, { type: 'triangle', gain: 0.06, delay: i * 0.085 });
      });
    },
    click: function () {
      tone(560, 0.05, { type: 'sine', gain: 0.035 });
    },

    // --- senjata ---
    shoot: function () {
      noise(0.16, 0.16, 1500);
      tone(160, 0.11, { type: 'square', gain: 0.09, slide: -110 });
    },
    dry: function () {
      tone(210, 0.05, { type: 'square', gain: 0.04 });
    },
    reload: function () {
      tone(320, 0.06, { type: 'square', gain: 0.05 });
      tone(520, 0.06, { type: 'square', gain: 0.045, delay: 0.16 });
      tone(760, 0.07, { type: 'square', gain: 0.04, delay: 0.34 });
    },
    hit: function () {
      tone(1200, 0.07, { type: 'square', gain: 0.05, slide: -300 });
    },
    kill: function () {
      tone(320, 0.18, { type: 'sawtooth', gain: 0.07, slide: -260 });
      noise(0.28, 0.1, 700);
    },

    // --- penjaga ---
    alert: function () {
      tone(660, 0.1, { type: 'square', gain: 0.06 });
      tone(990, 0.14, { type: 'square', gain: 0.06, delay: 0.1 });
    },
    chase: function () {
      tone(90, 0.16, { type: 'sine', gain: 0.07, slide: 30 });
    },
    caught: function () {
      tone(420, 0.28, { type: 'sawtooth', gain: 0.09, slide: -330 });
      tone(150, 0.5, { type: 'sine', gain: 0.07, delay: 0.12, slide: -90 });
    },

    setMuted: function (m) { muted = !!m; },
    isMuted: function () { return muted; },
    unlock: function () {
      var c = ensure();
      if (c && c.state === 'suspended') c.resume();
    }
  };
})();
