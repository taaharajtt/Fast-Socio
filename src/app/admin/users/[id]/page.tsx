import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionLabel, Table, Th, Td, rowClass } from "@/components/admin/kit";
import { AuraAdjustForm } from "@/components/admin/aura-adjust-form";
import { BanUserButton } from "@/components/admin/ban-user-button";
import { UserAdminControls } from "@/components/admin/user-admin-controls";
import { ModerationControls } from "@/components/admin/moderation-controls";
import { BadgeControls, type AdminBadgeRow } from "@/components/admin/badge-controls";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/access";
import { auraReasonLabel } from "@/lib/aura/labels";
import { semesterLabel } from "@/lib/profile/constants";
import type { GrantableRole } from "@/app/admin/users/actions";

const nf = new Intl.NumberFormat("en-US");

function FootprintCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-bg px-3 py-2.5">
      <p className="font-mono text-base font-semibold tabular-nums text-fg">{nf.format(value)}</p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-muted">{label}</p>
    </div>
  );
}

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { isSuper } = await getAdminContext();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, department, semester, aura_score, is_banned, admin_role, verified")
    .eq("id", id)
    .single();
  if (!profile) notFound();

  // Footprint (counts only — cheap head requests) + recent ledger.
  const [
    { count: posts },
    { count: comments },
    { count: messages },
    { count: matches },
    { count: reports },
    { count: communities },
    { data: txns },
  ] = await Promise.all([
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("author_id", id),
    supabase.from("post_comments").select("id", { count: "exact", head: true }).eq("author_id", id),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("sender_id", id),
    supabase.from("matches").select("id", { count: "exact", head: true }).or(`user_low.eq.${id},user_high.eq.${id}`),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("target_type", "profile").eq("target_id", id),
    supabase.from("community_members").select("user_id", { count: "exact", head: true }).eq("user_id", id),
    supabase
      .from("aura_transactions")
      .select("id, delta, reason, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const rows = txns ?? [];
  const role = (profile.admin_role ?? null) as GrantableRole;

  // Badge catalog + this user's earned set (grant/revoke controls below).
  const [{ data: badgeCatalog }, { data: earnedBadges }] = await Promise.all([
    supabase
      .from("achievements")
      .select("code, title, description, image_url")
      .order("sort_order", { ascending: true }),
    supabase.from("user_achievements").select("code").eq("user_id", id),
  ]);
  const earnedSet = new Set((earnedBadges ?? []).map((r) => r.code));
  const badges: AdminBadgeRow[] = (badgeCatalog ?? []).map((b) => ({
    ...b,
    earned: earnedSet.has(b.code),
  }));

  // Moderation state fetched separately so the page still works before the
  // Phase 9 migrations are applied (columns/tables absent → graceful defaults).
  const [{ data: modProfile }, { count: strikeCount }] = await Promise.all([
    supabase.from("profiles").select("shadow_banned").eq("id", id).maybeSingle(),
    supabase
      .from("user_strikes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id),
  ]);
  const mod = {
    shadowBanned: Boolean(
      (modProfile as { shadow_banned?: boolean } | null)?.shadow_banned
    ),
    strikeCount: strikeCount ?? 0,
  };

  return (
    <>
      <Link
        href="/admin/users"
        className="font-mono text-[11px] uppercase tracking-wide text-fg-muted hover:text-fg"
      >
        ← Users
      </Link>

      <header className="mb-5 mt-2 border-b border-glass-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            {profile.full_name ?? "Unnamed"}
          </h1>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${profile.is_banned ? "bg-error" : "bg-success"}`} />
            {profile.is_banned ? "banned" : "active"}
          </span>
          {role && (
            <span className="rounded-[3px] border border-glass-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-muted">
              {role === "super_admin" ? "super admin" : "moderator"}
            </span>
          )}
          {profile.verified && (
            <span className="rounded-[3px] border border-verified/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-verified">
              verified
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          {profile.department ?? "—"}
          {profile.semester ? ` · ${semesterLabel(profile.semester)}` : ""}
          <span className="ml-2 font-mono text-fg-disabled">{profile.id}</span>
        </p>
      </header>

      {/* Stats */}
      <div className="overflow-hidden rounded-[4px] border border-glass-border">
        <div className="grid grid-cols-2 gap-px bg-glass-border">
          <div className="bg-bg px-3 py-3">
            <p className="font-mono text-lg font-semibold tabular-nums text-fg">{profile.aura_score}</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">Aura score</p>
          </div>
          <div className="bg-bg px-3 py-3">
            <p className="font-mono text-lg font-semibold text-fg">{profile.is_banned ? "Banned" : "Active"}</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">Status</p>
          </div>
        </div>
      </div>

      {/* Footprint */}
      <section className="mt-6">
        <SectionLabel>Footprint</SectionLabel>
        <div className="mt-2 overflow-hidden rounded-[4px] border border-glass-border">
          <div className="grid grid-cols-3 gap-px bg-glass-border sm:grid-cols-6">
            <FootprintCell label="Posts" value={posts ?? 0} />
            <FootprintCell label="Comments" value={comments ?? 0} />
            <FootprintCell label="Messages" value={messages ?? 0} />
            <FootprintCell label="Matches" value={matches ?? 0} />
            <FootprintCell label="Reports" value={reports ?? 0} />
            <FootprintCell label="Communities" value={communities ?? 0} />
          </div>
        </div>
      </section>

      {isSuper && (
        <section className="mt-6">
          <SectionLabel>Permissions · super admin · audited</SectionLabel>
          <div className="mt-2 rounded-[4px] border border-glass-border p-3">
            <UserAdminControls userId={profile.id} role={role} verified={profile.verified} />
          </div>
        </section>
      )}

      <section className="mt-6">
        <SectionLabel>Badges · audited</SectionLabel>
        <div className="mt-2 rounded-[4px] border border-glass-border p-3">
          <BadgeControls userId={profile.id} badges={badges} />
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>Adjust aura · audited</SectionLabel>
        <div className="mt-2 rounded-[4px] border border-glass-border p-3">
          <AuraAdjustForm userId={profile.id} />
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>{profile.is_banned ? "Restore access" : "Ban user"} · audited</SectionLabel>
        <div className="mt-2 rounded-[4px] border border-glass-border p-3">
          <BanUserButton userId={profile.id} isBanned={profile.is_banned} />
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>Moderation · strikes & shadow ban · audited</SectionLabel>
        <div className="mt-2 rounded-[4px] border border-glass-border p-3">
          <ModerationControls
            userId={profile.id}
            shadowBanned={mod.shadowBanned}
            strikeCount={mod.strikeCount}
          />
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>Recent transactions</SectionLabel>
        <div className="mt-2">
          <Table minWidth={420}>
            <thead>
              <tr>
                <Th>Reason</Th>
                <Th>When</Th>
                <Th className="text-right">Δ</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <Td className="text-fg-muted">No transactions.</Td>
                  <Td />
                  <Td />
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className={rowClass}>
                    <Td className="text-fg">{auraReasonLabel(t.reason)}</Td>
                    <Td className="font-mono text-xs text-fg-muted">
                      {`${t.created_at.slice(0, 16).replace("T", " ")} UTC`}
                    </Td>
                    <Td className={`text-right font-mono tabular-nums ${t.delta >= 0 ? "text-success" : "text-error"}`}>
                      {t.delta >= 0 ? "+" : ""}
                      {t.delta}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </section>
    </>
  );
}
