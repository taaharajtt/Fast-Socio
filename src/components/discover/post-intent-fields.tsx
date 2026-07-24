"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { GlassInput } from "@/components/ui";
import { TeamMemberMentions } from "@/components/discover/team-member-mentions";
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

/** Chip input: type + Enter/comma to add, backspace to remove the last. */
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

  function commit() {
    const t = draft.trim().replace(/,$/, "");
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase()) && value.length < 20)
      onChange([...value, t]);
    setDraft("");
  }

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
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
        </div>
      )}
      <GlassInput
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        data-no-drag
      />
    </div>
  );
}
