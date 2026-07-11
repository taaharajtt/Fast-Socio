import Link from "next/link";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";
import { AppealForm } from "@/components/moderation/appeal-form";

type Strike = { level: number; reason: string; created_at: string };
type Appeal = {
  id: string;
  subject: string;
  status: string;
  created_at: string;
};

const STATUS_STYLE: Record<string, string> = {
  open: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-error/15 text-error",
};

/** The user's currently-active restriction, if any (kept out of render body). */
function activeRestrictionOf(
  suspendedUntil: string | null,
  restrictedUntil: string | null
): { label: string; until: Date } | null {
  const now = Date.now();
  if (suspendedUntil && new Date(suspendedUntil).getTime() > now)
    return { label: "Account suspended", until: new Date(suspendedUntil) };
  if (restrictedUntil && new Date(restrictedUntil).getTime() > now)
    return { label: "Posting restricted", until: new Date(restrictedUntil) };
  return null;
}

export default async function AppealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [{ data: profile }, { data: strikeRows }, { data: appealRows }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("posting_restricted_until, suspended_until")
        .eq("id", me)
        .maybeSingle(),
      supabase
        .from("user_strikes")
        .select("level, reason, created_at")
        .eq("user_id", me)
        .order("created_at", { ascending: false }),
      supabase
        .from("appeals")
        .select("id, subject, status, created_at")
        .eq("user_id", me)
        .order("created_at", { ascending: false }),
    ]);

  const strikes = (strikeRows as Strike[]) ?? [];
  const appeals = (appealRows as Appeal[]) ?? [];
  const activeRestriction = activeRestrictionOf(
    profile?.suspended_until ?? null,
    profile?.posting_restricted_until ?? null
  );

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
        <h1 className="text-xl font-extrabold tracking-tight">
          Moderation &amp; appeals
        </h1>
      </div>

      {activeRestriction && (
        <div className="mb-5 flex items-start gap-3 rounded-[var(--radius-card)] bg-warning/10 p-4 ring-1 ring-warning/30">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-fg">
              {activeRestriction.label}
            </p>
            <p className="text-xs text-fg-muted">
              Until {activeRestriction.until.toLocaleString()}. If you think this
              is a mistake, appeal below.
            </p>
          </div>
        </div>
      )}

      {strikes.length > 0 && (
        <section className="mb-5 space-y-2">
          <h2 className="text-sm font-medium text-fg-muted">Your warnings</h2>
          <div className="space-y-2">
            {strikes.map((s, i) => (
              <div
                key={i}
                className="rounded-[var(--radius-card)] bg-card p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-fg">
                    Strike {s.level}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {timeAgo(s.created_at)} ago
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{s.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mb-5">
        <AppealForm />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-fg-muted">Your appeals</h2>
        {appeals.length === 0 ? (
          <p className="rounded-[var(--radius-card)] bg-card p-5 text-sm text-fg-muted">
            No appeals filed.
          </p>
        ) : (
          <div className="space-y-2">
            {appeals.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-[var(--radius-card)] bg-card p-4"
              >
                <div>
                  <p className="text-sm font-medium capitalize text-fg">
                    {a.subject.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {timeAgo(a.created_at)} ago
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                    STATUS_STYLE[a.status] ?? "bg-card text-fg-muted"
                  }`}
                >
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
