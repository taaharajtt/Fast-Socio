"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassSheet } from "@/components/ui";
import { CATEGORY_ORDER, CATEGORY_META } from "@/lib/societies/constants";
import type { SocietyCategory } from "@/lib/societies/logic";
import { upsertSocietyProfile } from "@/app/(student)/societies/actions";

/**
 * Owner-only: register an existing community as a society. Picks a category,
 * flips is_society on via upsert_society_profile, then drops into /manage.
 */
export function RegisterSocietyButton({ communityId }: { communityId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SocietyCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!category) return;
    setError(null);
    start(async () => {
      const res = await upsertSocietyProfile(communityId, { category });
      if (res.ok) router.push(`/societies/${communityId}/manage`);
      else setError(res.error);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-[var(--radius-md)] bg-card px-4 py-3 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg">
            Set up as a society
          </span>
          <span className="block text-xs text-fg-muted">
            Unlock a public page, officer roles, announcements & events.
          </span>
        </span>
      </button>

      <GlassSheet
        open={open}
        onClose={() => setOpen(false)}
        label="Register as a society"
      >
        <h2 className="text-lg font-bold">Register as a society</h2>
        <p className="mt-1 text-sm text-fg-muted">Pick a category to start.</p>
        <div className="mt-4 flex flex-wrap gap-2">
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
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={!category || pending}
          className="mt-5 w-full rounded-full bg-accent py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Setting up…" : "Continue"}
        </button>
      </GlassSheet>
    </>
  );
}
