import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { roleLabel } from "@/lib/societies/constants";
import type { OfficerVM } from "@/lib/societies/types";

/** Read-only officer/member row (avatar, name, role chip). */
export function OfficerRow({
  officer,
  action,
}: {
  officer: OfficerVM;
  /** Optional trailing control (e.g. a manage button). */
  action?: React.ReactNode;
}) {
  const name = officer.full_name ?? officer.username ?? "Member";
  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-card p-3">
      <Link
        href={`/profile/${officer.user_id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-fg-muted">
          {officer.avatar_url ? (
            <AppImage src={officer.avatar_url} alt="" sizes="40px" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{name}</span>
          {officer.username && (
            <span className="block truncate text-xs text-fg-muted">
              @{officer.username}
            </span>
          )}
        </span>
      </Link>
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/12 px-2.5 py-1 text-[12px] font-semibold text-accent">
        {officer.role === "owner" && <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
        {officer.title?.trim() || roleLabel(officer.role)}
      </span>
      {action}
    </div>
  );
}
