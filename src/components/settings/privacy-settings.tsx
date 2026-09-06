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
      {
        key: "show_matches",
        label: "Show my matches",
        hint: "Allow your matches to view your matches list",
      },
    ],
  },
  {
    title: "Messages",
    items: [
      {
        key: "disable_message_requests",
        label: "Disable message requests",
        hint: "Prevent people you haven’t matched with from requesting a chat.",
      },
    ],
  },
];

function Toggle({
  on,
  onClick,
  label,
  busy = false,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  /** A write is in flight. Announced, and it blocks a second one. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        "disabled:opacity-70",
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
  /** Keys whose write is in flight, so the row can say so. */
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  /** Keys whose last write failed, and were rolled back. */
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  /**
   * Optimistic, and therefore REVERSIBLE.
   *
   * The switch flips immediately because a privacy toggle that waits on a round
   * trip feels broken — but an optimistic write that cannot be undone is worse
   * than no optimism at all: a failed save left the switch showing the opposite
   * of what the database holds, and the next page load silently flipped it
   * back. So the previous value is captured, and any failure (a rejected write,
   * an offline network, a thrown action) restores it and says so.
   */
  async function toggle(key: string) {
    const previous = prefs[key];
    const next = !previous;
    setPrefs((p) => ({ ...p, [key]: next }));
    setSaving((s) => ({ ...s, [key]: true }));
    setFailed((f) => ({ ...f, [key]: false }));
    try {
      const res = await setPrivacy(key, next);
      if (res?.error) throw new Error(res.error);
    } catch {
      setPrefs((p) => ({ ...p, [key]: previous }));
      setFailed((f) => ({ ...f, [key]: true }));
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }

  async function pickVisibility(v: "public" | "university") {
    const previous = visibility;
    setVisibility(v);
    setSaving((s) => ({ ...s, profile_visibility: true }));
    setFailed((f) => ({ ...f, profile_visibility: false }));
    try {
      const res = await setProfileVisibility(v);
      if (res?.error) throw new Error(res.error);
    } catch {
      setVisibility(previous);
      setFailed((f) => ({ ...f, profile_visibility: true }));
    } finally {
      setSaving((s) => ({ ...s, profile_visibility: false }));
    }
  }

  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-2">
          <h2 className="text-sm font-medium text-fg-muted">{group.title}</h2>
          <div className="rounded-[var(--radius-card)] bg-card px-5 py-1 divide-y divide-glass-border">
            {group.items.map((it) => (
              <div key={it.key} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <span className="text-sm">{it.label}</span>
                  {it.hint && <p className="text-xs text-fg-muted">{it.hint}</p>}
                  {/* One line, in place, for both states — announced politely
                      so a screen reader hears the outcome without the focus
                      being moved off the switch the user just operated. */}
                  <p className="text-xs" aria-live="polite">
                    {saving[it.key] ? (
                      <span className="text-fg-muted">Saving…</span>
                    ) : failed[it.key] ? (
                      <span className="text-warning">
                        Couldn&apos;t save that — try again.
                      </span>
                    ) : null}
                  </p>
                </div>
                <Toggle
                  on={prefs[it.key]}
                  onClick={() => void toggle(it.key)}
                  label={it.label}
                  busy={Boolean(saving[it.key])}
                />
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
              onClick={() => void pickVisibility(v)}
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
        <p className="text-xs" aria-live="polite">
          {saving.profile_visibility ? (
            <span className="text-fg-muted">Saving…</span>
          ) : failed.profile_visibility ? (
            <span className="text-warning">Couldn&apos;t save that — try again.</span>
          ) : null}
        </p>
      </section>
    </div>
  );
}
