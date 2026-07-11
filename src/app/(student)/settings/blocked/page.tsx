import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BlockedList, type RelUser } from "@/components/settings/blocked-list";

export default async function BlockedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [{ data: blockedRows }, { data: mutedRows }] = await Promise.all([
    supabase
      .from("blocked_users")
      .select("blocked:profiles!blocked_users_blocked_id_fkey(id, full_name, avatar_url)")
      .eq("blocker_id", me),
    supabase
      .from("muted_users")
      .select("muted:profiles!muted_users_muted_id_fkey(id, full_name, avatar_url)")
      .eq("muter_id", me),
  ]);

  type Prof = { id: string; full_name: string | null; avatar_url: string | null };
  const toRel = (p: Prof | null): RelUser | null =>
    p ? { id: p.id, name: p.full_name, avatar: p.avatar_url } : null;

  const blocked = ((blockedRows ?? [])
    .map((r) => toRel(r.blocked as unknown as Prof | null))
    .filter(Boolean)) as RelUser[];
  const muted = ((mutedRows ?? [])
    .map((r) => toRel(r.muted as unknown as Prof | null))
    .filter(Boolean)) as RelUser[];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/settings"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight">Blocked &amp; muted</h1>
      </div>

      <BlockedList blocked={blocked} muted={muted} />
    </main>
  );
}
