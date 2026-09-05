import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { UnmatchButton } from "@/components/profile/unmatch-button";
import { resolveAvatarUrl } from "@/lib/avatar";

/** One person in a matches list (fix-056). */
export type MatchListRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  gender: string | null;
  department: string | null;
  verified: boolean;
  /**
   * Present only in a FIRST-degree list. A second-degree list deliberately
   * omits it: the score between two other people is not the viewer's to see.
   */
  match_percentage?: number | null;
};

/**
 * A row leads to that person's profile, and nothing else.
 *
 * There used to be a chevron here that opened the listed person's OWN matches.
 * It is gone: a match's matches are now reached the one way that can carry the
 * owner's privacy setting with it — by opening their profile and tapping their
 * Matches stat (mig 0182). One route, one rule.
 *
 * `showUnmatch` is for YOUR list only. Someone else's list is informational:
 * no unmatch control (it isn't your relationship to end) and no Message button
 * (you haven't matched them).
 */
export function MatchRow({
  row,
  showUnmatch = false,
}: {
  row: MatchListRow;
  showUnmatch?: boolean;
}) {
  const avatar = resolveAvatarUrl(row.avatar_url, row.gender);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link
        href={`/profile/${row.id}`}
        prefetch={false}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="glass relative h-11 w-11 shrink-0 overflow-hidden rounded-full">
          {avatar && <AppImage src={avatar} alt="" sizes="44px" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-fg">
              {row.full_name ?? "Member"}
            </span>
            {typeof row.match_percentage === "number" && (
              <span className="shrink-0 rounded-full bg-aura/15 px-1.5 py-0.5 text-[10px] font-bold text-aura">
                {row.match_percentage}%
              </span>
            )}
          </span>
          {/* Roll number is the username in this app. */}
          <span className="block truncate text-xs text-fg-muted">
            {row.username ?? "—"}
            {row.department ? ` · ${row.department}` : ""}
          </span>
        </span>
      </Link>

      {showUnmatch && (
        <div className="flex shrink-0 items-center">
          <UnmatchButton otherId={row.id} name={row.full_name} />
        </div>
      )}
    </div>
  );
}
