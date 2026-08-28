import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";

export type CommunityMemberVM = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  gender: string | null;
  role: "owner" | "moderator" | "member";
};

const ROLE_LABEL: Record<CommunityMemberVM["role"], string> = {
  owner: "Owner",
  moderator: "Moderator",
  member: "Member",
};

/** Read-only member row (avatar, name, role chip) for a plain community's
 *  Members tab — the community equivalent of a society's OfficerRow. */
export function MemberRow({ member }: { member: CommunityMemberVM }) {
  const name = member.full_name ?? member.username ?? "Member";
  return (
    <Link
      href={`/profile/${member.user_id}`}
      prefetch={false}
      // Plain row, no card — matches the events attendee list. A member row
      // is a name in a roster, not a standalone object; a card behind each
      // one made a 40-person roster read as 40 stacked panels.
      className="flex items-center gap-3 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-card"
    >
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-fg-muted">
        {resolveAvatarUrl(member.avatar_url, member.gender) ? (
          <AppImage src={resolveAvatarUrl(member.avatar_url, member.gender)!} alt="" sizes="40px" />
        ) : (
          name.charAt(0).toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{name}</span>
        {member.username && (
          <span className="block truncate text-xs text-fg-muted">
            @{member.username}
          </span>
        )}
      </span>
      {member.role !== "member" && (
        <span className="type-footnote flex shrink-0 items-center gap-1 rounded-full bg-fill px-2.5 py-1 font-semibold text-fg-muted">
          {member.role === "owner" && (
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          )}
          {ROLE_LABEL[member.role]}
        </span>
      )}
    </Link>
  );
}
