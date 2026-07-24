"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Pencil, Sparkles, X as XIcon } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassButton, GlassInput, GlassSheet } from "@/components/ui";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { ConnectionCard } from "@/components/discover/connection-card";
import { DiscoverFilterChips } from "@/components/discover/discover-filter-chips";
import { PostIntentButton } from "@/components/discover/post-intent-button";
import { PostIntentForm } from "@/components/discover/post-intent-form";
import { OpenSocioSwipe } from "@/components/discover/open-socio-swipe";
import { modeMeta, type PostMode } from "@/lib/smart-match/modes";
import {
  DEFAULT_DISCOVER_FILTER,
  FILTER_META,
  DISCOVER_FILTERS,
  filterIncludesSocio,
  matchesFilter,
  type DiscoverFilter,
} from "@/lib/discover/filters";
import { buildDiscoverFeed, isExpired } from "@/lib/discover/feed";
import {
  getUnifiedDiscoverFeed,
  respondToDiscoverPost,
  cancelDiscoverResponse,
  acceptDiscoverResponse,
  declineDiscoverResponse,
  closeDiscoverPost,
  saveMySkills,
  openMatchChat,
} from "@/app/(student)/discover/discover-actions";
import type { DiscoverProfile } from "@/lib/profile/types";
import type {
  DiscoverFeedData,
  SmartMatchPost,
} from "@/lib/smart-match/types";

const PAGE_SIZE = 40;

/**
 * Discover — ONE feed. Every kind of campus opportunity plus SOCIO profile
 * cards live in the same ranked list; the chips narrow it in place and never
 * navigate, so the active chip flips on the same frame as the tap. A chip that
 * doesn't yet have much loaded quietly tops itself up from the server behind a
 * shimmer, which is the only time the feed shows a loading state.
 */
export function UnifiedDiscoverFeed({
  data,
  socioCandidates,
  now,
}: {
  data: DiscoverFeedData;
  socioCandidates: DiscoverProfile[];
  /** Render clock, taken once on the server. Keeps scoring/expiry pure across
   *  re-renders — a `Date.now()` in render would make the feed reshuffle. */
  now: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<DiscoverFilter>(DEFAULT_DISCOVER_FILTER);
  const [posts, setPosts] = useState<SmartMatchPost[]>(data.posts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [intentOpen, setIntentOpen] = useState(false);
  const [composeKind, setComposeKind] = useState<PostMode | null>(null);
  const [editing, setEditing] = useState<SmartMatchPost | null>(null);
  const [respondTo, setRespondTo] = useState<SmartMatchPost | null>(null);
  const [pending, start] = useTransition();
  /** Filters already topped up from the server — never re-fetch on every tap. */
  const toppedUp = useRef<Set<DiscoverFilter>>(new Set([DEFAULT_DISCOVER_FILTER]));

  const myPostIds = useMemo(
    () => new Map(data.myPosts.map((p) => [p.id, p.pendingCount])),
    [data.myPosts]
  );

  const items = useMemo(
    () =>
      buildDiscoverFeed({
        filter,
        viewer: data.viewer,
        posts,
        socioCandidates,
        now,
      }),
    [filter, data.viewer, posts, socioCandidates, now]
  );

  // Per-chip counts, so an empty chip is obvious before you press it.
  const counts = useMemo(() => {
    const out: Partial<Record<DiscoverFilter, number>> = {};
    for (const f of DISCOVER_FILTERS) {
      let n = posts.filter(
        (p) => matchesFilter(f, p.mode) && !isExpired(p, now)
      ).length;
      if (filterIncludesSocio(f)) n += socioCandidates.length;
      out[f] = n;
    }
    return out;
  }, [posts, socioCandidates, now]);

  const mergePosts = useCallback((incoming: SmartMatchPost[]) => {
    setPosts((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const fresh = incoming.filter((p) => !seen.has(p.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  /** Switch chips instantly; top the new filter up from the server if thin. */
  function pickFilter(next: DiscoverFilter) {
    setFilter(next);
    setExhausted(false);
    if (toppedUp.current.has(next) || next === "socio") return;
    const have = posts.filter((p) => matchesFilter(next, p.mode)).length;
    if (have >= 5) return;
    toppedUp.current.add(next);
    setLoadingFeed(true);
    void getUnifiedDiscoverFeed({ filter: next, limit: PAGE_SIZE })
      .then(mergePosts)
      .finally(() => setLoadingFeed(false));
  }

  function loadMore() {
    const visible = posts.filter((p) => matchesFilter(filter, p.mode));
    const cursor = visible.reduce<string | null>(
      (min, p) => (min == null || p.createdAt < min ? p.createdAt : min),
      null
    );
    setLoadingFeed(true);
    void getUnifiedDiscoverFeed({ filter, cursor, limit: PAGE_SIZE })
      .then((rows) => {
        if (rows.length === 0) setExhausted(true);
        mergePosts(rows);
      })
      .finally(() => setLoadingFeed(false));
  }

  function run(id: string | null, fn: () => Promise<unknown>) {
    setBusyId(id);
    start(async () => {
      await fn();
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <PostIntentButton
          open={intentOpen}
          onOpen={() => setIntentOpen(true)}
          onClose={() => setIntentOpen(false)}
          onPick={(kind) => {
            setIntentOpen(false);
            setEditing(null);
            setComposeKind(kind);
          }}
          onPickSocio={() => {
            setIntentOpen(false);
            router.push("/discover/socio");
          }}
        />
        <OpenSocioSwipe />
        <span className="flex-1" />
        <SkillsEditor initial={data.viewer.skills} />
      </div>

      <DiscoverFilterChips active={filter} counts={counts} onChange={pickFilter} />

      {data.incoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Requests to you
          </h2>
          {data.incoming.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2.5 rounded-[14px] bg-card p-3"
            >
              <Link
                href={`/profile/${a.applicantId}`}
                className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-bg-elevated"
              >
                {a.applicantAvatar && (
                  <AppImage src={a.applicantAvatar} alt="" sizes="36px" />
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {a.applicantName ?? "Student"}
                </p>
                <p className="truncate text-[11px] text-fg-muted">
                  {a.message ? a.message : `wants to join · ${a.postTitle}`}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(a.id, () => acceptDiscoverResponse(a.id))}
                aria-label="Accept"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white"
              >
                <Check className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(a.id, () => declineDiscoverResponse(a.id))}
                aria-label="Decline"
                className="glass flex h-8 w-8 items-center justify-center rounded-full text-fg-muted"
              >
                <XIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </section>
      )}

      {loadingFeed && items.length === 0 ? (
        <DiscoverFeedSkeleton />
      ) : items.length === 0 ? (
        <EmptyFeed filter={filter} />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ConnectionCard
              key={item.key}
              item={item}
              busy={pending && busyId === (item.type === "post" ? item.post.id : item.key)}
              ownPendingCount={
                item.type === "post" && myPostIds.has(item.post.id)
                  ? (myPostIds.get(item.post.id) ?? 0)
                  : null
              }
              onRespond={setRespondTo}
              onMessage={(authorId) => run(authorId, () => openMatchChat(authorId))}
              onCancel={(responseId) =>
                run(responseId, () => cancelDiscoverResponse(responseId))
              }
              onEdit={(post) => {
                setComposeKind(post.mode);
                setEditing(post);
              }}
              onClose={(postId) => run(postId, () => closeDiscoverPost(postId))}
            />
          ))}
        </div>
      )}

      {loadingFeed && items.length > 0 && <DiscoverFeedSkeleton compact />}

      {items.length > 0 && !exhausted && !loadingFeed && filter !== "socio" && (
        <button
          type="button"
          onClick={loadMore}
          className="glass w-full rounded-full py-2.5 text-sm font-semibold text-fg-muted"
        >
          Load more
        </button>
      )}

      <PostIntentForm
        kind={composeKind}
        viewer={data.viewer}
        recruitAnchors={data.recruitAnchors}
        editing={editing}
        onClose={() => {
          setComposeKind(null);
          setEditing(null);
        }}
        onSaved={() => {
          setComposeKind(null);
          setEditing(null);
          router.refresh();
        }}
      />

      <RespondComposer
        post={respondTo}
        onClose={() => setRespondTo(null)}
        onSent={() => {
          setRespondTo(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/** Shimmer cards — the only loading state the feed ever shows. */
function DiscoverFeedSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: compact ? 1 : 3 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
      {!compact && <Skeleton className="h-11 w-full rounded-full" />}
    </div>
  );
}

function EmptyFeed({ filter }: { filter: DiscoverFilter }) {
  return (
    <div className="rounded-[18px] bg-card px-5 py-10 text-center">
      <Sparkles className="mx-auto h-7 w-7 text-fg-muted" aria-hidden />
      <p className="mt-2 text-sm font-medium">
        Nothing under {FILTER_META[filter].label} yet
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        Post your own — someone on campus is looking for exactly this.
      </p>
    </div>
  );
}

/** Inline "your skills" chip editor — better matches across every kind. */
function SkillsEditor({ initial }: { initial: string[] }) {
  const [skills, setSkills] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const dirty = useMemo(
    () => skills.join("|").toLowerCase() !== initial.join("|").toLowerCase(),
    [skills, initial]
  );

  function add() {
    const t = draft.trim().replace(/,$/, "");
    if (t && !skills.some((s) => s.toLowerCase() === t.toLowerCase()) && skills.length < 30)
      setSkills([...skills, t]);
    setDraft("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit your skills"
        className="glass flex h-9 w-9 items-center justify-center rounded-full"
      >
        <Pencil className="h-4 w-4 text-aura" aria-hidden />
      </button>

      <GlassSheet open={open} onClose={() => setOpen(false)} label="Your skills">
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">Your skills</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              Only the overlap with a post is ever shown to anyone else.
            </p>
          </div>
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => (
                <span
                  key={s}
                  className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => setSkills(skills.filter((x) => x !== s))}
                    aria-label={`Remove ${s}`}
                    className="text-fg-muted hover:text-fg"
                  >
                    <XIcon className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          <GlassInput
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder="e.g. React, Figma, public speaking"
            data-no-drag
          />
          <GlassButton
            type="button"
            disabled={pending || !dirty}
            onClick={() =>
              start(async () => {
                await saveMySkills(skills);
                setOpen(false);
              })
            }
            className="w-full"
          >
            {pending ? "Saving…" : "Save"}
          </GlassButton>
        </div>
      </GlassSheet>
    </>
  );
}

/** Message composer shown when responding to a post. */
function RespondComposer({
  post,
  onClose,
  onSent,
}: {
  post: SmartMatchPost | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!post) return null;
  const cta = modeMeta(post.mode).cta;

  return (
    <GlassSheet open onClose={onClose} label={cta}>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">{cta}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">{post.title}</p>
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Add a short note (optional)…"
          data-no-drag
          className="glass w-full rounded-xl p-3 text-[15px] text-fg outline-none focus:ring-2 focus:ring-accent/30"
        />
        {error && <p className="text-sm text-error">{error}</p>}
        <GlassButton
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await respondToDiscoverPost(post.id, message);
              if (!res.ok) setError(res.error);
              else {
                setMessage("");
                onSent();
              }
            })
          }
          className="w-full"
        >
          {pending ? "Sending…" : cta}
        </GlassButton>
      </div>
    </GlassSheet>
  );
}
