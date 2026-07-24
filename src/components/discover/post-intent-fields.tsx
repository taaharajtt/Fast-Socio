"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { GlassInput } from "@/components/ui";
import { TeamMemberMentions } from "@/components/discover/team-member-mentions";
import { ALL_DEGREES, getDegreesForSchool } from "@/lib/profile/constants";
import { CAMPUS_MAP_PLACES } from "@/lib/map/places";
import type { FieldSpec } from "@/lib/smart-match/modes";
import type { TeamMember } from "@/lib/smart-match/types";

// ---------------------------------------------------------------------------
// Shared field-rendering primitives for a Post Intent form. Kept independent of
// any particular container (sheet, inline page section, …) so the same
// mode-driven field spec renders identically everywhere it's used.
// ---------------------------------------------------------------------------

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {help && <p className="mt-1 text-xs text-fg-muted">{help}</p>}
    </div>
  );
}

export function FormField({
  field,
  value,
  onChange,
  team,
  onTeam,
}: {
  field: FieldSpec;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
  team: TeamMember[];
  onTeam: (m: TeamMember[]) => void;
}) {
  if (field.type === "mentions") {
    return (
      <Field label={field.label} help={field.help}>
        <TeamMemberMentions value={team} onChange={onTeam} />
      </Field>
    );
  }
  if (field.type === "place") {
    return (
      <Field label={field.label} help={field.help}>
        <CampusPlaceField
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      </Field>
    );
  }
  if (field.type === "tags") {
    return (
      <Field label={field.label} help={field.help}>
        <TagInput
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      </Field>
    );
  }
  if (field.type === "textarea") {
    return (
      <Field label={field.label} help={field.help}>
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          data-no-drag
          className="glass w-full rounded-xl p-3 text-[15px] text-fg outline-none focus:ring-2 focus:ring-accent/30"
        />
      </Field>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={field.label} help={field.help}>
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          data-no-drag
          className="glass h-[52px] w-full rounded-xl px-4 text-[15px] text-fg outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  const inputType =
    field.type === "number"
      ? "number"
      : field.type === "datetime"
        ? "datetime-local"
        : field.type === "url"
          ? "url"
          : "text";

  return (
    <Field label={field.label} help={field.help}>
      <GlassInput
        type={inputType}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        data-no-drag
      />
    </Field>
  );
}

/**
 * Chip input rendered as glass capsules with an inline "+ Add" capsule
 * trigger: click it to reveal the entry box, Enter/comma commits a skill as
 * its own removable pill, blur or Escape collapses back to just the trigger.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const t = draft.trim().replace(/,$/, "");
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase()) && value.length < 20)
      onChange([...value, t]);
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((t) => (
        <span
          key={t}
          className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
        >
          {t}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== t))}
            aria-label={`Remove ${t}`}
            className="text-fg-muted hover:text-fg"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {adding ? (
        <GlassInput
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          onBlur={() => {
            commit();
            setAdding(false);
          }}
          placeholder={placeholder}
          data-no-drag
          className="!w-auto min-w-[140px] flex-1"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg"
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add skill
        </button>
      )}
    </div>
  );
}

/**
 * Single-select degree capsule row, shown only when the author's profile has
 * no `degree` on file — degrees are scoped to their school (`DEGREES_BY_SCHOOL`)
 * and fall back to the full list when the school isn't recognized.
 */
export function DegreeCapsulePicker({
  school,
  value,
  onChange,
}: {
  school: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const scoped = getDegreesForSchool(school);
  const options = scoped.length ? scoped : ALL_DEGREES;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={value === d}
          className={
            value === d
              ? "gradient-brand rounded-full px-3 py-1.5 text-xs font-bold text-white"
              : "glass rounded-full px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
          }
        >
          {d}
        </button>
      ))}
    </div>
  );
}

/**
 * Sports "Where" field: tap a known campus sports spot (from `CAMPUS_MAP_PLACES`)
 * to fill the text box, or just type a custom spot name — the value is always
 * a plain string (the place's name when tapped), so `resolvePlace` can turn it
 * back into a map pin later without a separate place-id column.
 */
export function CampusPlaceField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const sportsPlaces = CAMPUS_MAP_PLACES.filter((p) => p.type === "sports");
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {sportsPlaces.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.name)}
            aria-pressed={value === p.name}
            className={
              value === p.name
                ? "gradient-brand rounded-full px-3 py-1.5 text-xs font-bold text-white"
                : "glass rounded-full px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
            }
          >
            {p.shortLabel}
          </button>
        ))}
      </div>
      <GlassInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-no-drag
      />
    </div>
  );
}
