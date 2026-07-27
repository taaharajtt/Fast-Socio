import { SpaceLoadingSkeleton } from "@/components/communities/space-loading-skeleton";

/** Event: 16:9 cover, title, Overview/Members. */
export default function EventDetailLoading() {
  return <SpaceLoadingSkeleton tabs={2} />;
}
