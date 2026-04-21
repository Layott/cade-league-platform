"""
Overlay sound synthesis for the 27-overlay library.

Outputs 11 PCM WAV files (44.1 kHz, stereo, 16-bit) into
`apps/web/public/overlay/sounds/` plus a manifest.json.

Idempotent: re-running overwrites every file.

Run:
    py KNOWLEDGE/brand-assets/sounds/_synth.py
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import pathlib

import numpy as np
from scipy import signal
from scipy.io import wavfile

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

SR = 44100  # sample rate
PEAK = 0.92  # normalize each file's peak absolute sample to this (≈ -0.72 dBFS)

# Seed for deterministic noise textures so the committed files are reproducible.
RNG = np.random.default_rng(20260421)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT_DIR = REPO_ROOT / "apps" / "web" / "public" / "overlay" / "sounds"
STINGERS_DIR = OUT_DIR / "stingers"
UI_DIR = OUT_DIR / "ui"
BRAND_DIR = OUT_DIR / "brand"


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------


def n_samples(dur_s: float) -> int:
    return int(round(dur_s * SR))


def sine(freq: float, dur_s: float, phase: float = 0.0) -> np.ndarray:
    t = np.arange(n_samples(dur_s)) / SR
    return np.sin(2 * np.pi * freq * t + phase)


def saw(freq: float, dur_s: float) -> np.ndarray:
    t = np.arange(n_samples(dur_s)) / SR
    # signal.sawtooth with width=1 = rising sawtooth in [-1, 1]
    return signal.sawtooth(2 * np.pi * freq * t, width=1.0)


def square(freq: float, dur_s: float, duty: float = 0.5) -> np.ndarray:
    t = np.arange(n_samples(dur_s)) / SR
    return signal.square(2 * np.pi * freq * t, duty=duty)


def noise(dur_s: float) -> np.ndarray:
    return RNG.standard_normal(n_samples(dur_s))


def chirp_exp(f0: float, f1: float, dur_s: float) -> np.ndarray:
    t = np.arange(n_samples(dur_s)) / SR
    # Guard against f0 == f1 which breaks 'exponential' method.
    if abs(f1 - f0) < 1e-6:
        return sine(f0, dur_s)
    return signal.chirp(t, f0=f0, t1=dur_s, f1=f1, method="exponential")


def lowpass(x: np.ndarray, cutoff_hz: float, order: int = 4) -> np.ndarray:
    cutoff_hz = max(20.0, min(cutoff_hz, SR / 2 - 100.0))
    b, a = signal.butter(order, cutoff_hz / (SR / 2), btype="low")
    return signal.filtfilt(b, a, x)


def highpass(x: np.ndarray, cutoff_hz: float, order: int = 4) -> np.ndarray:
    cutoff_hz = max(20.0, min(cutoff_hz, SR / 2 - 100.0))
    b, a = signal.butter(order, cutoff_hz / (SR / 2), btype="high")
    return signal.filtfilt(b, a, x)


# ---------------------------------------------------------------------------
# Envelopes
# ---------------------------------------------------------------------------


def env_ad(n: int, attack_ms: float, decay_ms: float) -> np.ndarray:
    """Attack-decay envelope. Trailing samples are zero-filled."""
    a = min(n, int(attack_ms * SR / 1000))
    d = min(n - a, int(decay_ms * SR / 1000))
    env = np.zeros(n)
    if a > 0:
        env[:a] = np.linspace(0.0, 1.0, a)
    if d > 0:
        env[a : a + d] = np.linspace(1.0, 0.0, d)
    return env


def env_adsr(
    n: int, attack_ms: float, decay_ms: float, sustain: float, release_ms: float
) -> np.ndarray:
    a = int(attack_ms * SR / 1000)
    d = int(decay_ms * SR / 1000)
    r = int(release_ms * SR / 1000)
    # Clip so pieces fit in n.
    a = min(a, n)
    d = min(d, max(0, n - a))
    r = min(r, max(0, n - a - d))
    s = max(0, n - a - d - r)
    env = np.zeros(n)
    if a > 0:
        env[:a] = np.linspace(0.0, 1.0, a)
    if d > 0:
        env[a : a + d] = np.linspace(1.0, sustain, d)
    if s > 0:
        env[a + d : a + d + s] = sustain
    if r > 0:
        env[a + d + s : a + d + s + r] = np.linspace(sustain, 0.0, r)
    return env


def env_exp_decay(n: int, tau_s: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.exp(-t / max(tau_s, 1e-4))


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------


def mix(target: np.ndarray, src: np.ndarray, start: int, gain: float = 1.0) -> None:
    """In-place add src * gain into target starting at `start`."""
    end = min(len(target), start + len(src))
    if end <= start:
        return
    take = end - start
    target[start:end] += src[:take] * gain


def pan_stereo(mono: np.ndarray, delay_ms_r: float = 0.0) -> np.ndarray:
    """Simple stereo widening via a tiny all-pass-ish delay on the right channel."""
    if delay_ms_r <= 0:
        return np.stack([mono, mono], axis=1)
    d = int(delay_ms_r * SR / 1000)
    right = np.zeros_like(mono)
    right[d:] = mono[: len(mono) - d]
    return np.stack([mono, right], axis=1)


def reverb_exp(x: np.ndarray, length_s: float = 0.5, tau_s: float = 0.18) -> np.ndarray:
    """Cheap convolution reverb using an exponentially-decaying noise impulse."""
    n = n_samples(length_s)
    ir = RNG.standard_normal(n) * np.exp(-np.arange(n) / SR / max(tau_s, 1e-4))
    # Normalize IR to preserve energy.
    ir /= np.sqrt(np.sum(ir**2) + 1e-12)
    wet = signal.fftconvolve(x, ir, mode="full")[: len(x)]
    return wet


def save_wav(rel_path: str, mono: np.ndarray, stereo_delay_ms: float = 0.0) -> int:
    """Normalize mono, widen to stereo, write 16-bit PCM. Returns file size bytes."""
    mono = np.asarray(mono, dtype=np.float64)
    # Soft limiter: tanh to kill stray transients above 1.0 before normalizing.
    mono = np.tanh(mono * 0.9) / np.tanh(0.9)
    mx = float(np.max(np.abs(mono))) if mono.size else 0.0
    if mx > 0:
        mono = mono / mx * PEAK
    stereo = pan_stereo(mono, stereo_delay_ms)
    pcm = np.clip(stereo * 32767.0, -32768, 32767).astype(np.int16)
    full = OUT_DIR / rel_path
    full.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(full), SR, pcm)
    return full.stat().st_size


# ---------------------------------------------------------------------------
# Stinger designs
# ---------------------------------------------------------------------------


def make_intro_long() -> np.ndarray:
    """10s broadcast opener: swell → ticks → pulse → lead → impact."""
    dur = 10.0
    out = np.zeros(n_samples(dur))

    # 0-2s: rising pad (fifth interval, sqrt amplitude curve)
    pad_dur = 2.2
    pad_n = n_samples(pad_dur)
    pad_curve = np.sqrt(np.linspace(0, 1, pad_n))
    pad = (
        sine(220.0, pad_dur) * 0.6
        + sine(330.0, pad_dur) * 0.5
        + sine(110.0, pad_dur) * 0.3
    )
    pad *= pad_curve
    mix(out, pad, 0, 0.55)

    # 2-4s: filter sweep pad + hihat ticks at 8ths (120 bpm → 4Hz)
    sweep_dur = 2.0
    sweep_n = n_samples(sweep_dur)
    raw_pad = (
        saw(220.0, sweep_dur) * 0.4
        + saw(330.0, sweep_dur) * 0.35
        + saw(110.0, sweep_dur) * 0.3
    )
    # Sweep cutoff from 400Hz → 3500Hz
    cut = np.linspace(400, 3500, sweep_n)
    # Apply time-varying filter by splitting into small blocks.
    block = 1024
    filtered = np.zeros_like(raw_pad)
    for i in range(0, sweep_n, block):
        j = min(sweep_n, i + block)
        c = float(np.mean(cut[i:j]))
        filtered[i:j] = lowpass(raw_pad[i:j], c, order=4)
    mix(out, filtered * env_adsr(sweep_n, 200, 400, 0.7, 600), n_samples(2.0), 0.35)

    # 8th-note hihat ticks at 120 bpm (8 per second) from 2s to 4s
    for k in range(16):
        t = 2.0 + k * 0.125
        tick_dur = 0.05
        tick = noise(tick_dur)
        tick = highpass(tick, 5000)
        tick *= env_ad(n_samples(tick_dur), 1, 45)
        mix(out, tick, n_samples(t), 0.22)

    # 4-6s: percussion thumps at 120 bpm (every 0.5s)
    for k in range(4):
        t = 4.0 + k * 0.5
        thump = sine(60.0, 0.25)
        thump *= env_ad(n_samples(0.25), 3, 240)
        mix(out, thump, n_samples(t), 0.9)
        # sub click
        click = noise(0.02)
        click *= env_ad(n_samples(0.02), 1, 18)
        mix(out, click, n_samples(t), 0.3)

    # 6-8s: rising saw lead chirp 440 → 880 Hz
    lead_dur = 2.0
    lead = chirp_exp(440.0, 880.0, lead_dur)
    # Add a 5th above for thickness
    lead2 = chirp_exp(660.0, 1320.0, lead_dur) * 0.5
    lead_sum = lead + lead2
    lead_sum = lowpass(lead_sum, 4500)
    lead_sum *= env_adsr(n_samples(lead_dur), 80, 200, 0.75, 700)
    mix(out, lead_sum, n_samples(6.0), 0.4)

    # Sustained pad continues underneath 4-8s
    bed_dur = 4.0
    bed = sine(220.0, bed_dur) * 0.5 + sine(330.0, bed_dur) * 0.4
    bed *= env_adsr(n_samples(bed_dur), 200, 200, 0.7, 400)
    mix(out, bed, n_samples(4.0), 0.3)

    # 8-10s: big impact + noise wash + decay
    impact_dur = 2.0
    impact_n = n_samples(impact_dur)
    impact = sine(55.0, impact_dur) * 1.0 + sine(110.0, impact_dur) * 0.5
    impact *= env_ad(impact_n, 4, 1800)
    mix(out, impact, n_samples(8.0), 1.0)

    wash = noise(impact_dur)
    wash = lowpass(wash, 6000)
    wash *= env_ad(impact_n, 20, 1700)
    mix(out, wash, n_samples(8.0), 0.35)

    # Chime tail
    chime = sine(1760.0, 1.6) * 0.4 + sine(2640.0, 1.6) * 0.25
    chime *= env_ad(n_samples(1.6), 10, 1500)
    mix(out, chime, n_samples(8.2), 0.5)

    # Logo-thump underlay at the climax (8s) — quoted from the brand module logic
    thump_under = sine(60.0, 1.2) * 0.9 + sine(120.0, 1.2) * 0.5
    thump_under *= env_ad(n_samples(1.2), 80, 1100)
    thump_under = thump_under + reverb_exp(thump_under, 0.5, 0.2) * 0.35
    mix(out, thump_under, n_samples(7.95), 0.7)

    return out


def make_stinger_normal() -> np.ndarray:
    """2s: whoosh-in + impact + quick tail."""
    dur = 2.0
    out = np.zeros(n_samples(dur))

    # 0.0-0.8s whoosh: noise with exponentially-rising LP cutoff 100 → 8000 Hz
    ws_dur = 0.8
    ws_n = n_samples(ws_dur)
    w = noise(ws_dur)
    cut = np.logspace(np.log10(100), np.log10(8000), ws_n)
    block = 512
    filt = np.zeros_like(w)
    for i in range(0, ws_n, block):
        j = min(ws_n, i + block)
        c = float(np.mean(cut[i:j]))
        filt[i:j] = lowpass(w[i:j], c, order=4)
    # Rising envelope into impact
    filt *= np.linspace(0.0, 1.0, ws_n) ** 1.5
    mix(out, filt, 0, 0.55)

    # 0.8s impact
    imp_dur = 0.9
    imp_n = n_samples(imp_dur)
    impact = sine(60.0, imp_dur) * 1.0 + sine(440.0, imp_dur) * 0.35
    impact *= env_ad(imp_n, 3, 700)
    mix(out, impact, n_samples(0.8), 1.0)

    # Noise burst tail
    tail_dur = 0.3
    tail = noise(tail_dur)
    tail = highpass(tail, 1200)
    tail *= env_ad(n_samples(tail_dur), 2, 260)
    mix(out, tail, n_samples(0.85), 0.3)

    return out


def make_stinger_replay() -> np.ndarray:
    """2s: reverse-feel descending sweep with light bitcrush."""
    dur = 2.0
    out = np.zeros(n_samples(dur))

    # Descending chirp 4000 → 200 Hz
    sweep = chirp_exp(4000.0, 200.0, dur)
    # Harmonic layer for body
    sweep += chirp_exp(2000.0, 100.0, dur) * 0.5
    sweep = lowpass(sweep, 5000)
    env = env_adsr(n_samples(dur), 30, 300, 0.6, 1500)
    sweep *= env

    # Bitcrush to 8 levels (at -6 dB)
    crushed = np.round(sweep * 4) / 4
    crushed *= 0.5  # -6 dB
    mix(out, crushed, 0, 1.0)

    # Tape-style noise whoosh underlay
    und = noise(dur)
    und = lowpass(und, 2000)
    und *= env_ad(n_samples(dur), 40, 1800) * 0.3
    mix(out, und, 0, 0.25)

    return out


def make_stinger_goal() -> np.ndarray:
    """2s: sub thump + rising major triad horn + snare tail."""
    dur = 2.0
    out = np.zeros(n_samples(dur))

    # Sub impact
    imp = sine(60.0, 0.5) * 1.0 + sine(90.0, 0.5) * 0.4
    imp *= env_ad(n_samples(0.5), 3, 450)
    mix(out, imp, 0, 1.0)

    # Rising horn-chord: C (261) + E (329) + G (392). Slight pitch-up via chirp.
    chord_dur = 1.6
    chord_n = n_samples(chord_dur)
    horn = (
        (saw(261.0, chord_dur) + chirp_exp(261.0, 280.0, chord_dur)) * 0.35
        + (saw(329.0, chord_dur) + chirp_exp(329.0, 350.0, chord_dur)) * 0.3
        + (saw(392.0, chord_dur) + chirp_exp(392.0, 415.0, chord_dur)) * 0.3
    )
    horn = lowpass(horn, 3500)
    horn *= env_adsr(chord_n, 40, 200, 0.85, 900)
    mix(out, horn, n_samples(0.12), 0.6)

    # Snare-like noise burst around 0.1s in
    snare = noise(0.2)
    snare = highpass(snare, 2000)
    snare *= env_ad(n_samples(0.2), 1, 180)
    mix(out, snare, n_samples(0.08), 0.35)

    # Octave-up chime tail
    chime = sine(1047.0, 0.7) * 0.4 + sine(1568.0, 0.7) * 0.25
    chime *= env_ad(n_samples(0.7), 8, 650)
    mix(out, chime, n_samples(1.25), 0.5)

    return out


def make_stinger_winner() -> np.ndarray:
    """2s: fast major 4th-chord stab with sustain + chime tail."""
    dur = 2.0
    out = np.zeros(n_samples(dur))

    # Major chord C (261) + E (329) + G (392) + C8 (523)
    stab_dur = 1.6
    stab_n = n_samples(stab_dur)
    stab = (
        saw(261.0, stab_dur) * 0.35
        + saw(329.0, stab_dur) * 0.3
        + saw(392.0, stab_dur) * 0.3
        + saw(523.0, stab_dur) * 0.28
    )
    stab = lowpass(stab, 4500)
    stab *= env_adsr(stab_n, 10, 150, 0.8, 1100)
    mix(out, stab, 0, 0.6)

    # Sub thump
    sub = sine(55.0, 0.6) * 1.0 + sine(110.0, 0.6) * 0.5
    sub *= env_ad(n_samples(0.6), 4, 550)
    mix(out, sub, 0, 0.9)

    # Chime tail at high C (1760 ≈ A6; use 2093 for C7) — brief described 1760 Hz
    chime = sine(1760.0, 1.4) * 0.5 + sine(2637.0, 1.4) * 0.3
    chime *= env_ad(n_samples(1.4), 12, 1300)
    mix(out, chime, n_samples(0.4), 0.55)

    # Little upward chirp flourish at start
    flourish = chirp_exp(440.0, 1760.0, 0.25)
    flourish *= env_ad(n_samples(0.25), 5, 220)
    mix(out, flourish, 0, 0.4)

    return out


# ---------------------------------------------------------------------------
# UI sound designs
# ---------------------------------------------------------------------------


def make_timer_tick() -> np.ndarray:
    """0.2s — 50ms sine @ 1000 Hz; padded silence to 0.2s."""
    dur = 0.2
    out = np.zeros(n_samples(dur))
    tick = sine(1000.0, 0.05)
    tick *= env_ad(n_samples(0.05), 2, 40)
    mix(out, tick, 0, 1.0)
    # Small harmonic click
    click = sine(2000.0, 0.025) * 0.35
    click *= env_ad(n_samples(0.025), 1, 22)
    mix(out, click, 0, 0.5)
    return out


def make_timer_end() -> np.ndarray:
    """0.6s — descending 3-step chord 880 → 440 → 220 Hz."""
    dur = 0.6
    out = np.zeros(n_samples(dur))
    freqs = [880.0, 440.0, 220.0]
    step = 0.2
    for i, f in enumerate(freqs):
        s = sine(f, step)
        s *= env_ad(n_samples(step), 4, 190)
        mix(out, s, n_samples(i * step), 0.8)
    return out


def make_notification() -> np.ndarray:
    """0.4s — 2-note bell 880 → 1320 Hz, 200ms each."""
    dur = 0.4
    out = np.zeros(n_samples(dur))
    for i, f in enumerate([880.0, 1320.0]):
        bell = sine(f, 0.2) + sine(f * 2.0, 0.2) * 0.3
        bell *= env_ad(n_samples(0.2), 3, 190)
        mix(out, bell, n_samples(i * 0.2), 0.8)
    return out


def make_trigger_in() -> np.ndarray:
    """0.3s — ascending sine sweep 200 → 1500 Hz."""
    dur = 0.3
    out = np.zeros(n_samples(dur))
    sweep = chirp_exp(200.0, 1500.0, dur)
    sweep *= env_adsr(n_samples(dur), 20, 40, 0.8, 180)
    mix(out, sweep, 0, 0.9)
    # Tiny air noise layer
    air = noise(dur)
    air = highpass(air, 3000)
    air *= env_ad(n_samples(dur), 10, 260) * 0.25
    mix(out, air, 0, 0.3)
    return out


def make_trigger_out() -> np.ndarray:
    """0.3s — descending sine sweep 1500 → 200 Hz."""
    dur = 0.3
    out = np.zeros(n_samples(dur))
    sweep = chirp_exp(1500.0, 200.0, dur)
    sweep *= env_adsr(n_samples(dur), 20, 40, 0.8, 180)
    mix(out, sweep, 0, 0.9)
    air = noise(dur)
    air = highpass(air, 3000)
    air *= env_ad(n_samples(dur), 10, 260) * 0.25
    mix(out, air, 0, 0.3)
    return out


# ---------------------------------------------------------------------------
# Brand sound
# ---------------------------------------------------------------------------


def make_logo_thump() -> np.ndarray:
    """1.2s slow impact with subtle reverb tail."""
    dur = 1.2
    out = np.zeros(n_samples(dur))
    body = sine(60.0, dur) * 1.0 + sine(120.0, dur) * 0.5 + sine(40.0, dur) * 0.3
    env = env_ad(n_samples(dur), 100, 1100)
    body *= env
    # Convolution reverb (500ms IR)
    wet = reverb_exp(body, length_s=0.5, tau_s=0.18)
    mix(out, body, 0, 1.0)
    mix(out, wet, 0, 0.35)
    return out


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STINGERS_DIR.mkdir(parents=True, exist_ok=True)
    UI_DIR.mkdir(parents=True, exist_ok=True)
    BRAND_DIR.mkdir(parents=True, exist_ok=True)

    items: list[tuple[str, str, float, np.ndarray, float]] = [
        # key,           rel_path,                                       duration_ms, samples, stereo_delay_ms
        ("intro_long", "stingers/intro_long.wav", 10000.0, make_intro_long(), 6.0),
        (
            "stinger_normal",
            "stingers/stinger_normal.wav",
            2000.0,
            make_stinger_normal(),
            4.0,
        ),
        (
            "stinger_replay",
            "stingers/stinger_replay.wav",
            2000.0,
            make_stinger_replay(),
            4.0,
        ),
        (
            "stinger_goal",
            "stingers/stinger_goal.wav",
            2000.0,
            make_stinger_goal(),
            5.0,
        ),
        (
            "stinger_winner",
            "stingers/stinger_winner.wav",
            2000.0,
            make_stinger_winner(),
            5.0,
        ),
        ("timer_tick", "ui/timer_tick.wav", 200.0, make_timer_tick(), 0.0),
        ("timer_end", "ui/timer_end.wav", 600.0, make_timer_end(), 2.0),
        ("notification", "ui/notification.wav", 400.0, make_notification(), 2.0),
        ("trigger_in", "ui/trigger_in.wav", 300.0, make_trigger_in(), 3.0),
        ("trigger_out", "ui/trigger_out.wav", 300.0, make_trigger_out(), 3.0),
        ("brand_logo_thump", "brand/logo_thump.wav", 1200.0, make_logo_thump(), 3.0),
    ]

    manifest: dict = {
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "sample_rate": SR,
        "channels": 2,
        "bit_depth": 16,
        "format": "wav",
        "files": {},
    }

    total_bytes = 0
    for key, rel, duration_ms, samples, stereo_delay_ms in items:
        size = save_wav(rel, samples, stereo_delay_ms)
        total_bytes += size
        manifest["files"][key] = {
            "path": f"/overlay/sounds/{rel}".replace("\\", "/"),
            "duration_ms": int(round(duration_ms)),
            "size_kb": round(size / 1024, 2),
        }
        print(f"wrote {rel}  {size/1024:.2f} KB")

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote manifest.json")
    print(f"total: {total_bytes/1024:.2f} KB across {len(items)} files")


if __name__ == "__main__":
    main()
