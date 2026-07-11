/**
 * Deterministic content rule engine (Refactor Phase 9). Pure, no AI — each rule
 * contributes to a 0–100 risk score that maps to an action:
 *
 *   0–20   safe     → publish
 *   21–40  elevated → publish, flagged (reduced distribution)
 *   41–70  risky    → hold for review (hidden until a moderator approves)
 *   71–100 severe   → block (never stored)
 *
 * Text checks are self-contained; duplicate/flood are evaluated by the caller
 * (they need DB context) and folded in via `context`.
 */

export type ModerationAction = "allow" | "flag" | "hold" | "block";

export type ModerationResult = {
  score: number;
  rules: string[];
  action: ModerationAction;
};

export type ModerationContext = {
  /** The author posted identical text very recently (duplicate spam). */
  isDuplicate?: boolean;
  /** The author has posted many times in a short window (flood). */
  isFlooding?: boolean;
};

// Compact profanity/hate seed list. Deliberately small + word-boundaried to
// limit false positives; the real defense is community reporting + review.
const SEVERE_TERMS = [
  "kys",
  "faggot",
  "nigger",
  "rape",
  "retard",
];
const PROFANITY = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "slut",
  "whore",
];

const URL_RE = /https?:\/\/[^\s]+/gi;
const SHORTENER_RE = /(bit\.ly|tinyurl|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy)/i;
const MENTION_RE = /@\w+/g;
const HASHTAG_RE = /#\w+/g;

function wordHits(text: string, list: string[]): string[] {
  const hits: string[] = [];
  for (const w of list) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(text)) hits.push(w);
  }
  return hits;
}

function actionFor(score: number): ModerationAction {
  if (score >= 71) return "block";
  if (score >= 41) return "hold";
  if (score >= 21) return "flag";
  return "allow";
}

/** Score a piece of user text. `context` folds in DB-derived signals. */
export function scoreContent(
  raw: string,
  context: ModerationContext = {}
): ModerationResult {
  const text = raw ?? "";
  const rules: string[] = [];
  let score = 0;

  // Severe language → immediate block territory.
  if (wordHits(text, SEVERE_TERMS).length > 0) {
    score += 75;
    rules.push("severe_language");
  }

  // General profanity → moderate.
  const prof = wordHits(text, PROFANITY);
  if (prof.length > 0) {
    score += Math.min(30, prof.length * 15);
    rules.push("profanity");
  }

  // Links: any external link is mild; multiple links or shorteners are spammy.
  const urls = text.match(URL_RE) ?? [];
  if (urls.length >= 3) {
    score += 30;
    rules.push("many_links");
  } else if (urls.length > 0) {
    score += 8;
    rules.push("link");
  }
  if (urls.some((u) => SHORTENER_RE.test(u))) {
    score += 25;
    rules.push("shortener_link");
  }

  // Excessive mentions / hashtags → tag spam.
  const mentions = (text.match(MENTION_RE) ?? []).length;
  if (mentions > 5) {
    score += Math.min(25, (mentions - 5) * 5);
    rules.push("excessive_mentions");
  }
  const hashtags = (text.match(HASHTAG_RE) ?? []).length;
  if (hashtags > 8) {
    score += Math.min(20, (hashtags - 8) * 4);
    rules.push("excessive_hashtags");
  }

  // Shouting: mostly-caps on a reasonably long message.
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length >= 12) {
    const upper = (text.match(/[A-Z]/g) ?? []).length;
    if (upper / letters.length > 0.7) {
      score += 15;
      rules.push("shouting");
    }
  }

  // Character/word repetition ("aaaaaa", "buy buy buy buy").
  if (/(.)\1{6,}/i.test(text) || /\b(\w+)\b(?:\s+\1\b){3,}/i.test(text)) {
    score += 15;
    rules.push("repetition");
  }

  // DB-derived signals from the caller.
  if (context.isDuplicate) {
    score += 35;
    rules.push("duplicate");
  }
  if (context.isFlooding) {
    score += 25;
    rules.push("flood");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, rules, action: actionFor(score) };
}

/** User-facing message when content is blocked outright. */
export function blockMessage(result: ModerationResult): string {
  if (result.rules.includes("severe_language"))
    return "This can't be posted — it appears to contain hateful or abusive language.";
  return "This can't be posted — it was flagged by our automated safety checks.";
}
