"use client";

import { useState, useTransition } from "react";
import { ChevronDown, X } from "lucide-react";
import { GlassSheet, GlassInput, GlassButton } from "@/components/ui";
import { TeamMemberMentions } from "@/components/discover/team-member-mentions";
import { modeMeta, type PostMode } from "@/lib/smart-match/modes";
import type { FieldSpec } from "@/lib/smart-match/modes";
import { createSmartMatchPost } from "@/app/(student)/discover/smart-match-actions";
import type {
  PostFormValues,
} from "@/lib/smart-match/validate";
import type { RecruitAnchor, SmartMatchViewer, TeamMember } from "@/lib/smart-match/types";

/**
 * Progressive, mode-specific create form in a bottom sheet. Required fields show
 * first; optional "advanced" fields collapse behind a toggle. Skills/roles are
 * chip inputs; Project/Hackathon get the team-member mention picker; Recruitment
 * gets a society/event anchor (and is blocked if you run none).
 */
export function SmartMatchForm({
  mode,
  viewer,
  recruitAnchors,
  open,
  onClose,
  onCreated,
}: {
  mode: PostMode;
  viewer: SmartMatchViewer;
  recruitAnchors: RecruitAnchor[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const meta = modeMeta(mode);
  const initialValues = (): PostFormValues => {
    const init: PostFormValues = {};
    if (viewer.semester) init.semester = String(viewer.semester);
    return init;
  };
  const [values, setValues] = useState<PostFormValues>(initialValues);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [anchor, setAnchor] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const basic = meta.fields.filter((f) => !f.advanced);
  const advanced = meta.fields.filter((f) => f.advanced);
  const recruitBlocked = mode === "recruitment" && recruitAnchors.length === 0;

  function set(key: string, v: string | string[]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function submit() {
    setError(null);
    const payload: PostFormValues = { ...values };
    if (mode === "recruitment" && anchor) {
      const [kind, id] = anchor.split(":");
      if (kind === "society") payload.society_id = id;
      else payload.event_id = id;
    }
    start(async () => {
      const res = await createSmartMatchPost(
        mode,
        payload,
        team.map((t) => t.id)
      );
      if (!res.ok) setError(res.error);
      else {
        setValues(initialValues());
        setTeam([]);
        setAnchor("");
        onCreated();
      }
    });
  }

  return (
    <GlassSheet open={open} onClose={onClose} label={meta.formTitle}>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto" data-sheet-scroll>
        <h2 className="text-lg font-bold">{meta.formTitle}</h2>

        {recruitBlocked ? (
          <p className="rounded-[14px] bg-card px-4 py-6 text-center text-sm text-fg-muted">
            Recruitment posts are for society officers and event organizers. Run a
            society or organize an event to recruit contributors here.
          </p>
        ) : (
          <>
            {mode === "recruitment" && (
              <Field label="Recruit for">
                <select
                  value={anchor}
                  onChange={(e) => setAnchor(e.target.value)}
                  data-no-drag
                  className="glass h-[52px] w-full rounded-xl px-4 text-[15px] text-fg outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">Select a society or event…</option>
                  {recruitAnchors.map((a) => (
                    <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>
                      {a.kind === "society" ? "🏛 " : "🎉 "}
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {basic.map((f) => (
              <FormField
                key={f.key}
                field={f}
                value={values[f.key]}
                onChange={(v) => set(f.key, v)}
                team={team}
                onTeam={setTeam}
              />
            ))}

            {advanced.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="flex items-center gap-1 text-sm font-medium text-fg-muted"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                  More options
                </button>
                {showAdvanced && (
                  <div className="mt-3 space-y-4">
                    {advanced.map((f) => (
                      <FormField
                        key={f.key}
                        field={f}
                        value={values[f.key]}
                        onChange={(v) => set(f.key, v)}
                        team={team}
                        onTeam={setTeam}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-error">{error}</p>}

            <GlassButton
              type="button"
              disabled={pending}
              onClick={submit}
              className="w-full"
            >
              {pending ? "Posting…" : meta.createLabel}
            </GlassButton>
          </>
        )}
      </div>
    </GlassSheet>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {help && <p className="mt-1 text-xs text-fg-muted">{help}</p>}
    </div>
  );
}

function FormField({
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
function TagInput({
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
