"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, Zap } from "lucide-react";
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
  department: string | null;
  semester: number | null;
  course_code: string | null;
  is_anonymous: boolean;
  allow_dms: boolean;
};

/**
 * Create/edit form for a help request. One component, two modes: `initial`
 * present = editing an existing open request; absent = creating a new one with
 * the viewer's profile department/semester prefilled.
 */
export function HelpComposer({
  defaults,
  initial,
}: {
  defaults: { department: string | null; semester: number | null };
  initial?: ComposerInitial;
}) {
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
  const [department, setDepartment] = useState(
    initial?.department ?? defaults.department ?? ""
  );
  const [semester, setSemester] = useState(
    (initial?.semester ?? defaults.semester ?? "").toString()
  );
  const [courseCode, setCourseCode] = useState(initial?.course_code ?? "");
  const [anonymous, setAnonymous] = useState(initial?.is_anonymous ?? false);
  const [allowDms, setAllowDms] = useState(initial?.allow_dms ?? true);
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
      department: department.trim() || null,
      semester: semester.trim() ? Number(semester) : null,
      courseCode: courseCode.trim() || null,
      isAnonymous: anonymous,
      allowDms,
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

          {/* Single urgent toggle — pressing it flags the request as urgent so it
              gets boosted to the top of SOCIO. */}
          <button
            type="button"
            role="switch"
            aria-checked={isUrgent}
            onClick={() => setIsUrgent((v) => !v)}
            className={cn(
              "flex w-full items-center gap-3 rounded-[12px] p-3 text-left transition-colors",
              isUrgent ? "bg-error/15 ring-1 ring-error/40" : "glass"
            )}
          >
            <Zap
              className={cn("h-5 w-5 shrink-0", isUrgent ? "text-error" : "text-fg-muted")}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg">
                Mark as urgent
              </span>
              <span className="block text-xs text-fg-muted">
                Time-sensitive asks get boosted to the top of SOCIO.
              </span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                isUrgent ? "bg-error" : "bg-white/15"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                  isUrgent ? "translate-x-[22px]" : "translate-x-0.5"
                )}
              />
            </span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <label htmlFor="h-dept" className="text-sm font-medium">
                Department
              </label>
              <GlassInput
                id="h-dept"
                placeholder="e.g. CS"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="h-course" className="text-sm font-medium">
                Course
              </label>
              <GlassInput
                id="h-course"
                placeholder="e.g. CS2001"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Semester (optional)</label>
            <div className="flex flex-wrap gap-1.5">
              {["1", "2", "3", "4", "5", "6", "7", "8"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSemester(semester === s ? "" : s)}
                  className={cn(
                    "h-9 w-9 rounded-full text-sm font-medium transition-colors",
                    semester === s ? "bg-aura text-white" : "glass text-fg-muted"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Privacy toggles */}
          <div className="space-y-2">
            <ToggleRow
              label="Post anonymously"
              hint="Your name and photo stay hidden from everyone but admins."
              checked={anonymous}
              onChange={setAnonymous}
            />
            <ToggleRow
              label="Allow direct messages"
              hint="Let helpers reach you in chat about this request."
              checked={allowDms}
              onChange={setAllowDms}
            />
          </div>

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

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="glass flex w-full items-center gap-3 rounded-[12px] p-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="block text-xs text-fg-muted">{hint}</span>
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-aura" : "bg-white/15"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}
