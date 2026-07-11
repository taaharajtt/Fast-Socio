"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronLeft } from "lucide-react";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createEvent } from "@/app/(student)/events/actions";
import { CoverUpload } from "@/components/communities/cover-upload";
import { EVENT_CATEGORIES } from "@/lib/events/constants";

export default function NewEventPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("Social");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [capacity, setCapacity] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createEvent({
        title,
        description,
        category,
        location,
        startsAt,
        coverUrl,
        capacity: capacity.trim() === "" ? null : Number(capacity),
      });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/events"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">Create an event</h1>
      </div>

      <GlassCard className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <CoverUpload
            value={coverUrl}
            onChange={setCoverUrl}
            label="Cover photo (optional)"
            prefix="event"
          />

          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-medium">
              Title
            </label>
            <GlassInput
              id="title"
              placeholder="e.g. AI Society Hackathon"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <div className="flex flex-wrap gap-2">
              {EVENT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm transition-colors",
                    category === cat
                      ? "bg-aura text-white"
                      : "glass text-fg-muted"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="starts" className="text-sm font-medium">
              Starts
            </label>
            <GlassInput
              id="starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="loc" className="text-sm font-medium">
              Location
            </label>
            <GlassInput
              id="loc"
              placeholder="e.g. C-Block Auditorium"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="cap" className="text-sm font-medium">
              Capacity (optional)
            </label>
            <GlassInput
              id="cap"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="Leave blank for unlimited"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <p className="text-xs text-fg-muted">
              When full, new sign-ups join a waitlist and are promoted
              automatically as seats open.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="desc" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
              placeholder="What's happening?"
              rows={4}
              className="glass w-full resize-none rounded-[var(--radius-md)] p-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
            />
          </div>

          <p className="text-xs text-fg-muted">
            Events are reviewed by an admin before going live.
          </p>
          <GlassButton
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || title.trim().length < 2 || !startsAt}
          >
            {pending ? "Submitting…" : "Submit for review"}
          </GlassButton>
          {error && <p className="text-sm text-error">{error}</p>}
        </form>
      </GlassCard>
    </main>
  );
}
