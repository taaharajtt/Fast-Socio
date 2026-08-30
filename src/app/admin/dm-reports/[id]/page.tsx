import { Suspense } from "react";
import AdminLoading from "@/app/admin/loading";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, SectionLabel, Tag } from "@/components/admin/kit";
import { CaseControls } from "@/components/admin/dm-case-controls";
import { EvidenceRow } from "@/components/admin/dm-evidence-row";
import { getAdminContext } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import { chatMediaPath, CHAT_MEDIA_TTL_SECONDS } from "@/lib/chat-media";
import { presignDownload } from "@/lib/s3/sign";

/**
 * Report-scoped evidence page — the replacement for the DM transcript viewer.
 *
 * What is NOT on this page, deliberately: any link, button or parameter that
 * widens the view to the rest of the conversation. The RPC below is keyed on a
 * report id, not a conversation id, and there is no conversation-scoped read
 * left in the admin surface at all. The conversation id is shown truncated,
 * for correlating two cases about the same thread, and is not a link.
 *
 * Opening this page calls `admin_dm_report_detail`, which writes a
 * `dm_report.view_evidence` audit row before it returns anything. That is why
 * the fetch is not cached and not deduped across a refresh: each view is a
 * disclosure and each disclosure is recorded.
 */

export type Evidence = {
  id: string;
  source_message_id: string | null;
  sender_id: string;
  sender_name: string;
  recipient_id: string;
  recipient_name: string;
  original_created_at: string;
  body: string | null;
  attachment_path: string | null;
  attachment_type: "image" | "voice" | null;
  shared_post_id: string | null;
  evidence_source: string;
  evidence_order: number;
  source_hidden: boolean | null;
};

type CaseDetail = {
  case: {
    id: string;
    category: string;
    description: string;
    status: "pending" | "reviewing" | "actioned" | "dismissed";
    evidence_count: number;
    protocol_version: number;
    created_at: string;
    updated_at: string;
    conversation_id: string;
    reporter_id: string;
    reporter_name: string;
    reported_user_id: string;
    reported_name: string;
    assigned_to: string | null;
    assigned_name: string | null;
  };
  evidence: Evidence[];
  history: {
    id: string;
    action: string;
    actor_id: string | null;
    actor_name: string;
    reason: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }[];
};

/**
 * PERF/CORRECTNESS (perf audit Phase 4) — this default export is deliberately
 * NOT async and never awaits `params`/`searchParams`. Under Cache Components,
 * reading request data (or calling `notFound()`) at the top level makes the
 * route dynamic while Next is still building its fallback shell; resuming that
 * shell then throws
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided        (E592)
 *
 * which surfaces as a 500. The request-scoped work lives in the async body
 * below, behind a Suspense boundary. Same shape as /post/[id], which hit this
 * exact bug first and documents it.
 */
export default function DmCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <DmCasePageBody params={params} />
    </Suspense>
  );
}

async function DmCasePageBody({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAdminContext();
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("admin_dm_report_detail", {
    p_report_id: id,
  });
  if (error || !data) notFound();
  const detail = data as CaseDetail;
  const c = detail.case;

  // Sign only the attachments that are actually evidence in THIS case. A
  // conversation's other attachments are unreachable from here because their
  // paths never appear on this page.
  const signed: Record<string, string> = {};
  for (const e of detail.evidence) {
    if (!e.attachment_path) continue;
    const path = chatMediaPath(e.attachment_path);
    if (!path) continue;
    signed[e.id] = presignDownload("chat-media", path, CHAT_MEDIA_TTL_SECONDS);
  }

  return (
    <>
      <Link
        href="/admin/dm-reports"
        className="font-mono text-[11px] uppercase tracking-wide text-fg-muted hover:text-fg"
      >
        ← DM reports
      </Link>

      <PageHeader
        title="DM report"
        sub={`Case ${c.id.slice(0, 8)} · viewing this page is audited.`}
      />

      {/* Case metadata */}
      <section className="mb-5 space-y-2 rounded-[4px] border border-glass-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{c.category}</Tag>
          <Tag>{c.status}</Tag>
          <span className="font-mono text-[11px] text-fg-muted">
            {c.evidence_count} message{c.evidence_count === 1 ? "" : "s"} disclosed
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-fg-muted">Reported</dt>
            <dd>
              <Link
                href={`/admin/users/${c.reported_user_id}`}
                className="underline hover:text-fg"
              >
                {c.reported_name}
              </Link>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">Reporter</dt>
            <dd>
              <Link
                href={`/admin/users/${c.reporter_id}`}
                className="underline hover:text-fg"
              >
                {c.reporter_name}
              </Link>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">Filed</dt>
            <dd className="font-mono">
              {c.created_at.slice(0, 16).replace("T", " ")} UTC
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">Conversation</dt>
            {/* Not a link. There is nothing to navigate to. */}
            <dd className="font-mono">{c.conversation_id.slice(0, 8)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">Assigned</dt>
            <dd>{c.assigned_name ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* Reporter's description */}
      <section className="mb-5">
        <SectionLabel>Reporter&rsquo;s description</SectionLabel>
        <p className="mt-2 whitespace-pre-wrap break-words rounded-[4px] border border-glass-border p-4 text-sm text-fg">
          {c.description}
        </p>
      </section>

      {/* Evidence */}
      <section className="mb-5">
        <SectionLabel>Disclosed messages</SectionLabel>
        <p className="mb-2 mt-2 text-xs text-fg-muted">
          These are the only messages the reporter chose to share. The rest of
          this conversation is not accessible from the admin console.
        </p>
        <div className="space-y-2">
          {detail.evidence.map((e) => (
            <EvidenceRow
              key={e.id}
              reportId={c.id}
              evidence={e}
              signedUrl={signed[e.id] ?? null}
            />
          ))}
        </div>
      </section>

      {/* Actions */}
      <section className="mb-5">
        <SectionLabel>Case actions</SectionLabel>
        <CaseControls
          reportId={c.id}
          status={c.status}
          assignedToMe={c.assigned_to === ctx.userId}
          reportedUserId={c.reported_user_id}
        />
      </section>

      {/* History */}
      <section>
        <SectionLabel>Case history</SectionLabel>
        <ul className="mt-2 space-y-1.5">
          {detail.history.length === 0 ? (
            <li className="text-xs text-fg-muted">No entries.</li>
          ) : (
            detail.history.map((h) => (
              <li
                key={h.id}
                className="rounded-[4px] border border-glass-border px-3 py-2 text-xs"
              >
                <p className="font-mono text-[11px] text-fg-muted">
                  {h.created_at.slice(0, 16).replace("T", " ")} UTC ·{" "}
                  {h.actor_name}
                </p>
                <p className="mt-0.5 text-fg">{h.action}</p>
                {h.reason && (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-fg-muted">
                    {h.reason}
                  </p>
                )}
              </li>
            ))
          )}
        </ul>
      </section>
    </>
  );
}
