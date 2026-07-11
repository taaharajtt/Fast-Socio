import Link from "next/link";
import { SectionLabel } from "@/components/admin/kit";
import { createClient } from "@/lib/supabase/server";
import { AppealDecision } from "@/components/admin/appeal-decision";

type AppealRow = {
  id: string;
  subject: string;
  explanation: string;
  status: string;
  created_at: string;
  user: { id: string; full_name: string | null } | null;
};

export default async function AdminAppealsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("appeals")
    .select(
      "id, subject, explanation, status, created_at, user:profiles!appeals_user_id_fkey(id, full_name)"
    )
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(100);

  const appeals = (data as unknown as AppealRow[]) ?? [];
  const open = appeals.filter((a) => a.status === "open");
  const decided = appeals.filter((a) => a.status !== "open");

  return (
    <>
      <Link
        href="/admin"
        className="font-mono text-[11px] uppercase tracking-wide text-fg-muted hover:text-fg"
      >
        ← Admin
      </Link>
      <h1 className="mb-4 mt-2 text-lg font-semibold tracking-tight text-fg">
        Appeals
      </h1>

      <SectionLabel>Open · {open.length}</SectionLabel>
      <div className="mt-2 space-y-2">
        {open.length === 0 ? (
          <p className="font-mono text-[11px] text-fg-muted">No open appeals.</p>
        ) : (
          open.map((a) => (
            <div key={a.id} className="rounded-[4px] border border-glass-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Link
                    href={`/admin/users/${a.user?.id ?? ""}`}
                    className="text-sm font-medium text-fg hover:underline"
                  >
                    {a.user?.full_name ?? "Unknown"}
                  </Link>
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
                    {a.subject.replace(/_/g, " ")}
                  </span>
                </div>
                <AppealDecision appealId={a.id} />
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">
                {a.explanation}
              </p>
            </div>
          ))
        )}
      </div>

      {decided.length > 0 && (
        <div className="mt-6">
          <SectionLabel>Decided</SectionLabel>
          <div className="mt-2 space-y-1.5">
            {decided.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-[4px] border border-glass-border px-3 py-2"
              >
                <span className="text-sm text-fg">
                  {a.user?.full_name ?? "Unknown"}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
                    {a.subject.replace(/_/g, " ")}
                  </span>
                </span>
                <span className="font-mono text-[11px] capitalize text-fg-muted">
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
