"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { setNotificationPref } from "@/app/(student)/settings/notification-actions";

const ITEMS: { key: string; label: string }[] = [
  { key: "matches", label: "Matches" },
  { key: "messages", label: "Messages & requests" },
  { key: "likes", label: "Likes & comments" },
  { key: "events", label: "Events" },
  { key: "communities", label: "Communities" },
  { key: "system", label: "System" },
];

export function NotificationPrefs({
  initial,
}: {
  initial: Record<string, boolean>;
}) {
  const [prefs, setPrefs] = useState(initial);

  function toggle(key: string) {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    setNotificationPref(key, next); // fire-and-forget; RLS scopes to self
  }

  return (
    <div className="divide-y divide-glass-border">
      {ITEMS.map((it) => {
        const on = prefs[it.key];
        return (
          <div
            key={it.key}
            className="flex items-center justify-between py-3"
          >
            <span className="text-sm">{it.label}</span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={it.label}
              onClick={() => toggle(it.key)}
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors",
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
          </div>
        );
      })}
    </div>
  );
}
