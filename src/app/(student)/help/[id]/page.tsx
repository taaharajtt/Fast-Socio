import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, MessageSquare, Check, Zap } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { timeAgo, absoluteTime } from "@/lib/time";
import {
  CATEGORY_META,
  STATUS_META,
  HELP_MODERATOR_USERNAME,
} from "@/lib/help/constants";
import {
  resolveHelpAuthor,
  canRespond,
  canSelectHelper,
  canReplyToResponse,
  isUrgentRequest,
} from "@/lib/help/logic";
import {
  HELP_REQUEST_COLUMNS,
  HELP_RESPONSE_COLUMNS,
  type HelpRequestRow,
  type HelpResponseRow,
} from "@/lib/help/types";
import { HelpOwnerControls } from "@/components/help/help-owner-controls";
import { HelpResponseComposer } from "@/components/help/help-response-composer";
import { HelpResponseCard } from "@/components/help/help-response-card";
import { HelpRequestReportButton } from "@/components/help/help-request-report-button";

export default async function HelpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const uid = await getAuthUserId();
  if (!uid) redirect("/login");

  const supabase = await createClient();
  const [{ data: reqRow }, { data: me }] = await Promise.all([
    supabase
      .from("help_request_feed")
      .select(HELP_REQUEST_COLUMNS)
      .eq("id", id)
      .maybeSingle(),
    supabase.from("profiles").select("username").eq("id", uid).single(),
  ]);
  if (!reqRow) notFound();

  const req = reqRow as unknown as HelpRequestRow;
  const { data: respRows } = await supabase
    .from("help_response_feed")
    .select(HELP_RESPONSE_COLUMNS)
    .eq("request_id", id)
    .order("is_selected", { ascending: false })
    .order("created_at", { ascending: true });
  const responses = (respRows ?? []) as unknown as HelpResponseRow[];

  // Help moderation is scoped to the demoadmin account only (mig 0110), NOT to
  // every app admin — so other super-admins see Help exactly like a student.
  // rel.isAdmin here means "has the Help moderator override".
  const isHelpModerator = me?.username === HELP_MODERATOR_USERNAME;
  const rel = { isOwner: req.is_mine, isAdmin: isHelpModerator };
  const cat = CATEGORY_META[req.category];
  const CatIcon = cat?.icon;
  const author = resolveHelpAuthor({
    isAnonymous: req.is_anonymous,
    authorId: req.author_id,
    authorName: req.author_name,
    authorUsername: req.author_username,
    authorAvatarUrl: req.author_avatar_url,
    authorSchool: req.author_school,
    authorSemester: req.author_semester,
  });
  // School + semester come from the seeker's profile (shown even when anonymous).
  const meta = author.meta ? [author.meta] : [];

  const showComposer = canRespond(req.status, {
    signedIn: true,
    isAuthor: req.is_mine,
  });
  const viewerCanSelect = canSelectHelper(rel);
  const viewerCanReply = canReplyToResponse(uid, {
    author_id: req.author_id,
    is_mine: req.is_mine,
    status: req.status,
  });
  // Response visibility (mig 0110 filters rows at the DB): the seeker and the
  // Help moderator see the full list; a helper sees only their own row; a plain
  // viewer gets none, so we hide the section from them entirely.
  const isSeekerOrModerator = req.is_mine || isHelpModerator;
  const showResponses = isSeekerOrModerator || responses.length > 0;

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/help"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="flex-1 truncate text-lg font-bold">Request</h1>
        {!req.is_mine && <HelpRequestReportButton requestId={req.id} />}
      </div>

      <GlassCard radius="card" className="p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {req.status === "open" && isUrgentRequest(req.urgency) && (
            <span className="flex items-center gap-1 rounded-full bg-error px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
              <Zap className="h-3 w-3" aria-hidden /> Urgent
            </span>
          )}
          <GlassChip tone="neutral" className="gap-1.5">
            {CatIcon && <CatIcon className="h-3.5 w-3.5" aria-hidden />}
            {cat?.label ?? req.category}
          </GlassChip>
          <GlassChip tone={STATUS_META[req.status].tone}>
            {req.status === "resolved" ? (
              <>
                <Check className="h-3 w-3" aria-hidden /> Resolved
              </>
            ) : (
              STATUS_META[req.status].label
            )}
          </GlassChip>
        </div>

        <h2 className="mt-3 text-2xl font-bold leading-tight">{req.title}</h2>
        <p className="mt-3 whitespace-pre-wrap text-[15px] text-fg">{req.body}</p>

        {meta.length > 0 && (
          <p className="mt-3 text-sm font-medium text-cyan">{meta.join(" · ")}</p>
        )}

        {/* Author + posted time */}
        <div className="mt-4 flex items-center gap-2.5">
          <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
            {author.avatarUrl && (
              <AppImage src={author.avatarUrl} alt="" sizes="32px" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            {author.href ? (
              <Link
                href={author.href}
                className="block truncate text-sm font-semibold text-fg"
              >
                {author.name}
              </Link>
            ) : (
              <span className="block truncate text-sm font-semibold text-fg">
                {author.name}
              </span>
            )}
            <span className="text-xs text-fg-muted" title={absoluteTime(req.created_at)}>
              {timeAgo(req.created_at)} ago
              {req.is_mine && req.is_anonymous && " · only you & admins see your name"}
            </span>
          </div>
        </div>

        {isSeekerOrModerator && (
          <div className="mt-4 flex items-center gap-4 border-t border-white/[0.06] pt-3 text-sm text-fg-muted">
            <span className="flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4" aria-hidden />
              {req.response_count} response{req.response_count === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </GlassCard>

      {(req.is_mine || isHelpModerator) && (
        <HelpOwnerControls
          requestId={req.id}
          status={req.status}
          canEdit={req.is_mine && req.status === "open"}
        />
      )}

      {/* Respond (viewers & helpers on an open request that isn't theirs) */}
      {showComposer && (
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-fg">Offer help</h3>
          <HelpResponseComposer requestId={req.id} />
          <p className="mt-2 text-xs text-fg-muted">
            Only the poster can see your response.
          </p>
        </section>
      )}

      {/* Responses — the seeker's private inbox, or the helper's own response.
          Plain viewers never see this section (they receive no rows). */}
      {showResponses && (
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-fg">
            {isSeekerOrModerator
              ? `Responses (${req.response_count})`
              : "Your response"}
          </h3>
          {responses.length === 0 ? (
            <p className="glass rounded-[14px] px-4 py-6 text-center text-sm text-fg-muted">
              No responses yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {responses.map((r) => (
                <HelpResponseCard
                  key={r.id}
                  response={r}
                  requestId={req.id}
                  viewerCanSelect={viewerCanSelect}
                  viewerCanReply={viewerCanReply}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
