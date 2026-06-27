#!/usr/bin/env python3
"""
Generate the recording start/stop UI chimes in assets/sounds/.

This is an OPTIONAL developer tool — the resulting .aiff files are committed to
the repo, so you do NOT need to run this to build or use the app. Run it only to
re-tune the sounds.

Usage:
    pip install numpy scipy soundfile        # one-time (not a runtime dep)
    python3 scripts/gen-sounds.py            # writes assets/sounds/{start,stop}.aiff

Design — "cool, catchy, captivating", not a system beep:
  - FM-bell / additive timbre (glassy, expensive-sounding) instead of bare sine
  - Musical arpeggios in C major (a recognizable, matched motif pair)
      START = ascending C major  C5 E5 G5 C6  -> "bloom / opening / listening"
      STOP  = descending         C6 G5 E5 C5  -> "settle / resolved / done"
  - Per-note fast pluck envelope (percussive, satisfying)
  - Shimmer octave layer for sparkle (brighter on start, softer on stop)
  - Equal-power stereo pan sweep across the notes (width + motion)
  - Light algorithmic plate reverb tail (decorrelated L/R) for polish
  - Gentle high-pass + low-pass shaping, fade-out, soft-limit (no clicks/clipping)
  - Trimmed so file length tracks audible content (start ~0.5s, stop ~0.65s)
"""

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
OUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "sounds"

# Equal-tempered C major frequencies
C5, E5, G5, C6 = 523.25, 659.25, 783.99, 1046.50


def fm_bell(freq, dur, *, ratio=2.0, index0=3.2, amp=1.0, shimmer=0.18,
            tau_amp=0.18, tau_idx=0.055):
    """One glassy FM-bell note with a fast pluck envelope."""
    n = int(dur * SR)
    t = np.arange(n) / SR

    env = np.exp(-t / tau_amp)
    atk = max(1, int(0.004 * SR))
    ramp = np.ones(n)
    ramp[:atk] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, atk))
    env *= ramp

    idx = index0 * np.exp(-t / tau_idx)
    modulator = idx * np.sin(2 * np.pi * freq * ratio * t)
    carrier = np.sin(2 * np.pi * freq * t + modulator)

    body = 0.5 * np.sin(2 * np.pi * freq * t)
    shim = shimmer * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t / 0.045)

    return (carrier + body + shim) * env * amp


def pan(mono, p):
    """Equal-power pan. p in [-1, 1] (-1 = left, +1 = right). Returns (n, 2)."""
    angle = (p + 1.0) * (np.pi / 4.0)
    return np.column_stack((mono * np.cos(angle), mono * np.sin(angle)))


def stereo_reverb(stereo, *, mix=0.22, tail=0.30, predelay=0.012, seed=7):
    """Light plate-ish reverb via convolution with decaying decorrelated noise."""
    rng = np.random.default_rng(seed)
    m = int(tail * SR)
    t = np.arange(m) / SR
    decay = np.exp(-t / (tail * 0.5))
    pre = int(predelay * SR)

    def make_ir(s):
        ir = np.random.default_rng(s).standard_normal(m) * decay
        ir = np.concatenate((np.zeros(pre), ir))
        ir[0] += 1.0  # dry impulse so convolution preserves the direct sound
        return ir

    irL, irR = make_ir(seed), make_ir(seed + 1)
    wetL = fftconvolve(stereo[:, 0], irL)[: len(stereo) + m]
    wetR = fftconvolve(stereo[:, 1], irR)[: len(stereo) + m]

    out = np.zeros((len(wetL), 2))
    out[: len(stereo), 0] += (1 - mix) * stereo[:, 0]
    out[: len(stereo), 1] += (1 - mix) * stereo[:, 1]
    out[:, 0] += mix * wetL
    out[:, 1] += mix * wetR
    return out


def trim_tail(stereo, *, thresh_db=-40.0, pad=0.015):
    """Drop trailing near-silence so file length tracks audible content."""
    peak = np.max(np.abs(stereo)) or 1.0
    thr = peak * 10 ** (thresh_db / 20.0)
    mono = np.max(np.abs(stereo), axis=1)
    loud = np.where(mono > thr)[0]
    if len(loud) == 0:
        return stereo
    last = min(len(stereo), loud[-1] + int(pad * SR))
    return stereo[:last]


def shape_and_master(stereo, *, peak_dbfs=-1.5):
    """High-pass + low-pass, soft-limit, fade-out, normalize to a target peak."""
    sos_hp = butter(2, 110, btype="highpass", fs=SR, output="sos")
    sos_lp = butter(4, 13000, btype="lowpass", fs=SR, output="sos")
    for ch in range(2):
        x = sosfilt(sos_hp, stereo[:, ch])
        x = sosfilt(sos_lp, x)
        stereo[:, ch] = x

    stereo = np.tanh(stereo * 1.05)

    fade = min(int(0.012 * SR), len(stereo))
    stereo[-fade:] *= np.linspace(1.0, 0.0, fade)[:, None]

    peak = np.max(np.abs(stereo)) or 1.0
    stereo *= (10 ** (peak_dbfs / 20.0)) / peak
    return stereo


def render(freqs, *, ascending, shimmer, onset, note_dur, last_dur,
           tau_other, tau_last, reverb_mix, reverb_tail, seed):
    """Render an arpeggio with a stereo pan sweep + reverb, trimmed tight."""
    pans = np.linspace(-0.45, 0.45, len(freqs))
    if not ascending:
        pans = pans[::-1]

    total = int((onset * (len(freqs) - 1) + last_dur) * SR) + 1
    buf = np.zeros((total, 2))

    for i, f in enumerate(freqs):
        is_last = i == len(freqs) - 1
        dur = last_dur if is_last else note_dur
        amp = 1.0 if is_last else 0.82
        note = fm_bell(f, dur, amp=amp, shimmer=shimmer,
                       tau_amp=tau_last if is_last else tau_other)
        st = pan(note, pans[i])
        start = int(i * onset * SR)
        buf[start:start + len(st)] += st

    buf = stereo_reverb(buf, mix=reverb_mix, tail=reverb_tail, seed=seed)
    buf = trim_tail(buf)
    return shape_and_master(buf)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    start = render([C5, E5, G5, C6], ascending=True, shimmer=0.22,
                   onset=0.047, note_dur=0.16, last_dur=0.26,
                   tau_other=0.075, tau_last=0.12,
                   reverb_mix=0.16, reverb_tail=0.10, seed=7)

    stop = render([C6, G5, E5, C5], ascending=False, shimmer=0.10,
                  onset=0.052, note_dur=0.18, last_dur=0.34,
                  tau_other=0.085, tau_last=0.18,
                  reverb_mix=0.22, reverb_tail=0.15, seed=13)

    for name, sig in (("start", start), ("stop", stop)):
        path = OUT_DIR / f"{name}.aiff"
        sf.write(str(path), sig, SR, subtype="PCM_16", format="AIFF")
        peak = float(np.max(np.abs(sig)))
        rms = float(np.sqrt(np.mean(sig ** 2)))
        print(f"wrote {path}  dur={len(sig) / SR:.3f}s  "
              f"peak={20 * np.log10(peak):+.2f}dBFS  "
              f"rms={20 * np.log10(rms):+.2f}dBFS")


if __name__ == "__main__":
    main()
