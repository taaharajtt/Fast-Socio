import { RouteTabs, type RouteTab } from "@/components/ui/route-tabs";
import { SkeletonCards, SkeletonRows } from "@/components/ui/skeleton";

export type ChatTabKey = "messages" | "requests" | "community";

/**
 * The Messages · Requests · Community segmented pills (UISpec V3 Screens 10–11).
 *
 * The three panels are separate routes, so switching used to wait on a server
 * round-trip before the pill even moved. RouteTabs highlights on tap and
 * shimmers the panel until the next route renders (UAT-006).
 */
export function ChatCommunityTabs({
  active,
  requestCount = 0,
  children,
}: {
  active: ChatTabKey;
  /** Pending incoming message requests, shown as a pill badge. */
  requestCount?: number;
  children: React.ReactNode;
}) {
  const tabs: RouteTab[] = [
    { key: "messages", href: "/chat", label: "Messages" },
    {
      key: "requests",
      href: "/chat?view=requests",
      label: "Requests",
      badge: requestCount,
    },
    { key: "community", href: "/communities", label: "Community" },
  ];

  return (
    <RouteTabs
      tabs={tabs}
      activeKey={active}
      className="mt-4"
      skeletons={{
        messages: <SkeletonRows />,
        requests: <SkeletonRows count={3} />,
        community: <SkeletonCards />,
      }}
    >
      {children}
    </RouteTabs>
  );
}
