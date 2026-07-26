import { UserCheck } from "lucide-react";
import { AttendeeList, type Attendee } from "@/components/events/attendee-list";

export function EventMembersTab({ attendees }: { attendees: Attendee[] }) {
  if (attendees.length === 0) {
    return (
      <div className="rounded-[14px] bg-card px-5 py-10 text-center">
        <UserCheck className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
        <p className="mt-3 font-semibold text-fg">No attendees registered yet</p>
      </div>
    );
  }

  return <AttendeeList attendees={attendees} />;
}
