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
import sys


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
        args = parser.parse_args()

        result = mlx_whisper.transcribe(
            args.audio,
            path_or_hf_repo=args.model,
            language=args.language if args.language != "auto" else None,
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
