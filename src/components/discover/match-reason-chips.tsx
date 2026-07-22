import { Sparkles } from "lucide-react";
import { GlassChip } from "@/components/ui";
import type { MatchReason } from "@/lib/smart-match/types";

/** The privacy-safe "why this fits" chips on a smart-match card. */
export function MatchReasonChips({ reasons }: { reasons: MatchReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <GlassChip key={r.key} tone="aura" className="py-1">
          <Sparkles className="h-3 w-3" aria-hidden />
          {r.label}
        </GlassChip>
      ))}
    </div>
  );
}
