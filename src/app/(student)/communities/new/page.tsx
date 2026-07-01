"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronLeft } from "lucide-react";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui";
import { createCommunity } from "@/app/(student)/communities/actions";

export default function NewCommunityPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createCommunity({ name, description });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/communities"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">Start a community</h1>
      </div>

      <GlassCard className="space-y-4 p-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <GlassInput
              id="name"
              placeholder="e.g. ACM Society, Batch of 2027"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="desc" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder="What is this community about?"
              rows={4}
              className="glass w-full resize-none rounded-[var(--radius-md)] p-4 text-[15px] text-fg outline-none placeholder:text-fg-muted/70 focus:ring-2 focus:ring-aura/40"
            />
          </div>
          <p className="text-xs text-fg-muted">
            Communities are reviewed by an admin before going live.
          </p>
          <GlassButton
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || name.trim().length < 2}
          >
            {pending ? "Submitting…" : "Submit for review"}
          </GlassButton>
          {error && <p className="text-sm text-error">{error}</p>}
        </form>
      </GlassCard>
    </main>
  );
}
