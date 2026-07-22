"use client";

import { useState, useTransition } from "react";
import { Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassButton, GlassInput } from "@/components/ui";
import { createSocietyAnnouncement } from "@/app/(student)/societies/actions";

/** Officer composer for a society announcement. */
export function AnnouncementComposer({ societyId }: { societyId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"public" | "members">("public");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const canPost = title.trim().length >= 2 && body.trim().length >= 1;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-[14px] bg-card p-4 text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Megaphone className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-sm font-medium text-fg-muted">
          Post an announcement…
        </span>
      </button>
    );
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await createSocietyAnnouncement(
        societyId,
        title,
        body,
        visibility
      );
      if (res.ok) {
        setTitle("");
        setBody("");
        setVisibility("public");
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-[14px] bg-card p-4">
      <GlassInput
        placeholder="Title"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 4000))}
        placeholder="What's the news? Times, deadlines, links…"
        rows={4}
        className="w-full resize-none rounded-[12px] bg-bg-elevated p-3 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
      />
      <div className="flex gap-2">
        {(["public", "members"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVisibility(v)}
            className={cn(
              "flex-1 rounded-full py-2 text-sm font-semibold transition-colors",
              visibility === v ? "gradient-brand text-white" : "bg-bg-elevated text-fg-muted"
            )}
          >
            {v === "public" ? "Everyone" : "Members only"}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex gap-2">
        <GlassButton
          variant="glass"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </GlassButton>
        <GlassButton
          size="sm"
          className="flex-1"
          onClick={submit}
          disabled={pending || !canPost}
        >
          {pending ? "Posting…" : "Post announcement"}
        </GlassButton>
      </div>
    </div>
  );
}
