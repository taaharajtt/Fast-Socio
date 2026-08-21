"use client";

import { useState } from "react";
import { MemberRow, type CommunityMemberVM } from "@/components/communities/member-row";

/** How many faces the roster preview shows before "See all members". */
const PREVIEW_COUNT = 5;

/**
 * A chat room's front page: what the room is, then who is in it.
 *
 * There is no "Open chat" button any more, and no floating replacement for it.
 * The conversation is the tab immediately to the right of this one, so a CTA
 * here would be a second control pointing at a destination already on screen.
 *
 * Members used to be their own tab. It is folded in below the description
 * instead — a roster is information about the room, not a separate place — and
 * "See all members" expands the SAME `MemberRow` list the tab rendered rather
 * than pushing a new screen.
 *
 * Sections are plain, not cards. The join gate is not repeated here either —
 * it lives on the Chat tab, which is where someone outside the room actually
 * runs into the wall.
 */
export function RoomOverviewTab({
  description,
  memberCount,
  members,
}: {
  description: string | null;
  memberCount: number;
  members: CommunityMemberVM[];
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? members : members.slice(0, PREVIEW_COUNT);
  const hasMore = members.length > PREVIEW_COUNT;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-fg">Description</h2>
        <p className="whitespace-pre-wrap text-[14px] text-fg-muted">
          {description || "No description yet."}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">
          Members · {memberCount.toLocaleString()}
        </h2>
        {members.length === 0 ? (
          <p className="text-[14px] text-fg-muted">No members yet.</p>
        ) : (
          <>
            <div className="-mx-2">
              {shown.map((m) => (
                <MemberRow key={m.user_id} member={m} />
              ))}
            </div>
            {hasMore && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="focus-ring mt-1 rounded-[10px] px-2 py-1 text-[13px] font-semibold text-accent"
              >
                {showAll
                  ? "Show fewer"
                  : `See all ${members.length.toLocaleString()} members`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
