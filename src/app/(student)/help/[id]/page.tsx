import { Suspense } from "react";
import PageLoading from "./loading";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MessageSquare, Zap, VenetianMask } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
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
import { HelpAnonBadge } from "@/components/help/help-anon-badge";

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
export default function HelpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<PageLoading />}>
      <HelpDetailPageBody params={params} />
    </Suspense>
  );
}

async function HelpDetailPageBody({
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
    authorGender: req.author_gender,
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
      <PageHeader
        title="Campus Help"
        backHref="/help"
        trailing={!req.is_mine ? <HelpRequestReportButton requestId={req.id} /> : null}
      />

      {/*
        The request lives directly on the page.

        It used to sit inside a `GlassCard`, with the response composer inside a
        second card below it — a detail screen whose entire content was two
        boxes. A card's job is to say "this is one thing, distinct from the
        things around it", and on a page with exactly one subject there is
        nothing to distinguish it from. Type and space carry it instead:
        eyebrow, then a large title, then body, then the quiet metadata.
      */}
      <section className="mt-7">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {req.status === "open" && isUrgentRequest(req.urgency) && (
            <span className="type-footnote flex items-center gap-1 rounded-full bg-error px-2 py-0.5 font-bold uppercase tracking-wide text-white">
              <Zap className="h-3 w-3" aria-hidden /> Urgent
            </span>
          )}
          <span className="type-label flex items-center gap-1.5 text-fg-muted">
            {CatIcon && <CatIcon className="h-3.5 w-3.5" aria-hidden />}
            {cat?.label ?? req.category}
          </span>
          <span aria-hidden className="type-label text-fg-disabled">
            ·
          </span>
          <span
            className={cn(
              "type-label",
              req.status === "resolved" ? "text-fg-muted" : "text-success"
            )}
          >
            {req.status === "resolved" ? "Resolved" : STATUS_META[req.status].label}
          </span>
        </div>

        <h2 className="type-display mt-3">{req.title}</h2>
        <p className="type-body mt-4 whitespace-pre-wrap text-fg">{req.body}</p>

        {meta.length > 0 && (
          <p className="type-callout mt-4 text-fg-muted">{meta.join(" · ")}</p>
        )}

        {/* Author + posted time */}
        <div className="mt-5 flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-elevated">
            {author.anonymous ? (
              <VenetianMask className="h-4 w-4 text-fg-muted" aria-hidden />
            ) : (
              author.avatarUrl && (
                <AppImage src={author.avatarUrl} alt="" sizes="32px" />
              )
            )}
          </span>
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {author.href ? (
                <Link
                  href={author.href}
                  className="type-callout block truncate font-semibold text-fg"
                >
                  {author.name}
                </Link>
              ) : (
                <span className="type-callout block truncate font-semibold text-fg">
                  {author.name}
                </span>
              )}
              {req.is_anonymous && !author.anonymous && <HelpAnonBadge />}
            </span>
            <span
              className="type-caption text-fg-subtle"
              title={absoluteTime(req.created_at)}
            >
              {timeAgo(req.created_at)} ago
              {req.is_mine && req.is_anonymous && " · only you & admins see your name"}
            </span>
          </div>
          {isSeekerOrModerator && (
            <span className="type-caption flex shrink-0 items-center gap-1.5 text-fg-subtle">
              <MessageSquare className="h-4 w-4" aria-hidden />
              {req.response_count}
            </span>
          )}
        </div>
      </section>

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
            Only help seekers can see your response.
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
            <div>
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
