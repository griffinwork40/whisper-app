#!/usr/bin/env python3
"""
Whisper transcription helper script.

Usage:
    python3 scripts/transcribe.py --audio <path> --model <hf-repo-id> [--language <lang>]

stdout on success: {"text": "..."}
stdout on failure: {"error": "..."}
exit code: 0 (success) / 1 (failure)

All mlx_whisper progress/verbose noise goes to stderr (verbose=False).
"""

import argparse
import json
import math
import sys
import wave

# RMS below this threshold (dBFS) is treated as silence and short-circuited
# before invoking Whisper. -45 dBFS is well below typical room tone (~-40)
# and well above pure-digital-silence noise floors, so it catches the
# "empty WAV → 'Thank you.' hallucination" failure mode without rejecting
# real (quiet) speech.
SILENCE_DBFS_THRESHOLD = -45.0


def wav_dbfs(path: str) -> float:
    """Compute RMS dBFS of a 16-bit PCM WAV. Returns -inf for digital silence."""
    with wave.open(path, "rb") as wf:
        n_frames = wf.getnframes()
        if n_frames == 0:
            return float("-inf")
        sampwidth = wf.getsampwidth()
        raw = wf.readframes(n_frames)
    if sampwidth != 2:
        # Unexpected format — skip the gate rather than misclassify.
        return 0.0
    # Decode int16 little-endian without numpy; the recorder writes
    # 16 kHz mono so this stays tiny even for the 60 s hard cap.
    import array
    samples = array.array("h")
    samples.frombytes(raw)
    if not samples:
        return float("-inf")
    sum_sq = 0
    for s in samples:
        sum_sq += s * s
    rms = math.sqrt(sum_sq / len(samples))
    if rms <= 0:
        return float("-inf")
    return 20.0 * math.log10(rms / 32768.0)


def main() -> None:
    try:
        import mlx_whisper  # noqa: F401 — verify importable before arg parsing

        parser = argparse.ArgumentParser(
            description="Transcribe audio using mlx_whisper"
        )
        parser.add_argument(
            "--audio",
            required=True,
            help="Path to the input WAV file",
        )
        parser.add_argument(
            "--model",
            required=True,
            help="HuggingFace repo ID for the Whisper model",
        )
        parser.add_argument(
            "--language",
            default="en",
            help="Language code (ISO 639-1) or 'auto' for auto-detection",
        )
        parser.add_argument(
            "--initial-prompt",
            default=None,
            help=(
                "Optional text passed to Whisper as initial_prompt to bias "
                "decoding toward custom vocabulary/proper nouns. Whisper "
                "truncates this to roughly its last ~220 tokens."
            ),
        )
        args = parser.parse_args()

        # Silence gate: avoid invoking Whisper on essentially-empty audio,
        # which reliably produces the "Thank you." hallucination.
        try:
            dbfs = wav_dbfs(args.audio)
        except Exception as gate_exc:
            print(f"silence-gate check skipped: {gate_exc}", file=sys.stderr)
            dbfs = 0.0
        print(f"audio RMS: {dbfs:.1f} dBFS", file=sys.stderr)
        if dbfs < SILENCE_DBFS_THRESHOLD:
            print(json.dumps({"text": ""}))
            sys.exit(0)

        result = mlx_whisper.transcribe(
            args.audio,
            path_or_hf_repo=args.model,
            language=args.language if args.language != "auto" else None,
            initial_prompt=args.initial_prompt,
            verbose=False,
        )

        text = result["text"].strip()
        print(json.dumps({"text": text}))
        sys.exit(0)

    except SystemExit as e:
        # Re-raise argparse exits without wrapping them
        raise e
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
