import { AppImage } from "@/components/ui/app-image";
import type { SocialProofVM } from "@/lib/communities/social-proof";

/** Overlapping face stack, sized like the department-ranking contributors. */
function AvatarStack({ people }: { people: SocialProofVM["people"] }) {
  return (
    <span className="flex shrink-0">
      {people.map((p, i) => (
        <span
          key={p.id}
          className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-bg-elevated text-[11px] font-bold text-fg-muted ring-2 ring-black/45"
          style={{ marginLeft: i === 0 ? 0 : -8, zIndex: people.length - i }}
        >
          {p.avatar_url ? (
            <AppImage src={p.avatar_url} alt="" sizes="28px" />
          ) : (
            p.name.charAt(0).toUpperCase()
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * Social proof on a space's cover photo: the faces a viewer is most likely to
 * recognise, named. "Ahmed, Sara and 15 others are in this society" persuades
 * in a way "17 members" never does — so the ranking behind `people` is by
 * closeness to the viewer (matches, then programme mates, then batchmates).
 *
 * Renders nothing when there is nobody else to name, rather than falling back
 * to a bare count the header already shows.
 */
export function SocialProof({
  proof,
  label,
}: {
  proof: SocialProofVM;
  /** Completes the sentence: "…are {label}", e.g. "in this society". */
  label: string;
}) {
  const { people, others } = proof;
  if (people.length === 0) return null;

  const named = people.map((p) => p.name);
  const who =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  const text =
    others > 0
      ? `${named.join(", ")} and ${others.toLocaleString()} other${others === 1 ? "" : "s"} are ${label}`
      : `${who} ${named.length === 1 ? "is" : "are"} ${label}`;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <AvatarStack people={people} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
        {text}
      </span>
    </span>
  );
}
