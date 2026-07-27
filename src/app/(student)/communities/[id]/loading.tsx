import { SpaceLoadingSkeleton } from "@/components/communities/space-loading-skeleton";

/** Chat room: 16:9 cover, name, two tabs, then content. */
export default function CommunityDetailLoading() {
  return <SpaceLoadingSkeleton tabs={2} />;
}
