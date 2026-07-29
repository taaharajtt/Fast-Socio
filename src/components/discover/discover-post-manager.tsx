"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check, Trash2, X as XIcon } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { DiscoverPostForm } from "@/components/discover/discover-post-form";
import { MODE_META, modeFormsTeam } from "@/lib/smart-match/modes";
import { INTENT_KINDS, KIND_CAPSULE, type IntentKind } from "@/lib/discover/cards";
import {
  acceptDiscoverResponse,
  declineDiscoverResponse,
  closeDiscoverPost,
  createGroupFromDiscoverPost,
  deleteDiscoverPost,
} from "@/app/(student)/discover/discover-actions";
import type { MyDiscoverData, MyIntent } from "@/lib/smart-match/types";

/**
 * /discover/post — the full page for putting yourself into Discover and
 * managing what you've already posted. This used to be a GlassSheet reachable
 * from a "+" button; it is a real page now because posting is a considered
 * action (pick a type, fill real fields, decide who's waiting on you), not a
 * quick overlay you dismiss by tapping outside it.
 */
export function DiscoverPostManager({ data }: { data: MyDiscoverData }) {
  const router = useRouter();
  const [kind, setKind] = useState<IntentKind | null>(null);
  const [editing, setEditing] = useState<MyIntent | null>(null);

  function startCreate(k: IntentKind) {
    setEditing(null);
    setKind(k);
  }

  function startEdit(post: MyIntent) {
    setEditing(post);
    setKind(post.mode as IntentKind);
  }

  function closeForm() {
    setKind(null);
    setEditing(null);
  }

  function refresh() {
    closeForm();
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-3">
      <header>
        <Link
          href="/discover"
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-white transition-colors active:scale-[0.97] hover:bg-accent/90"
        >
          ← Back to Discover
        </Link>
        <h1 className="mt-1 text-lg font-bold tracking-tight">
          Post to Discover
        </h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Pick what you need — it becomes a card in everyone&apos;s deck.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-2">
        {INTENT_KINDS.map((k) => {
          const meta = MODE_META[k];
          const active = kind === k && !editing;
          return (
            <button
              key={k}
              type="button"
              onClick={() => startCreate(k)}
              className={`flex w-full items-center gap-3 rounded-[14px] px-3.5 py-3 text-left transition-colors active:scale-[0.99] ${
                active ? "bg-accent/15 ring-1 ring-accent/40" : "bg-card"
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-elevated">
                <meta.icon className="h-4 w-4 text-aura" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {KIND_CAPSULE[k]}
                </span>
                <span className="block truncate text-[11px] text-fg-muted">
                  {meta.tagline}
                </span>
              </span>
            </button>
          );
        })}
      </section>

      {kind && (
        <DiscoverPostForm
          kind={kind}
          viewer={data.viewer}
          recruitAnchors={data.recruitAnchors}
          editing={editing}
          onClose={closeForm}
          onSaved={refresh}
        />
      )}

      {data.incoming.length > 0 && (
        <IncomingRequests data={data} onDone={() => router.refresh()} />
      )}

      {data.myPosts.length > 0 && (
        <MyPosts
          posts={data.myPosts}
          onEdit={startEdit}
          onDone={() => router.refresh()}
        />
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
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Requests to you
      </h2>
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
            <p className="truncate text-sm font-medium">
              {a.applicantName ?? "Student"}
            </p>
            <p className="truncate text-[11px] text-fg-muted">
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
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Your posts
      </h2>
      {posts.map((p) => {
        const busyNow = pending && busy === p.id;
        const confirming = confirmDeleteId === p.id;
        return (
          <div key={p.id} className="rounded-[16px] bg-card px-3.5 py-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.title}</p>
                <p className="text-[11px] text-fg-muted">
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
