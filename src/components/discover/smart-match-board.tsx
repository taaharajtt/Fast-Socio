"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Sparkles, Check, X as XIcon, Pencil } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassButton, GlassInput, GlassSheet } from "@/components/ui";
import { SmartMatchCard } from "@/components/discover/smart-match-card";
import { SmartMatchForm } from "@/components/discover/smart-match-form";
import { modeMeta, type PostMode } from "@/lib/smart-match/modes";
import { scorePost } from "@/lib/smart-match/score";
import {
  expressInterest,
  cancelInterest,
  acceptInterest,
  declineInterest,
  closeSmartMatchPost,
  saveMySkills,
  openMatchChat,
} from "@/app/(student)/discover/smart-match-actions";
import type {
  DiscoverModeData,
  ScoredPost,
} from "@/lib/smart-match/types";

export function SmartMatchBoard({
  mode,
  data,
}: {
  mode: PostMode;
  data: DiscoverModeData;
}) {
  const meta = modeMeta(mode);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [applyTo, setApplyTo] = useState<ScoredPost | null>(null);

  const scored = useMemo(
    () =>
      data.posts
        .map((p) => ({ ...p, ...scorePost(mode, data.viewer, p) }) as ScoredPost)
        .sort((a, b) => b.score - a.score),
    [data.posts, data.viewer, mode]
  );

  function run(id: string | null, fn: () => Promise<unknown>) {
    setBusyId(id);
    start(async () => {
      await fn();
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-muted">{meta.tagline}</p>

      <SkillsEditor initial={data.viewer.skills} />

      <GlassButton
        type="button"
        variant="glass"
        onClick={() => setCreating(true)}
        className="w-full"
      >
        <Plus className="h-4 w-4" aria-hidden /> {meta.createLabel}
      </GlassButton>

      {/* My activity */}
      {(data.myPosts.length > 0 || data.incoming.length > 0) && (
        <section className="space-y-3">
          {data.incoming.length > 0 && (
            <div className="space-y-2">
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
                    onClick={() => run(a.id, () => acceptInterest(a.id))}
                    aria-label="Accept"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white"
                  >
                    <Check className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(a.id, () => declineInterest(a.id))}
                    aria-label="Decline"
                    className="glass flex h-8 w-8 items-center justify-center rounded-full text-fg-muted"
                  >
                    <XIcon className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}

          {data.myPosts.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Your posts
              </h2>
              {data.myPosts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-[14px] bg-card px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="text-[11px] text-fg-muted">
                      {p.status === "closed"
                        ? "Closed"
                        : p.pendingCount > 0
                          ? `${p.pendingCount} pending request${p.pendingCount === 1 ? "" : "s"}`
                          : "Open · no requests yet"}
                    </p>
                  </div>
                  {p.status === "open" && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(p.id, () => closeSmartMatchPost(p.id))}
                      className="text-xs font-medium text-fg-muted hover:text-fg"
                    >
                      Close
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Browse */}
      {scored.length === 0 ? (
        <div className="rounded-[18px] bg-card px-5 py-10 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-fg-muted" aria-hidden />
          <p className="mt-2 text-sm font-medium">Nothing here yet</p>
          <p className="mt-1 text-xs text-fg-muted">{meta.emptyLabel}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {scored.map((p) => (
            <SmartMatchCard
              key={p.id}
              post={p}
              busy={pending && busyId === p.id}
              onApply={setApplyTo}
              onMessage={(authorId) => run(p.id, () => openMatchChat(authorId))}
              onCancel={(appId) => run(p.id, () => cancelInterest(appId))}
            />
          ))}
        </div>
      )}

      <SmartMatchForm
        mode={mode}
        viewer={data.viewer}
        recruitAnchors={data.recruitAnchors}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          router.refresh();
        }}
      />

      <ApplyComposer
        post={applyTo}
        cta={meta.cta}
        onClose={() => setApplyTo(null)}
        onSent={() => {
          setApplyTo(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/** Inline "your skills" chip editor — better matches across every mode. */
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-[14px] bg-card px-3.5 py-2.5 text-left"
      >
        <Pencil className="h-4 w-4 shrink-0 text-aura" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
          {skills.length
            ? `Your skills: ${skills.slice(0, 4).join(", ")}`
            : "Add your skills for better matches"}
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-[14px] bg-card p-3.5">
      <p className="text-sm font-medium">Your skills</p>
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
        className="h-11"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full px-3 py-1.5 text-sm text-fg-muted"
        >
          Done
        </button>
        {dirty && (
          <GlassButton
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await saveMySkills(skills);
                setOpen(false);
              })
            }
          >
            Save
          </GlassButton>
        )}
      </div>
    </div>
  );
}

/** Message composer shown when applying to a post. */
function ApplyComposer({
  post,
  cta,
  onClose,
  onSent,
}: {
  post: ScoredPost | null;
  cta: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!post) return null;

  return (
    <GlassSheet open={!!post} onClose={onClose} label={cta}>
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
              const res = await expressInterest(post.id, message);
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
