"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  SquarePen,
  Trash2,
  X as XIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { DiscoverPostForm } from "@/components/discover/discover-post-form";
import { MODE_META, modeFormsTeam } from "@/lib/smart-match/modes";
import {
  INTENT_KINDS,
  KIND_CAPSULE,
  KIND_TINT,
  type IntentKind,
  type KindTint,
} from "@/lib/discover/cards";
import {
  acceptDiscoverResponse,
  declineDiscoverResponse,
  closeDiscoverPost,
  createGroupFromDiscoverPost,
  deleteDiscoverPost,
} from "@/app/(student)/discover/discover-actions";
import type { MyDiscoverData, MyIntent } from "@/lib/smart-match/types";

/**
 * Which screen of the flow is on show. Exactly one of these renders at a time —
 * that is the whole point of the type. The grid used to stay mounted while the
 * chosen form was appended beneath it, so the page grew into one long document
 * and the "My Posts" tile could only scroll you to a section far below the
 * fold. Now the grid IS a screen, and choosing something replaces it.
 *
 * `from` is what makes back mean the right thing. A form opened from the grid
 * goes back to the grid; a form opened by tapping Edit inside My Posts goes
 * back to My Posts, because that is where you were.
 */
type View =
  | { step: "menu" }
  | { step: "posts" }
  | {
      step: "form";
      kind: IntentKind;
      editing: MyIntent | null;
      from: "menu" | "posts";
    };

/**
 * /discover/post — the full page for putting yourself into Discover and
 * managing what you've already posted. This used to be a GlassSheet reachable
 * from a "+" button; it is a real page now because posting is a considered
 * action (pick a type, fill real fields, decide who's waiting on you), not a
 * quick overlay you dismiss by tapping outside it.
 *
 * It is a DRILL-DOWN, not a scrolling document: the six-tile grid is one
 * screen, and each tile opens its own screen in place of it. See `View`.
 */
export function DiscoverPostManager({ data }: { data: MyDiscoverData }) {
  const router = useRouter();
  const [view, setView] = useState<View>({ step: "menu" });

  // Where the grid was scrolled to when we left it, so coming back does not
  // dump the reader at the top of a screen they had already scrolled through.
  const menuScroll = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevStep = useRef<View["step"]>("menu");

  function go(next: View) {
    if (view.step === "menu") menuScroll.current = window.scrollY;
    setView(next);
  }

  /**
   * The LOCAL back: it moves one level inside this flow and never leaves the
   * page. "Back to Discover" up on the menu is a different action with a
   * different destination, and the two are deliberately never shown together.
   */
  function back() {
    setView(
      view.step === "form" && view.from === "posts"
        ? { step: "posts" }
        : { step: "menu" }
    );
  }

  // Drill-down navigation is not a page load, so nothing resets the scroll
  // position or tells a screen reader the context changed. Both are done here:
  // a new screen starts at the top with focus on its heading, and returning to
  // the grid restores where you were. `preventScroll` keeps the focus call from
  // fighting the scroll that follows it.
  useLayoutEffect(() => {
    if (prevStep.current === view.step) return;
    const returning = view.step === "menu";
    prevStep.current = view.step;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: returning ? menuScroll.current : 0 });
  }, [view.step]);

  function startCreate(k: IntentKind) {
    go({ step: "form", kind: k, editing: null, from: "menu" });
  }

  function startEdit(post: MyIntent) {
    go({
      step: "form",
      kind: post.mode as IntentKind,
      editing: post,
      from: "posts",
    });
  }

  /** After a save the card exists, so show it: land on My Posts either way. */
  function refresh() {
    setView({ step: "posts" });
    router.refresh();
  }

  const myPostCount = data.myPosts.length;
  const pendingCount = data.incoming.length;

  if (view.step === "menu") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-3">
        <header>
          {/* The OUTER exit — it leaves the whole Post to Discover flow for the
              deck. Its meaning is unchanged, and it appears only on this
              screen: once you are inside a type, the back control belongs to
              the drill-down and showing both at once would make "back" a
              guess. */}
          <Link
            href="/discover"
            className="pressable focus-ring inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
            Back to Discover
          </Link>
          <h1 ref={headingRef} tabIndex={-1} className="type-display mt-4 outline-none">
            Post to Discover
          </h1>
          <p className="type-callout mt-1 text-fg-muted">
            Pick what you need — it becomes a card in everyone&apos;s deck.
          </p>
        </header>

        {/*
          Two columns, one tile per intent. A single-column list of five near
          identical rows made choosing feel like reading a settings screen; the
          grid shows every option at once and each tile carries its own colour, so
          the choice is made by shape and hue instead of by re-reading labels.
          The taglines stay — they are what tells a first-time user the difference
          between "Project Partner" and "FYP".
        */}
        <section className="grid grid-cols-2 gap-2.5">
          {INTENT_KINDS.map((k) => {
            const meta = MODE_META[k];
            return (
              <IntentTile
                key={k}
                title={KIND_CAPSULE[k]}
                tagline={meta.tagline}
                icon={meta.icon}
                tint={KIND_TINT[k]}
                onClick={() => startCreate(k)}
              />
            );
          })}
          {/*
            Sixth tile, completing the grid. Everything above CREATES a card;
            this one opens the cards you already made. It also carries the count
            of people waiting on you, because their requests moved inside this
            screen along with your posts — this tile is the only place the menu
            can still tell you someone is waiting.
          */}
          <IntentTile
            title="My Posts"
            tagline={
              pendingCount > 0
                ? `${pendingCount} request${pendingCount === 1 ? "" : "s"} waiting on you — review or close your cards.`
                : myPostCount > 0
                  ? `Review, edit, or close the ${myPostCount} card${myPostCount === 1 ? "" : "s"} you've posted.`
                  : "Nothing posted yet — pick a type above to get started."
            }
            icon={SquarePen}
            tint={{
              well: "bg-accent/12",
              icon: "text-accent",
              ring: "ring-accent/35",
            }}
            onClick={() => go({ step: "posts" })}
          />
        </section>
      </main>
    );
  }

  const heading =
    view.step === "posts"
      ? { title: "My Posts", sub: "Review, edit, or close what you've posted." }
      : {
          title: KIND_CAPSULE[view.kind],
          sub: view.editing
            ? "Editing your post."
            : MODE_META[view.kind].formTitle,
        };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-3">
      <header>
        <button
          type="button"
          onClick={back}
          className="pressable focus-ring -ml-2 inline-flex h-10 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
          {view.step === "form" && view.from === "posts"
            ? "My Posts"
            : "Post to Discover"}
        </button>
        <h1 ref={headingRef} tabIndex={-1} className="type-display mt-4 outline-none">
          {heading.title}
        </h1>
        <p className="type-callout mt-1 text-fg-muted">{heading.sub}</p>
      </header>

      {view.step === "form" ? (
        <DiscoverPostForm
          kind={view.kind}
          viewer={data.viewer}
          recruitAnchors={data.recruitAnchors}
          editing={view.editing}
          onSaved={refresh}
        />
      ) : (
        <>
          {/* Requests to you live here rather than on the menu: they are about
              the cards you have posted, and the menu is now strictly a chooser.
              The My Posts tile carries their count so nothing goes unnoticed. */}
          {pendingCount > 0 && (
            <IncomingRequests data={data} onDone={() => router.refresh()} />
          )}
          <MyPosts
            posts={data.myPosts}
            onEdit={startEdit}
            onDone={() => router.refresh()}
          />
        </>
      )}
    </main>
  );
}

/** People waiting on an answer from you. Accept opens the chat path. */
function IncomingRequests({
  data,
  onDone,
}: {
  data: MyDiscoverData;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    start(async () => {
      await fn();
      setBusy(null);
      onDone();
    });
  }

  return (
    <section className="space-y-2">
      <h2 className="type-headline text-fg">Requests to you</h2>
      {data.incoming.map((a) => (
        <div key={a.id} className="flex items-center gap-2.5 rounded-[14px] bg-card p-3">
          <Link
            href={`/profile/${a.applicantId}`}
            className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-bg-elevated"
          >
            {a.applicantAvatar && (
              <AppImage src={a.applicantAvatar} alt="" sizes="36px" />
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="type-headline truncate text-fg">
              {a.applicantName ?? "Student"}
            </p>
            <p className="type-callout truncate text-fg-muted">
              {a.message ? a.message : `wants in · ${a.postTitle}`}
            </p>
          </div>
          <button
            type="button"
            disabled={pending && busy === a.id}
            onClick={() => run(a.id, () => acceptDiscoverResponse(a.id))}
            aria-label="Accept"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white"
          >
            <Check className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            disabled={pending && busy === a.id}
            onClick={() => run(a.id, () => declineDiscoverResponse(a.id))}
            aria-label="Decline"
            className="glass flex h-8 w-8 items-center justify-center rounded-full text-fg-muted"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * Closing a post that produced a team is the one moment everyone involved is
 * known and still in the same headspace — so it's where the group chat gets
 * offered. Declining is a first-class button, not a dismissal, because plenty
 * of teams already have a room elsewhere.
 */
function CloseWithGroupDialog({
  post,
  onCancel,
  onDone,
}: {
  post: MyIntent;
  onCancel: () => void;
  onDone: (conversationId?: string) => void;
}) {
  const [name, setName] = useState(post.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const memberCount = post.teamMembers.length + 1; // + you

  function createGroup() {
    setError(null);
    start(async () => {
      const res = await createGroupFromDiscoverPost(post.id, name.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone(res.conversationId);
    });
  }

  function closeOnly() {
    setError(null);
    start(async () => {
      await closeDiscoverPost(post.id);
      onDone();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-group-title"
      onClick={onCancel}
    >
      <div
        className="glass w-full max-w-md rounded-[20px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="close-group-title" className="text-base font-bold tracking-tight">
          Create a group chat for your team?
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          {memberCount} {memberCount === 1 ? "person" : "people"} — you and
          everyone you accepted for “{post.title}”.
        </p>

        <label
          htmlFor="discover-group-name"
          className="mt-4 block text-xs font-semibold uppercase tracking-wide text-fg-muted"
        >
          Group name
        </label>
        <input
          id="discover-group-name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder={post.title}
          className="glass mt-1.5 w-full rounded-[12px] px-3.5 py-2.5 text-sm outline-none placeholder:text-fg-muted focus:ring-1 focus:ring-accent/50"
        />

        {error && <p className="mt-2 text-xs font-medium text-error">{error}</p>}

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={pending || name.trim().length < 2}
            onClick={createGroup}
            className="gradient-brand w-full rounded-full px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create Group & Close"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={closeOnly}
            className="glass w-full rounded-full px-4 py-2.5 text-sm font-semibold text-fg-muted"
          >
            Close Without Group
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="w-full px-4 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<MyIntent["status"], string> = {
  open: "Open",
  closed: "Closed",
  expired: "Expired",
  filled: "Filled",
};

/** Every one of your cards — status, requests, and full lifecycle control. */
function MyPosts({
  posts,
  onEdit,
  onDone,
}: {
  posts: MyIntent[];
  onEdit: (p: MyIntent) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [groupPost, setGroupPost] = useState<MyIntent | null>(null);
  const [pending, start] = useTransition();

  function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    start(async () => {
      await fn();
      setBusy(null);
      onDone();
    });
  }

  return (
    <section className="space-y-2">
      <h2 className="type-headline text-fg">Your posts</h2>
      {posts.length === 0 && (
        <p className="type-callout rounded-[14px] bg-card px-4 py-5 text-fg-muted">
          You haven&apos;t posted to Discover yet. Go back and pick a type — your
          card joins everyone else&apos;s deck.
        </p>
      )}
      {posts.map((p) => {
        const busyNow = pending && busy === p.id;
        const confirming = confirmDeleteId === p.id;
        return (
          <div key={p.id} className="rounded-[16px] bg-card px-3.5 py-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="type-headline truncate text-fg">{p.title}</p>
                <p className="type-callout text-fg-muted">
                  {KIND_CAPSULE[p.mode as IntentKind] ?? MODE_META[p.mode].label}
                  {" · "}
                  {STATUS_LABEL[p.status]}
                  {p.pendingCount > 0
                    ? ` · ${p.pendingCount} pending`
                    : " · no requests yet"}
                </p>
              </div>
              {!confirming && (
                <button
                  type="button"
                  disabled={busyNow}
                  aria-label="Delete"
                  onClick={() => setConfirmDeleteId(p.id)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-error/80 hover:bg-error/10 hover:text-error"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>

            {/* Actions live on their own row, each a distinct tappable
                target — "Create group" is never bundled into Close. */}
            {!confirming && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyNow}
                  onClick={() => onEdit(p)}
                  className="glass h-10 rounded-full px-4 text-xs font-semibold"
                >
                  Edit
                </button>
                {p.status === "open" && canGroup(p) && (
                  <button
                    type="button"
                    disabled={busyNow}
                    onClick={() => setGroupPost(p)}
                    className="h-10 rounded-full bg-accent px-4 text-xs font-semibold text-white transition-colors hover:bg-accent/90 active:scale-[0.97]"
                  >
                    Create group
                  </button>
                )}
                {p.status === "open" && (
                  <button
                    type="button"
                    disabled={busyNow}
                    onClick={() => run(p.id, () => closeDiscoverPost(p.id))}
                    className="h-10 rounded-full px-4 text-xs font-medium text-fg-muted hover:text-fg"
                  >
                    {busyNow ? "Closing…" : "Close"}
                  </button>
                )}
              </div>
            )}

            {/* Destructive action gets a distinct, hard-to-misfire confirm step. */}
            {confirming && (
              <div className="mt-2.5 flex items-center gap-2 rounded-[10px] bg-error/10 px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-error" aria-hidden />
                <p className="min-w-0 flex-1 text-xs font-medium text-error">
                  Delete this post for good? This can&apos;t be undone.
                </p>
                <button
                  type="button"
                  disabled={busyNow}
                  onClick={() => setConfirmDeleteId(null)}
                  className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyNow}
                  onClick={() => {
                    setConfirmDeleteId(null);
                    run(p.id, () => deleteDiscoverPost(p.id));
                  }}
                  className="shrink-0 rounded-full bg-error px-3 py-1 text-xs font-semibold text-white"
                >
                  {busyNow ? "Deleting…" : "Delete"}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {groupPost && (
        <CloseWithGroupDialog
          post={groupPost}
          onCancel={() => setGroupPost(null)}
          onDone={(conversationId) => {
            setGroupPost(null);
            if (conversationId) router.push(`/chat/c/${conversationId}`);
            else onDone();
          }}
        />
      )}
    </section>
  );
}

/** A post can form a group once it's a team-shaped mode with people on it. */
function canGroup(p: MyIntent): boolean {
  return modeFormsTeam(p.mode) && p.teamMembers.length > 0;
}

/**
 * One tile in the "what do you want to post" grid.
 *
 * The chevron is the point, and it is now literally true: a tile opens its own
 * screen. Without it a tile reads as a static description card, and the grid
 * looked like documentation rather than six things you can tap. The icon well carries a hairline in its own hue as well as a tint, which
 * is what makes each glyph read as a distinct object at a glance instead of a
 * flat coloured patch (apple.md §16 — familiarity and predictability).
 */
function IntentTile({
  title,
  tagline,
  icon: Icon,
  tint,
  onClick,
}: {
  title: string;
  tagline: string;
  icon: LucideIcon;
  tint: KindTint;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable-subtle focus-ring relative flex h-full w-full flex-col items-start gap-2.5 rounded-[14px] bg-card p-3.5 pr-7 text-left ring-1 ring-glass-border"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ring-1 ${tint.well} ${tint.ring}`}
      >
        <Icon className={`h-[22px] w-[22px] ${tint.icon}`} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="type-headline block">{title}</span>
        <span className="type-caption mt-0.5 block text-fg-muted">{tagline}</span>
      </span>
      {/* Parked on the tile's right edge, vertically centred. Inline next to the
          title it sat on the text baseline and read as punctuation rather than
          as "this opens something". */}
      <ChevronRight
        className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-disabled"
        aria-hidden
      />
    </button>
  );
}
