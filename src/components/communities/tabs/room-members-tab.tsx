import { Users } from "lucide-react";
import { MemberRow, type CommunityMemberVM } from "@/components/communities/member-row";

export function RoomMembersTab({
  description,
  members,
}: {
  description: string | null;
  members: CommunityMemberVM[];
}) {
  return (
    <div className="space-y-4">
      {description && (
        <div className="rounded-[14px] bg-card p-4">
          <p className="whitespace-pre-wrap text-[14px] text-fg-muted">{description}</p>
        </div>
      )}

      {members.length === 0 ? (
        <div className="rounded-[14px] bg-card px-5 py-10 text-center">
          <Users className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-3 font-semibold text-fg">No members in this room</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <MemberRow key={m.user_id} member={m} />
          ))}
        </div>
      )}
    </div>
  );
}
