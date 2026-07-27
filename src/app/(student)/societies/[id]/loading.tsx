import { SpaceLoadingSkeleton } from "@/components/communities/space-loading-skeleton";

/** Society: 16:9 cover, name, Broadcast/Chat/Events/Members(/Manage). */
export default function SocietyLoading() {
  return <SpaceLoadingSkeleton tabs={4} />;
}
