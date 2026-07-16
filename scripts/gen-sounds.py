#!/usr/bin/env python3
"""
Generate the recording start/stop UI chimes in assets/sounds/.

This is an OPTIONAL developer tool — the resulting .aiff files are committed to
the repo, so you do NOT need to run this to build or use the app. Run it only to
re-tune the sounds.

Usage:
    pip install numpy scipy soundfile        # one-time (not a runtime dep)
    python3 scripts/gen-sounds.py            # writes assets/sounds/{start,stop}.aiff

Design — a crisp, subtle cue that fires on *every* dictation, so it must be
short, quiet, and clean (NOT a loud, brick-limited jingle):
  - FM-bell / additive timbre (glassy) with a soft modulation index
  - Minimal two-note motif — an open perfect fifth (a matched, recognizable pair)
      START = ascending  C5 -> G5   "open / listening"
      STOP  = descending G5 -> C5   "settle / done"
  - Per-note fast pluck envelope (percussive, satisfying)
  - Light shimmer octave for a touch of sparkle (brighter on start)
  - Gentle equal-power stereo pan for a little width
  - Very light plate-ish reverb tail for polish
  - Gentle high-pass + low-pass, fade-out, and — critically — NO tanh
    soft-clip: the signal is peak-normalized to a modest -6 dBFS with its
    natural dynamics intact (crest ~3, zero flat-topping), so it never sounds
    saturated or harsh the way a loud limited master does.
  - Trimmed so file length tracks audible content (~0.28s / ~0.31s)
"""

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
OUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "sounds"

# Equal-tempered C major frequencies
C5, G5 = 523.25, 783.99

# Master peak target. Deliberately modest for a UI cue so it ducks under
# speech instead of stabbing over it. NOTE: keep well below 0 dBFS — the
# whole point of this rewrite is to avoid a loud, limited "brick".
PEAK_DBFS = -6.0


def fm_bell(freq, dur, *, ratio=2.0, index0=2.6, amp=1.0, shimmer=0.12,
            tau_amp=0.14, tau_idx=0.05):
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
    shim = shimmer * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t / 0.04)

    return (carrier + body + shim) * env * amp


def pan(mono, p):
    """Equal-power pan. p in [-1, 1] (-1 = left, +1 = right). Returns (n, 2)."""
    angle = (p + 1.0) * (np.pi / 4.0)
    return np.column_stack((mono * np.cos(angle), mono * np.sin(angle)))


def stereo_reverb(stereo, *, mix, tail, predelay=0.01, seed=7):
    """Light plate-ish reverb via convolution with decaying decorrelated noise."""
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


def trim_tail(stereo, *, thresh_db=-45.0, pad=0.012):
    """Drop trailing near-silence so file length tracks audible content."""
    peak = np.max(np.abs(stereo)) or 1.0
    thr = peak * 10 ** (thresh_db / 20.0)
    mono = np.max(np.abs(stereo), axis=1)
    loud = np.where(mono > thr)[0]
    if len(loud) == 0:
        return stereo
    last = min(len(stereo), loud[-1] + int(pad * SR))
    return stereo[:last]


def shape_and_master(stereo, *, peak_dbfs=PEAK_DBFS):
    """High-pass + low-pass, fade-out, peak-normalize.

    No soft-clip / limiter: we normalize to a modest peak and keep the
    natural transient dynamics. Limiting a summed, reverberant signal up to
    ~-1.5 dBFS is exactly what made the previous cues sound harsh (flat-topped
    brick, crest ~1.1). Here crest stays ~3+ and there is no flat-topping.
    """
    sos_hp = butter(2, 90, btype="highpass", fs=SR, output="sos")
    sos_lp = butter(4, 14000, btype="lowpass", fs=SR, output="sos")
    for ch in range(2):
        x = sosfilt(sos_hp, stereo[:, ch])
        x = sosfilt(sos_lp, x)
        stereo[:, ch] = x

    fade = min(int(0.012 * SR), len(stereo))
    stereo[-fade:] *= np.linspace(1.0, 0.0, fade)[:, None]

    peak = np.max(np.abs(stereo)) or 1.0
    stereo *= (10 ** (peak_dbfs / 20.0)) / peak
    return stereo


def render(freqs, *, ascending, shimmer, onset, note_dur, last_dur,
           tau_other, tau_last, reverb_mix, reverb_tail, seed):
    """Render an arpeggio with a gentle stereo pan + reverb, trimmed tight."""
    pans = np.linspace(-0.4, 0.4, len(freqs))
    if not ascending:
        pans = pans[::-1]

    total = int((onset * (len(freqs) - 1) + last_dur) * SR) + 1
    buf = np.zeros((total, 2))

    for i, f in enumerate(freqs):
        is_last = i == len(freqs) - 1
        dur = last_dur if is_last else note_dur
        amp = 1.0 if is_last else 0.8
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

    start = render([C5, G5], ascending=True, shimmer=0.12,
                   onset=0.058, note_dur=0.10, last_dur=0.17,
                   tau_other=0.06, tau_last=0.10,
                   reverb_mix=0.08, reverb_tail=0.05, seed=3)

    stop = render([G5, C5], ascending=False, shimmer=0.06,
                  onset=0.062, note_dur=0.11, last_dur=0.19,
                  tau_other=0.07, tau_last=0.12,
                  reverb_mix=0.10, reverb_tail=0.06, seed=5)

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
