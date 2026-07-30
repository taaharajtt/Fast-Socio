"use client";

import { useEffect, useState, useTransition } from "react";
import { field, ctrl } from "@/components/admin/kit";
import {
  previewAudience,
  searchAudienceUsers,
  sendTargetedBroadcast,
  type Audience,
} from "@/app/admin/broadcast/actions";

export type AudienceOption = { kind: string; value: string; n: number };

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "all", label: "All users" },
  { value: "verified", label: "Verified only" },
  { value: "user", label: "A single user" },
  { value: "semester", label: "A semester" },
  { value: "degree", label: "A degree" },
  { value: "school", label: "A school" },
];

/** Audiences that address a whole population and take no picker value. */
const NO_VALUE: Audience[] = ["all", "verified"];

/**
 * Targeted broadcast composer (fix-045).
 *
 * Only the addressed people receive it, so the count shown here is resolved by
 * the SAME database function the send uses — the preview cannot drift from
 * reality. The send re-resolves the audience and re-checks the admin role
 * server-side regardless of what this form believes.
 *
 * Semester options come from `admin_audience_options()`, which derives semester
 * from the roll number. The `profiles.semester` column is stale and would
 * address the wrong people.
 */
export function BroadcastComposer({ options }: { options: AudienceOption[] }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [value, setValue] = useState("");

  const [userQuery, setUserQuery] = useState("");
  const [userHits, setUserHits] = useState<
    { id: string; full_name: string | null; username: string | null }[]
  >([]);
  const [pickedUser, setPickedUser] = useState<string | null>(null);

  const [preview, setPreview] = useState<{ key: string; count: number } | null>(
    null
  );
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const needsValue = !NO_VALUE.includes(audience);
  const resolvedValue = audience === "user" ? (pickedUser ?? "") : value;
  const audienceReady = !needsValue || resolvedValue.length > 0;
  const valid = title.trim().length > 0 && body.trim().length > 0 && audienceReady;

  /**
   * Both the count and the confirm step are keyed to the exact audience they
   * belong to and DERIVED, not stored as independent flags. Change the audience
   * and the old count stops being shown and the confirm step collapses, with no
   * effect to reset them — so it is structurally impossible to confirm a send
   * against a recipient count that belongs to a different audience.
   */
  const audienceKey = `${audience}:${resolvedValue}`;
  const count = preview?.key === audienceKey ? preview.count : null;
  const confirming = confirmKey === audienceKey;

  useEffect(() => {
    if (!audienceReady) return;
    let cancelled = false;
    (async () => {
      const res = await previewAudience(audience, resolvedValue || null);
      if (cancelled || !("count" in res)) return;
      setPreview({ key: `${audience}:${resolvedValue}`, count: res.count });
    })();
    return () => {
      cancelled = true;
    };
  }, [audience, resolvedValue, audienceReady]);

  // Type-ahead for the single-user audience. Hits are filtered at render time
  // rather than cleared in the effect body.
  useEffect(() => {
    if (audience !== "user" || userQuery.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const hits = await searchAudienceUsers(userQuery);
      if (!cancelled) setUserHits(hits);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [audience, userQuery]);

  const visibleHits =
    audience === "user" && userQuery.trim().length >= 2 && !pickedUser
      ? userHits
      : [];

  function send() {
    setMsg(null);
    start(async () => {
      const res = await sendTargetedBroadcast({
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || undefined,
        audience,
        value: resolvedValue || null,
      });
      if ("error" in res) {
        setMsg({ ok: false, text: res.error });
      } else {
        setMsg({
          ok: true,
          text: `Sent to ${res.recipients} recipient${res.recipients === 1 ? "" : "s"}.`,
        });
        setTitle("");
        setBody("");
        setUrl("");
      }
    });
  }

  const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted";
  const forKind = (kind: string) =>
    options
      .filter((o) => o.kind === kind)
      .sort((a, b) =>
        kind === "semester"
          ? Number(a.value) - Number(b.value)
          : a.value.localeCompare(b.value)
      );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setConfirmKey(audienceKey);
      }}
      className="space-y-4 rounded-[4px] border border-glass-border p-4"
    >
      <div className="space-y-1.5">
        <label className={label}>Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          placeholder="e.g. Maintenance tonight"
          className={`${field} w-full`}
        />
      </div>

      <div className="space-y-1.5">
        <label className={label}>Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={280}
          rows={3}
          placeholder="The message students will see…"
          className="w-full rounded-[3px] border border-glass-border bg-input px-2.5 py-1.5 text-sm text-fg outline-none focus:border-fg-muted"
        />
        <p className="text-right font-mono text-[10px] text-fg-disabled">
          {body.length}/280
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className={label}>Audience</label>
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as Audience);
              setValue("");
              setPickedUser(null);
              setUserQuery("");
            }}
            className={`${field} w-full`}
          >
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {/* The picker that matches the chosen audience. */}
        <div className="space-y-1.5">
          {needsValue && <label className={label}>Target</label>}
          {audience === "user" ? (
            <>
              <input
                value={
                  pickedUser
                    ? (userHits.find((u) => u.id === pickedUser)?.username ??
                      userQuery)
                    : userQuery
                }
                onChange={(e) => {
                  setUserQuery(e.target.value);
                  setPickedUser(null);
                }}
                placeholder="Search name or roll number…"
                className={`${field} w-full`}
              />
              {visibleHits.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded-[3px] border border-glass-border">
                  {visibleHits.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPickedUser(u.id);
                          setUserQuery(u.username ?? "");
                          setUserHits([]);
                        }}
                        className="block w-full px-2.5 py-1.5 text-left text-sm text-fg hover:bg-glass"
                      >
                        {u.full_name ?? "—"}{" "}
                        <span className="font-mono text-[11px] text-fg-muted">
                          {u.username}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : needsValue ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={`${field} w-full`}
            >
              <option value="">Choose…</option>
              {forKind(audience).map((o) => (
                <option key={o.value} value={o.value}>
                  {audience === "semester" ? `Semester ${o.value}` : o.value} ({o.n})
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label className={label}>Link (optional)</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/events/…"
            className={`${field} w-full`}
          />
        </div>
      </div>

      {/* Resolved recipient count, before anything is sent. */}
      <p className="font-mono text-xs text-fg-muted">
        {!audienceReady
          ? "Pick a target to see who this reaches."
          : count === null
            ? "Resolving audience…"
            : `This will reach ${count} ${count === 1 ? "person" : "people"}.`}
      </p>

      {!confirming ? (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={!valid || pending} className={ctrl}>
            Review &amp; send
          </button>
          {msg && (
            <p className={`font-mono text-xs ${msg.ok ? "text-success" : "text-error"}`}>
              {msg.text}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-[3px] border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm text-fg">
            Send <span className="font-semibold">{title.trim()}</span> to{" "}
            <span className="font-semibold">
              {count ?? "…"} {count === 1 ? "person" : "people"}
            </span>
            ? Each one gets an in-app notification and a push.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={send}
              disabled={pending}
              className={ctrl}
            >
              {pending ? "Sending…" : "Confirm send"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmKey(null)}
              disabled={pending}
              className="font-mono text-xs text-fg-muted underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
