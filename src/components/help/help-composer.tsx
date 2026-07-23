"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, Zap, EyeOff } from "lucide-react";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CATEGORY_ORDER, CATEGORY_META } from "@/lib/help/constants";
import {
  isUrgentRequest,
  type HelpCategory,
  type HelpUrgency,
} from "@/lib/help/logic";
import {
  createHelpRequest,
  updateHelpRequest,
  type CreateHelpInput,
} from "@/app/(student)/help/actions";

export type ComposerInitial = {
  id: string;
  title: string;
  body: string;
  category: HelpCategory;
  urgency: HelpUrgency;
  is_anonymous: boolean;
};

/**
 * Create/edit form for a help request. One component, two modes: `initial`
 * present = editing an existing open request; absent = creating a new one.
 *
 * The form collects only title, body, category, and two capsule toggles (urgent
 * / anonymous). Semester, school/department and course are NOT collected — they
 * are shown from the seeker's profile at read time — so there is nothing here to
 * edit for those.
 */
export function HelpComposer({ initial }: { initial?: ComposerInitial }) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [category, setCategory] = useState<HelpCategory | null>(
    initial?.category ?? null
  );
  const [isUrgent, setIsUrgent] = useState(
    initial ? isUrgentRequest(initial.urgency) : false
  );
  const [anonymous, setAnonymous] = useState(initial?.is_anonymous ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const canSubmit = title.trim().length >= 4 && body.trim().length >= 10 && category;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) {
      setError("Pick a category.");
      return;
    }
    setError(null);
    const payload: CreateHelpInput = {
      title,
      body,
      category,
      isUrgent,
      isAnonymous: anonymous,
    };
    start(async () => {
      if (editing && initial) {
        const res = await updateHelpRequest(initial.id, payload);
        if (!res.ok) setError(res.error);
        else router.push(`/help/${initial.id}`);
      } else {
        const res = await createHelpRequest(payload);
        // Success path redirects server-side; only errors return here.
        if (res?.error) setError(res.error);
      }
    });
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={editing && initial ? `/help/${initial.id}` : "/help"}
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">
          {editing ? "Edit request" : "Ask for help"}
        </h1>
      </div>

      <GlassCard className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              What do you need help with?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORY_ORDER.map((c) => {
                const meta = CATEGORY_META[c];
                const Icon = meta.icon;
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(
                      "flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-sm font-medium transition-colors",
                      active
                        ? "bg-aura text-white"
                        : "glass text-fg-muted hover:text-fg"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{meta.short}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="h-title" className="text-sm font-medium">
              Title
            </label>
            <GlassInput
              id="h-title"
              placeholder="e.g. Need OOP past papers before Friday"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="h-body" className="text-sm font-medium">
              Details
            </label>
            <textarea
              id="h-body"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 2000))}
              placeholder="Add the specifics — course, deadline, what you've tried…"
              rows={4}
              className="glass w-full resize-none rounded-[var(--radius-md)] p-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
            />
          </div>

          {/* Compact capsule toggles: urgent (boosts to top of SOCIO) and
              anonymous (hides your name/photo; only school + semester show). */}
          <div className="flex flex-wrap gap-2">
            <CapsuleToggle
              active={isUrgent}
              onClick={() => setIsUrgent((v) => !v)}
              icon={<Zap className="h-4 w-4" aria-hidden />}
              label="Urgent"
              activeClass="bg-error text-white"
            />
            <CapsuleToggle
              active={anonymous}
              onClick={() => setAnonymous((v) => !v)}
              icon={<EyeOff className="h-4 w-4" aria-hidden />}
              label="Anonymous"
              activeClass="bg-aura text-white"
            />
          </div>
          <p className="text-xs text-fg-muted">
            {anonymous
              ? "Only your school and semester will show. Your name and photo stay hidden."
              : "Your name and photo will be shown on this request."}
          </p>

          <GlassButton
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || !canSubmit}
          >
            {pending
              ? "Posting…"
              : editing
                ? "Save changes"
                : "Post request"}
          </GlassButton>
          {error && <p className="text-sm text-error">{error}</p>}
        </form>
      </GlassCard>
    </main>
  );
}

/** A small pill-shaped toggle button with a clear active state. */
function CapsuleToggle({
  active,
  onClick,
  icon,
  label,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-all active:scale-95",
        active ? activeClass : "glass text-fg-muted hover:text-fg"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
