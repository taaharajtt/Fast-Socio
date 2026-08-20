import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Aura, wherever it appears.
 *
 * Aura was drawn four different ways across the app: a filled gold bolt on the
 * profile, an outlined gold bolt on the leaderboard rows, an outlined grey bolt
 * on the department board, and a filled bolt again on Discover. Same number,
 * same concept, four glyphs — so the mark stopped reading as "this is Aura" and
 * started reading as "this is a lightning bolt", which is a different and much
 * weaker statement.
 *
 * It is one thing now: a FILLED bolt in Aura gold. Filled because Aura is a
 * quantity you have accumulated, and a solid mark reads as a token rather than
 * an icon; gold because that is what this app has always meant by Aura.
 *
 * `tone="inherit"` exists for the two places where the whole cluster is already
 * tinted by rank (the top-three department cards), so the bolt takes the medal
 * colour instead of fighting it — still filled, still the same silhouette.
 *
 * Do NOT reuse this for the Urgent flag on Campus Help. That bolt is a
 * different idea (time pressure) and is deliberately red.
 */
export function AuraIcon({
  className,
  tone = "gold",
}: {
  className?: string;
  /** "gold" is Aura's colour; "inherit" defers to a rank/medal tint. */
  tone?: "gold" | "inherit";
}) {
  return (
    <Zap
      aria-hidden
      className={cn(
        "shrink-0",
        tone === "gold" ? "fill-gold text-gold" : "fill-current",
        className
      )}
    />
  );
}
