"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { GlassButton, GlassInput } from "@/components/ui";
import { CoverUpload } from "@/components/communities/cover-upload";
import { CATEGORY_ORDER, CATEGORY_META } from "@/lib/societies/constants";
import type { SocietyCategory } from "@/lib/societies/logic";
import { upsertSocietyProfile } from "@/app/(student)/societies/actions";
import type { SocietyRow } from "@/lib/societies/types";

/** Officer-editable society profile (category, bio, recruiting, socials, banner). */
export function SocietyProfileEditor({ society }: { society: SocietyRow }) {
  const [category, setCategory] = useState<SocietyCategory | null>(
    society.society_category ?? null
  );
  const [description, setDescription] = useState(society.description ?? "");
  const [recruiting, setRecruiting] = useState(society.recruitment_open);
  const [email, setEmail] = useState(society.contact_email ?? "");
  const [instagram, setInstagram] = useState(society.instagram_url ?? "");
  const [website, setWebsite] = useState(society.website_url ?? "");
  const [cover, setCover] = useState<string | null>(society.cover_url);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    if (!category) {
      setError("Pick a category.");
      return;
    }
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await upsertSocietyProfile(society.id, {
        category,
        description,
        recruitmentOpen: recruiting,
        contactEmail: email,
        instagramUrl: instagram,
        websiteUrl: website,
        coverUrl: cover,
      });
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
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
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
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

      <div className="space-y-2">
        <label htmlFor="s-desc" className="text-sm font-medium">
          About
        </label>
        <textarea
          id="s-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          rows={3}
          placeholder="What does your society do?"
          className="w-full resize-none rounded-[12px] bg-card p-3 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40"
        />
      </div>

      <CoverUpload value={cover} onChange={setCover} label="Banner (16:9)" prefix="society" />

      <button
        type="button"
        role="switch"
        aria-checked={recruiting}
        onClick={() => setRecruiting((v) => !v)}
        className="flex w-full items-center gap-3 rounded-[12px] bg-card p-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg">Recruiting</span>
          <span className="block text-xs text-fg-muted">
            Show a “Recruiting” badge and open the recruitment tab.
          </span>
        </span>
        <span
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            recruiting ? "bg-success" : "bg-white/15"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
              recruiting ? "translate-x-[22px]" : "translate-x-0.5"
            )}
          />
        </span>
      </button>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Links</label>
        <GlassInput
          placeholder="Contact email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <GlassInput
          placeholder="Instagram URL"
          value={instagram}
          onChange={(e) => setInstagram(e.target.value)}
        />
        <GlassInput
          placeholder="Website URL"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {saved && <p className="text-sm text-success">Saved.</p>}

      <GlassButton className="w-full" onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </GlassButton>
    </div>
  );
}
