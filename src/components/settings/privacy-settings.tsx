"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  setPrivacy,
  setProfileVisibility,
} from "@/app/(student)/settings/privacy-actions";

const GROUPS: { title: string; items: { key: string; label: string; hint?: string }[] }[] = [
  {
    title: "Visibility",
    items: [
      { key: "discoverable", label: "Show me in Discover", hint: "Appear in the swipe deck" },
      { key: "searchable", label: "Allow search", hint: "Let others find you by name" },
    ],
  },
  {
    title: "Presence",
    items: [
      { key: "show_online", label: "Online status", hint: "Show your active dot & last seen" },
      { key: "read_receipts", label: "Read receipts", hint: "Let others see when you've read" },
    ],
  },
  {
    title: "Profile details",
    items: [
      { key: "show_aura", label: "Show Aura" },
      { key: "show_department", label: "Show department" },
      { key: "show_semester", label: "Show semester" },
    ],
  },
];

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        on ? "bg-aura" : "bg-glass-strong"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
          on ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}

export function PrivacySettings({
  initial,
  initialVisibility,
}: {
  initial: Record<string, boolean>;
  initialVisibility: "public" | "university";
}) {
  const [prefs, setPrefs] = useState(initial);
  const [visibility, setVisibility] = useState(initialVisibility);

  function toggle(key: string) {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    setPrivacy(key, next);
  }

  function pickVisibility(v: "public" | "university") {
    setVisibility(v);
    setProfileVisibility(v);
  }

  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-2">
          <h2 className="text-sm font-medium text-fg-muted">{group.title}</h2>
          <div className="rounded-[var(--radius-card)] bg-card px-5 py-1 divide-y divide-glass-border">
            {group.items.map((it) => (
              <div key={it.key} className="flex items-center justify-between py-3">
                <div>
                  <span className="text-sm">{it.label}</span>
                  {it.hint && <p className="text-xs text-fg-muted">{it.hint}</p>}
                </div>
                <Toggle on={prefs[it.key]} onClick={() => toggle(it.key)} label={it.label} />
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-fg-muted">Profile visibility</h2>
        <div className="flex gap-2">
          {(["public", "university"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={visibility === v}
              onClick={() => pickVisibility(v)}
              className={cn(
                "flex-1 rounded-[var(--radius-md)] px-4 py-3 text-sm font-medium capitalize transition-all",
                visibility === v
                  ? "gradient-brand text-white"
                  : "bg-card text-fg-muted"
              )}
            >
              {v === "university" ? "University only" : "Public"}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
