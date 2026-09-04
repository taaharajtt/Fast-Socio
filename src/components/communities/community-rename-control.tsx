"use client";

import { useRouter } from "next/navigation";
import { RenameControl } from "@/components/ui/rename-control";
import { renameCommunity } from "@/app/(student)/communities/actions";
import { TITLE_RULES } from "@/lib/spaces/rename";

/**
 * The rename affordance for a society or a chat room — the community sibling of
 * `EventRenameControl`, and deliberately identical in shape.
 *
 * A thin client wrapper so `SocietyShell` / `ChatRoomShell` and the Manage tabs,
 * which are rendered from server components, can host the control without
 * becoming client components themselves.
 *
 * `router.refresh()` after a success rather than local state: the name appears
 * in the hero, in the Manage tab, in the members list header and in whatever
 * else the server render produced from it. Refreshing keeps those in step
 * instead of leaving one surface showing the old name. The server action
 * revalidates the list and chat paths for everyone else.
 */
export function CommunityRenameControl({
  communityId,
  name,
  label = "community name",
  className,
}: {
  communityId: string;
  name: string;
  /** Accessible name, e.g. "chat room name" / "society name". */
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <RenameControl
      value={name}
      label={label}
      minLength={TITLE_RULES.community.min}
      maxLength={TITLE_RULES.community.max}
      className={className}
      onSave={async (next) => {
        const res = await renameCommunity(communityId, next);
        if (!res.ok) return res;
        router.refresh();
        return { ok: true, value: res.name };
      }}
    />
  );
}
