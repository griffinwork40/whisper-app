#!/usr/bin/env bash
# Smoke test for scripts/transcribe.py
# Requires: mlx_whisper installed, test/fixtures/hello.wav exists
#
# Run from project root:
#   bash test/transcribe.py.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FIXTURE="${PROJECT_ROOT}/test/fixtures/hello.wav"
SCRIPT="${PROJECT_ROOT}/scripts/transcribe.py"

if [[ ! -f "$FIXTURE" ]]; then
  echo "SKIP: test/fixtures/hello.wav not found. Create it with:"
  echo "  /opt/homebrew/bin/ffmpeg -f lavfi -i 'sine=frequency=440:duration=1' \\"
  echo "    -ar 16000 -ac 1 -acodec pcm_s16le test/fixtures/hello.wav"
  exit 1
fi

echo "Running transcribe.py smoke test..."

RESULT=$(python3 "$SCRIPT" \
  --audio "$FIXTURE" \
  --model "mlx-community/whisper-tiny" \
  --language "en")

echo "Raw output: $RESULT"

# Validate: must be valid JSON with a 'text' key that is a string
python3 -c "
import sys, json
d = json.loads('${RESULT}')
assert 'text' in d, f'Missing text key: {d}'
assert isinstance(d['text'], str), f'text is not a string: {d}'
# Note: pure-tone (sine wave) audio may transcribe to empty string — that is valid behavior
print(f'text value: {repr(d[\"text\"])}')
"

echo "PASS: transcribe.py smoke test"
