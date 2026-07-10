import { PageHeader, SectionLabel } from "@/components/admin/kit";
import { MatchRow, RequestRow } from "@/components/admin/matching-rows";
import { requireSuperAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

const nf = new Intl.NumberFormat("en-US");

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-bg px-3 py-3">
      <p className="font-mono text-lg font-semibold tabular-nums text-fg">{nf.format(value)}</p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">{label}</p>
    </div>
  );
}

export default async function AdminMatchingPage() {
  await requireSuperAdmin();
  const supabase = await createClient();

  const [
    { count: matchTotal },
    { count: swipeTotal },
    { count: reqPending },
    { data: matchRows },
    { data: reqRows },
  ] = await Promise.all([
    supabase.from("matches").select("id", { count: "exact", head: true }),
    supabase.from("swipes").select("swiper_id", { count: "exact", head: true }),
    supabase.from("message_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("matches").select("id, user_low, user_high, created_at").order("created_at", { ascending: false }).limit(30),
    supabase
      .from("message_requests")
      .select("id, sender_id, recipient_id, message, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const matches = matchRows ?? [];
  const requests = reqRows ?? [];

  // Resolve all referenced names in one query.
  const ids = [
    ...new Set([
      ...matches.flatMap((m) => [m.user_low, m.user_high]),
      ...requests.flatMap((r) => [r.sender_id, r.recipient_id]),
    ]),
  ];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name ?? ""));
  }
  const nm = (id: string) => names.get(id) ?? id.slice(0, 8);

  return (
    <>
      <PageHeader title="Matching" sub="Matches, swipes and message requests. super_admin only." />

      <div className="overflow-hidden rounded-[4px] border border-glass-border">
        <div className="grid grid-cols-3 gap-px bg-glass-border">
          <Stat label="Matches" value={matchTotal ?? 0} />
          <Stat label="Swipes" value={swipeTotal ?? 0} />
          <Stat label="Requests pending" value={reqPending ?? 0} />
        </div>
      </div>

      <section className="mt-8">
        <SectionLabel>Recent matches</SectionLabel>
        <div className="mt-2 space-y-2">
          {matches.length === 0 ? (
            <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">No matches.</p>
          ) : (
            matches.map((m) => (
              <MatchRow
                key={m.id}
                match={{
                  id: m.id,
                  a: nm(m.user_low),
                  b: nm(m.user_high),
                  createdAt: `${m.created_at.slice(0, 16).replace("T", " ")} UTC`,
                }}
              />
            ))
          )}
        </div>
      </section>

      <section className="mt-8">
        <SectionLabel>Pending message requests</SectionLabel>
        <div className="mt-2 space-y-2">
          {requests.length === 0 ? (
            <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
              No pending requests.
            </p>
          ) : (
            requests.map((r) => (
              <RequestRow
                key={r.id}
                request={{
                  id: r.id,
                  sender: nm(r.sender_id),
                  recipient: nm(r.recipient_id),
                  message: r.message,
                  status: r.status,
                  createdAt: `${r.created_at.slice(0, 16).replace("T", " ")} UTC`,
                }}
              />
            ))
          )}
        </div>
      </section>
    </>
  );
}
