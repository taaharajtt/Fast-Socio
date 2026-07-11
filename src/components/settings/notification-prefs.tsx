"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  setNotificationPref,
  setQuietHours,
} from "@/app/(student)/settings/notification-actions";

const ITEMS: { key: string; label: string }[] = [
  { key: "matches", label: "Matches" },
  { key: "messages", label: "Messages & requests" },
  { key: "likes", label: "Likes & comments" },
  { key: "events", label: "Events" },
  { key: "communities", label: "Communities" },
  { key: "system", label: "System" },
];

type Quiet = { enabled: boolean; start: number; end: number };

/** Format an hour (0–23) as a compact 12-hour label. */
function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${period}`;
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
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

export function NotificationPrefs({
  initial,
  quiet: initialQuiet,
}: {
  initial: Record<string, boolean>;
  quiet?: Quiet;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [quiet, setQuiet] = useState<Quiet>(
    initialQuiet ?? { enabled: false, start: 22, end: 7 }
  );

  function toggle(key: string) {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    setNotificationPref(key, next); // fire-and-forget; RLS scopes to self
  }

  function updateQuiet(next: Quiet) {
    setQuiet(next);
    setQuietHours(next); // fire-and-forget
  }

  return (
    <div className="divide-y divide-glass-border">
      {ITEMS.map((it) => (
        <div key={it.key} className="flex items-center justify-between py-3">
          <span className="text-sm">{it.label}</span>
          <Toggle
            on={prefs[it.key]}
            onClick={() => toggle(it.key)}
            label={it.label}
          />
        </div>
      ))}

      {/* Quiet hours (Phase 7): mutes push delivery within a nightly window;
          in-app notifications still record. */}
      <div className="py-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">Quiet hours</span>
            <p className="text-xs text-fg-muted">Pause push during these hours</p>
          </div>
          <Toggle
            on={quiet.enabled}
            onClick={() => updateQuiet({ ...quiet, enabled: !quiet.enabled })}
            label="Quiet hours"
          />
        </div>

        {quiet.enabled && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <span className="text-fg-muted">From</span>
              <select
                value={quiet.start}
                onChange={(e) =>
                  updateQuiet({ ...quiet, start: Number(e.target.value) })
                }
                className="rounded-[var(--radius-sm)] bg-input-bg px-2 py-1 text-fg outline-none focus:ring-2 focus:ring-aura/40"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-fg-muted">to</span>
              <select
                value={quiet.end}
                onChange={(e) =>
                  updateQuiet({ ...quiet, end: Number(e.target.value) })
                }
                className="rounded-[var(--radius-sm)] bg-input-bg px-2 py-1 text-fg outline-none focus:ring-2 focus:ring-aura/40"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
