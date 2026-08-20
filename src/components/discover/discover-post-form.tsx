"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { DegreeCapsulePicker, Field, FormField } from "@/components/discover/post-intent-fields";
import { modeMeta, type PostMode } from "@/lib/smart-match/modes";
import { postToFormValues, type PostFormValues } from "@/lib/smart-match/validate";
import {
  createDiscoverPost,
  updateDiscoverPost,
} from "@/app/(student)/discover/discover-actions";
import type {
  RecruitAnchor,
  SmartMatchPost,
  SmartMatchViewer,
  TeamMember,
} from "@/lib/smart-match/types";

/**
 * The type-specific create/edit form, rendered INLINE on /discover/post — no
 * sheet, no modal. Required fields show first; optional "advanced" fields
 * collapse behind a toggle. Skills/roles are chip inputs; Project/Hackathon
 * get the team-member mention picker; Recruitment must be anchored to a
 * society or event the author actually runs.
 */
export function DiscoverPostForm({
  kind,
  viewer,
  recruitAnchors,
  editing,
  onSaved,
}: {
  kind: PostMode;
  viewer: SmartMatchViewer;
  recruitAnchors: RecruitAnchor[];
  /** When set, the form updates this post instead of creating one. */
  editing?: SmartMatchPost | null;
  onSaved: () => void;
}) {
  return (
    <DiscoverPostFormBody
      // Remount per kind/post so all field state resets cleanly.
      key={`${kind}:${editing?.id ?? "new"}`}
      kind={kind}
      viewer={viewer}
      recruitAnchors={recruitAnchors}
      editing={editing ?? null}
      onSaved={onSaved}
    />
  );
}

function DiscoverPostFormBody({
  kind,
  viewer,
  recruitAnchors,
  editing,
  onSaved,
}: {
  kind: PostMode;
  viewer: SmartMatchViewer;
  recruitAnchors: RecruitAnchor[];
  editing: SmartMatchPost | null;
  onSaved: () => void;
}) {
  const meta = modeMeta(kind);
  const [values, setValues] = useState<PostFormValues>(() => {
    const init: PostFormValues = editing
      ? postToFormValues(kind, editing as unknown as Record<string, unknown>)
      : {};
    if (!editing && viewer.semester) init.semester = String(viewer.semester);
    // Project Partner/FYP Teammate/Sports auto-bind semester (and, for
    // Project Partner/FYP Teammate, degree) from the profile — these aren't
    // in the mode's field spec, so they're never seeded above.
    if (kind === "project_partner" || kind === "fyp_teammate") {
      init.semester = String(editing?.semester ?? viewer.semester ?? "");
      init.degree = editing?.degree ?? viewer.degree ?? "";
    }
    if (kind === "sports") {
      init.semester = String(editing?.semester ?? viewer.semester ?? "");
      if (editing?.placeId) {
        init.place_id = editing.placeId;
        init.place_x = editing.placeX != null ? String(editing.placeX) : "";
        init.place_y = editing.placeY != null ? String(editing.placeY) : "";
      }
    }
    return init;
  });
  const [team, setTeam] = useState<TeamMember[]>(editing?.teamMembers ?? []);
  const [anchor, setAnchor] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const basic = meta.fields.filter((f) => !f.advanced);
  const advanced = meta.fields.filter((f) => f.advanced);
  // Recruitment authority is fixed at creation, so the anchor only gates new posts.
  const recruitBlocked =
    kind === "recruitment" && !editing && recruitAnchors.length === 0;

  function set(key: string, v: string | string[]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function submit() {
    setError(null);
    const payload: PostFormValues = { ...values };
    if (kind === "recruitment" && anchor) {
      const [anchorKind, id] = anchor.split(":");
      if (anchorKind === "society") payload.society_id = id;
      else payload.event_id = id;
    }
    if (kind === "recruitment" && editing) {
      // Keep the original anchor so validation passes on edit.
      if (editing.societyId) payload.society_id = editing.societyId;
      if (editing.eventId) payload.event_id = editing.eventId;
    }
    start(async () => {
      const ids = team.map((t) => t.id);
      const res = editing
        ? await updateDiscoverPost(editing.id, kind, payload, ids)
        : await createDiscoverPost(kind, payload, ids);
      if (!res.ok) setError(res.error);
      else onSaved();
    });
  }

  // No title row here. /discover/post is a drill-down now: the page header
  // above this card already reads "Project Partner / Find a project partner"
  // and carries the back control, so a second copy of the title with a second
  // way out beside it would be two of each.
  return (
    <div className="space-y-4 rounded-[18px] bg-card p-4">
      {recruitBlocked ? (
        <p className="rounded-[14px] bg-bg-elevated px-4 py-6 text-center text-sm text-fg-muted">
          Recruitment posts are for society officers and event organizers. Run a
          society or organize an event to recruit contributors here.
        </p>
      ) : (
        <>
          {kind === "recruitment" && !editing && (
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
              onPlace={
                f.type === "place"
                  ? (p) =>
                      setValues((prev) => ({
                        ...prev,
                        place_id: p?.placeId ?? "",
                        place_x: p ? String(p.x) : "",
                        place_y: p ? String(p.y) : "",
                      }))
                  : undefined
              }
            />
          ))}

          {(kind === "project_partner" || kind === "fyp_teammate") && !viewer.degree && (
            <Field label="Degree" help="We couldn't find a degree on your profile — pick yours.">
              <DegreeCapsulePicker
                school={viewer.department}
                value={typeof values.degree === "string" ? values.degree : ""}
                onChange={(v) => set("degree", v)}
              />
            </Field>
          )}

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
            {pending ? "Saving…" : editing ? "Save changes" : meta.createLabel}
          </GlassButton>
        </>
      )}
    </div>
  );
}
