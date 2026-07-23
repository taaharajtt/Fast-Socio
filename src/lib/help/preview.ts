import { compareSocio, type HelpUrgency } from "./logic";

/** Minimal shape the Home strip preview ranking needs from a request. */
export type HelpPreviewable = {
  urgency: HelpUrgency;
  created_at: string;
  is_mine: boolean;
};

/**
 * Pick the requests to show in the Home "Campus Help" preview strip: never your
 * own asks, urgent unresolved first, then newest — the same order SOCIO uses
 * (compareSocio) so the strip is a faithful teaser of the full feed. Pure so the
 * ranking is unit-testable without a DB. Caller is responsible for having already
 * filtered to OPEN, non-blocked/anonymity-masked rows (the DB view does that);
 * this only decides visibility of your own asks and ordering.
 */
export function pickHelpPreview<T extends HelpPreviewable>(
  rows: T[],
  limit = 3
): T[] {
  return rows
    .filter((r) => !r.is_mine)
    .sort((a, b) =>
      compareSocio(
        { urgency: a.urgency, created_at: a.created_at },
        { urgency: b.urgency, created_at: b.created_at }
      )
    )
    .slice(0, limit);
}
