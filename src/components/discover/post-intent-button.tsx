"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Plus, X as XIcon } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassSheet } from "@/components/ui";
import { PostIntentForm } from "@/components/discover/post-intent-form";
import { MODE_META } from "@/lib/smart-match/modes";
import { INTENT_KINDS, KIND_CAPSULE, type IntentKind } from "@/lib/discover/cards";
import {
  acceptDiscoverResponse,
  declineDiscoverResponse,
  closeDiscoverPost,
} from "@/app/(student)/discover/discover-actions";
import type { MyDiscoverData, MyIntent } from "@/lib/smart-match/types";

/**
 * The only control on Discover besides the deck itself: post yourself into it.
 *
 * Tapping it asks WHAT you need first, then opens that kind's short form —
 * never one giant form. The same sheet is where you manage what you've already
 * posted, because your own cards never appear in your own deck; putting "My
 * posts" behind this button keeps Discover itself a pure swipe surface.
 */
export function PostIntentButton({ data }: { data: MyDiscoverData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<IntentKind | null>(null);
  const [editing, setEditing] = useState<MyIntent | null>(null);

  const openPosts = data.myPosts.filter((p) => p.status === "open");
  const pending = data.incoming.length;

  function close() {
    setOpen(false);
    setKind(null);
    setEditing(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-sm font-semibold text-white active:scale-95"
      >
        <Plus className="h-4 w-4" aria-hidden /> Post
        {pending > 0 && (
          <span
            aria-label={`${pending} pending requests`}
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[11px] font-bold text-white"
          >
            {pending}
          </span>
        )}
      </button>

      <GlassSheet
        open={open && kind === null}
        onClose={close}
        label="Post to Discover"
      >
        <div className="max-h-[75vh] space-y-4 overflow-y-auto" data-sheet-scroll>
          <div>
            <h2 className="text-lg font-bold">What do you need?</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              It becomes a card in everyone&apos;s Discover deck.
            </p>
          </div>

          <div className="space-y-2">
            {INTENT_KINDS.map((k) => {
              const meta = MODE_META[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setKind(k);
                  }}
                  className="flex w-full items-center gap-3 rounded-[14px] bg-card px-3.5 py-3 text-left active:scale-[0.99]"
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
          </div>

          {data.incoming.length > 0 && (
            <IncomingRequests data={data} onDone={() => router.refresh()} />
          )}

          {openPosts.length > 0 && (
            <MyPosts
              posts={openPosts}
              onEdit={(p) => {
                setEditing(p);
                setKind(p.mode as IntentKind);
              }}
              onDone={() => router.refresh()}
            />
          )}
        </div>
      </GlassSheet>

      <PostIntentForm
        kind={kind}
        viewer={data.viewer}
        recruitAnchors={data.recruitAnchors}
        editing={editing}
        onClose={close}
        onSaved={() => {
          close();
          router.refresh();
        }}
      />
    </>
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Requests to you
      </h3>
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

/** Your live cards — edit them or take them down. */
function MyPosts({
  posts,
  onEdit,
  onDone,
}: {
  posts: MyIntent[];
  onEdit: (p: MyIntent) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Your posts
      </h3>
      {posts.map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-2 rounded-[14px] bg-card px-3.5 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.title}</p>
            <p className="text-[11px] text-fg-muted">
              {KIND_CAPSULE[p.mode as IntentKind] ?? MODE_META[p.mode].label}
              {p.pendingCount > 0
                ? ` · ${p.pendingCount} pending`
                : " · no requests yet"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onEdit(p)}
            className="glass rounded-full px-3 py-1.5 text-xs font-semibold"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={pending && busy === p.id}
            onClick={() => {
              setBusy(p.id);
              start(async () => {
                await closeDiscoverPost(p.id);
                setBusy(null);
                onDone();
              });
            }}
            className="rounded-full px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
          >
            Close
          </button>
        </div>
      ))}
    </section>
  );
}
