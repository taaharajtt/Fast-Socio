import { RouteTabs, type RouteTab } from "@/components/ui/route-tabs";
import { SkeletonRows } from "@/components/ui/skeleton";

export type ChatTabKey = "messages" | "requests";

/**
 * The Messages · Requests segmented pills (UISpec V3 Screens 10–11).
 *
 * Community moved out of Chat and onto its own dock tab, so Chat is strictly
 * 1:1 messaging. The two panels are separate routes, so switching used to wait
 * on a server round-trip before the pill even moved. RouteTabs highlights on
 * tap and shimmers the panel until the next route renders (UAT-006).
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
  ];

  return (
    <RouteTabs
      tabs={tabs}
      activeKey={active}
      variant="underline"
      className="mt-4"
      skeletons={{
        messages: <SkeletonRows />,
        requests: <SkeletonRows count={3} />,
      }}
    >
      {children}
    </RouteTabs>
  );
}
