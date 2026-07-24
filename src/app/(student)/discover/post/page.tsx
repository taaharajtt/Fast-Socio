import Link from "next/link";
import { DiscoverPostManager } from "@/components/discover/discover-post-manager";
import { getMyDiscoverData } from "@/app/(student)/discover/discover-actions";

/**
 * /discover/post — creating and managing your own Discover cards. A proper
 * page, not a sheet: picking a type, filling real fields, and deciding who's
 * waiting on you deserves its own screen rather than an overlay you can swipe
 * away by accident.
 */
export default async function DiscoverPostPage() {
  const data = await getMyDiscoverData();

  if (!data) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3">
        <p className="rounded-[18px] bg-card px-5 py-8 text-center text-sm text-fg-muted">
          <Link href="/login" className="font-semibold text-accent">
            Sign in
          </Link>{" "}
          to post to Discover.
        </p>
      </main>
    );
  }

  return <DiscoverPostManager data={data} />;
}
