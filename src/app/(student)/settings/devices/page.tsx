import { headers } from "next/headers";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { deviceLabel } from "@/lib/device";
import { timeAgo } from "@/lib/time";
import { DeviceList, type DeviceRow } from "@/components/settings/device-list";

type SessionRow = {
  id: string;
  user_agent: string | null;
  ip: string | null;
  last_active_at: string;
};

export default async function DevicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: rows }, hdrs] = await Promise.all([
    supabase
      .from("user_sessions")
      .select("id, user_agent, ip, last_active_at")
      .eq("user_id", user!.id)
      .is("revoked_at", null)
      .order("last_active_at", { ascending: false }),
    headers(),
  ]);

  const sessions = (rows as SessionRow[]) ?? [];
  const currentUa = hdrs.get("user-agent");

  // record_session collapses by user-agent, so the freshest row whose UA matches
  // this request is "this device".
  const currentId =
    sessions.find((s) => (s.user_agent ?? "") === (currentUa ?? ""))?.id ?? null;

  const deviceRows: DeviceRow[] = sessions.map((s) => ({
    id: s.id,
    label: deviceLabel(s.user_agent),
    ip: s.ip,
    lastActive: `${timeAgo(s.last_active_at)} ago`,
    current: s.id === currentId,
  }));

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
        <h1 className="text-xl font-extrabold tracking-tight">Devices</h1>
      </div>

      <p className="mb-4 text-sm text-fg-muted">
        Where you&apos;re signed in. Revoking a device ends its session.
      </p>

      {deviceRows.length === 0 ? (
        <p className="rounded-[var(--radius-card)] bg-card p-6 text-center text-sm text-fg-muted">
          No active sessions on record yet.
        </p>
      ) : (
        <DeviceList sessions={deviceRows} currentId={currentId} />
      )}
    </main>
  );
}
