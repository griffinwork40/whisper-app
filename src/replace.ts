/**
 * Applies user-configured literal find/replace rules to a finished transcript.
 *
 * This is deliberately separate from — and complementary to — the
 * `customVocabulary` prompt passed to Whisper (src/transcriber.ts):
 *   - customVocabulary *nudges* the model's decoding; it's probabilistic and
 *     may not always take effect.
 *   - Replacement rules *guarantee* an exact substitution after the fact, for
 *     words/phrases the model reliably gets wrong the same way every time.
 *
 * Matching is literal (not regex) and case-sensitive by design: config values
 * come from free-form user input in config.json, and silently interpreting
 * them as regex would turn an unescaped `.` or `(` into a footgun.
 */

import { type ReplacementRule } from './types';

/**
 * Apply each rule's literal find/replace in array order. Rules with an empty
 * `from` are ignored (a "replace everything" no-op would otherwise be a
 * correctness footgun, not a useful rule).
 */
export function applyReplacementRules(text: string, rules: ReplacementRule[]): string {
  let result = text;
  for (const rule of rules) {
    if (!rule.from) continue;
    result = result.split(rule.from).join(rule.to);
  }
  return result;
}
