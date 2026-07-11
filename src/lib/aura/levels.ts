/**
 * Client mirror of the SQL level curve (mig 0055). MUST stay in lockstep with
 * public.xp_level / public.xp_for_level:
 *   cost(n→n+1) = C_BASE·n  ⇒  cumulative XP to reach level L = (C_BASE/2)·L·(L−1)
 * XP is the lifetime sum of positive Aura deltas, so level never decreases.
 */
const C_BASE = 50;

/** Cumulative XP required to *reach* a given level (level 1 = 0). */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return (C_BASE / 2) * l * (l - 1);
}

/** The level a given XP total maps to (inverse of xpForLevel). */
export function levelForXp(xp: number): number {
  return Math.max(
    1,
    Math.floor((1 + Math.sqrt(1 + (8 / C_BASE) * Math.max(xp, 0))) / 2)
  );
}

export type LevelProgress = {
  level: number;
  /** XP earned into the current level. */
  into: number;
  /** XP span of the current level (into + remaining). */
  span: number;
  /** XP still needed to reach the next level. */
  remaining: number;
  /** 0–1 progress through the current level. */
  fraction: number;
};

/** Progress of an XP total through its current level, for a progress bar. */
export function levelProgress(xp: number): LevelProgress {
  const safeXp = Math.max(0, Math.floor(xp));
  const level = levelForXp(safeXp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const into = safeXp - floor;
  return {
    level,
    into,
    span,
    remaining: Math.max(0, ceil - safeXp),
    fraction: Math.min(1, into / span),
  };
}

/**
 * Campus-flavoured title bands by level. Purely cosmetic; distinct from Aura
 * reputation labels (lib/aura/labels).
 */
export function levelTitle(level: number): string {
  if (level >= 30) return "Campus Icon";
  if (level >= 20) return "Legend";
  if (level >= 15) return "Trailblazer";
  if (level >= 10) return "Standout";
  if (level >= 6) return "Regular";
  if (level >= 3) return "Rising";
  return "Newcomer";
}
