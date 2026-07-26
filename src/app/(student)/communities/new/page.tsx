"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui";
import { CoverUpload } from "@/components/communities/cover-upload";
import { createCommunity } from "@/app/(student)/communities/actions";
import { CATEGORY_ORDER, CATEGORY_META } from "@/lib/societies/constants";
import type { SocietyCategory } from "@/lib/societies/logic";

export default function NewCommunityPage() {
  const searchParams = useSearchParams();
  const isSociety = searchParams.get("type") === "society";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [category, setCategory] = useState<SocietyCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const canSubmit =
    name.trim().length >= 2 && (!isSociety || category != null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createCommunity({
        name,
        description,
        coverUrl,
        isSociety,
        societyCategory: category,
      });
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
        <h1 className="text-lg font-bold">
          {isSociety ? "Register a society" : "Start a chat room"}
        </h1>
      </div>

      <GlassCard className="space-y-4 p-5">
        <form onSubmit={submit} className="space-y-4">
          <CoverUpload value={coverUrl} onChange={setCoverUrl} />
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <GlassInput
              id="name"
              placeholder={isSociety ? "e.g. ACM Society" : "e.g. Batch of 2027"}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {isSociety && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_ORDER.map((c) => {
                  const Icon = CATEGORY_META[c].icon;
                  const active = category === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium transition-colors",
                        active ? "bg-accent text-white" : "bg-card text-fg-muted"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {CATEGORY_META[c].label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="desc" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder={
                isSociety ? "What does your society do?" : "What is this chat room about?"
              }
              rows={4}
              className="glass w-full resize-none rounded-[var(--radius-md)] p-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
            />
          </div>
          <p className="text-xs text-fg-muted">
            {isSociety ? "Societies" : "Chat rooms"} are reviewed by an admin
            before going live.
          </p>
          <GlassButton type="submit" size="lg" className="w-full" disabled={pending || !canSubmit}>
            {pending ? "Submitting…" : "Submit for review"}
          </GlassButton>
          {error && <p className="text-sm text-error">{error}</p>}
        </form>
      </GlassCard>
    </main>
  );
}
