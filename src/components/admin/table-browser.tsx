"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ctrl, ctrlDanger, field } from "@/components/admin/kit";
import { updateRow, insertRow, deleteRow } from "@/app/admin/database/actions";
import type { ColumnMeta } from "@/app/admin/database/[table]/page";

type Row = Record<string, unknown>;
type Kind = "bool" | "number" | "json" | "text";

function kindOf(type: string): Kind {
  if (type === "boolean") return "bool";
  if (["integer", "bigint", "smallint", "numeric", "double precision", "real"].includes(type))
    return "number";
  if (type === "jsonb" || type === "json" || type === "ARRAY") return "json";
  return "text";
}

/** Value (JS) → the string shown in an input. */
function toRaw(v: unknown, kind: Kind): string {
  if (v === null || v === undefined) return "";
  if (kind === "json") return JSON.stringify(v);
  if (kind === "bool") return v ? "true" : "false";
  return String(v);
}

/** Input string → the JS value we send (with correct type) or throw on bad JSON. */
function fromRaw(raw: string, kind: Kind): unknown {
  const t = raw.trim();
  if (kind === "bool") return t === "true" ? true : t === "false" ? false : null;
  if (kind === "number") return t === "" ? null : Number(t);
  if (kind === "json") return t === "" ? null : JSON.parse(t);
  return t === "" ? null : raw; // text-ish: empty → null
}

function cell(v: unknown, kind: Kind): { text: string; muted: boolean } {
  if (v === null || v === undefined) return { text: "null", muted: true };
  if (kind === "bool") return { text: v ? "true" : "false", muted: false };
  const s = kind === "json" ? JSON.stringify(v) : String(v);
  return { text: s.length > 60 ? s.slice(0, 60) + "…" : s, muted: false };
}

export function TableBrowser({
  table,
  columns,
  pkCol,
  fks,
  isView,
  rows,
  total,
  pageSize,
  page,
  q,
  sort,
  dir,
  indexes,
}: {
  table: string;
  columns: ColumnMeta[];
  pkCol: string | null;
  fks: Record<string, string>;
  isView: boolean;
  rows: Row[];
  total: number;
  pageSize: number;
  page: number;
  q: string;
  sort: string;
  dir: "asc" | "desc";
  indexes: { name: string; def: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showIdx, setShowIdx] = useState(false);
  const [search, setSearch] = useState(q);
  const [editing, setEditing] = useState<{ mode: "edit" | "insert"; row: Row } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const kinds = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.name, kindOf(c.type)])) as Record<string, Kind>,
    [columns],
  );
  const editable = pkCol !== null && !isView;
  const from = page * pageSize;
  const to = Math.min(from + rows.length, total);

  function pushParams(next: Partial<{ page: number; q: string; sort: string; dir: string }>) {
    const m = { page, q, sort, dir, ...next };
    const sp = new URLSearchParams();
    if (m.q) sp.set("q", m.q);
    if (m.sort) {
      sp.set("sort", m.sort);
      sp.set("dir", m.dir || "asc");
    }
    if (m.page) sp.set("page", String(m.page));
    router.push(`/admin/database/${table}${sp.toString() ? `?${sp}` : ""}`);
  }

  function onSort(col: string) {
    if (sort === col) pushParams({ sort: col, dir: dir === "asc" ? "desc" : "asc", page: 0 });
    else pushParams({ sort: col, dir: "asc", page: 0 });
  }

  function openEdit(row: Row) {
    setErr(null);
    setForm(Object.fromEntries(columns.map((c) => [c.name, toRaw(row[c.name], kinds[c.name])])));
    setEditing({ mode: "edit", row });
  }
  function openInsert() {
    setErr(null);
    setForm(Object.fromEntries(columns.map((c) => [c.name, ""])));
    setEditing({ mode: "insert", row: {} });
  }

  function save() {
    if (!editing) return;
    setErr(null);
    let payload: Record<string, unknown>;
    try {
      if (editing.mode === "edit") {
        payload = {};
        for (const c of columns) {
          if (c.name === pkCol) continue;
          const raw = form[c.name] ?? "";
          if (raw !== toRaw(editing.row[c.name], kinds[c.name]))
            payload[c.name] = fromRaw(raw, kinds[c.name]);
        }
        if (Object.keys(payload).length === 0) {
          setEditing(null);
          return;
        }
      } else {
        payload = {};
        for (const c of columns) {
          const raw = form[c.name] ?? "";
          if (raw.trim() !== "") payload[c.name] = fromRaw(raw, kinds[c.name]);
        }
      }
    } catch (e) {
      setErr(`Invalid value: ${(e as Error).message}`);
      return;
    }

    start(async () => {
      const res =
        editing.mode === "edit"
          ? await updateRow(table, pkCol!, String(editing.row[pkCol!]), payload)
          : await insertRow(table, payload);
      if ("error" in res) setErr(res.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  function remove() {
    if (!editing || editing.mode !== "edit" || !pkCol) return;
    if (!window.confirm(`Delete this row from ${table}? This is logged and cannot be undone.`))
      return;
    start(async () => {
      const res = await deleteRow(table, pkCol, String(editing.row[pkCol]));
      if ("error" in res) setErr(res.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      {/* Header */}
      <header className="mb-4 border-b border-glass-border pb-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="font-mono text-lg font-semibold text-fg">{table}</h1>
          <span className="font-mono text-xs text-fg-muted">
            {total} rows · {columns.length} cols
          </span>
          <button
            type="button"
            onClick={() => setShowIdx((s) => !s)}
            className="ml-auto text-[11px] text-fg-muted hover:text-fg"
          >
            {showIdx ? "hide" : "show"} indexes ({indexes.length})
          </button>
        </div>
        {showIdx && (
          <div className="mt-2 space-y-1 rounded-[4px] border border-glass-border bg-input p-2">
            {indexes.map((i) => (
              <p key={i.name} className="overflow-x-auto whitespace-nowrap font-mono text-[11px] text-fg-muted">
                {i.def}
              </p>
            ))}
          </div>
        )}
      </header>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pushParams({ q: search, page: 0 });
          }}
          className="flex flex-1 gap-2"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all text columns…"
            className={`${field} flex-1`}
          />
          <button type="submit" className={ctrl}>
            Search
          </button>
        </form>
        {editable && (
          <button type="button" onClick={openInsert} className={ctrl}>
            + New row
          </button>
        )}
      </div>

      {!editable && (
        <p className="mb-2 font-mono text-[11px] text-warning">
          {isView
            ? "View — read-only."
            : "No single-column primary key — inline edit/delete disabled (use the SQL console)."}
        </p>
      )}

      {/* Data table */}
      <div className="overflow-x-auto rounded-[4px] border border-glass-border">
        <table className="w-full border-collapse text-sm" style={{ minWidth: `${columns.length * 130}px` }}>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort === c.name;
                return (
                  <th
                    key={c.name}
                    className="border-b border-glass-border px-3 py-2 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => onSort(c.name)}
                      className="flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-fg-muted hover:text-fg"
                      title={`${c.type}${c.nullable ? "" : " · not null"}${fks[c.name] ? ` · → ${fks[c.name]}` : ""}`}
                    >
                      {c.name === pkCol && <span className="text-gold">★</span>}
                      {c.name}
                      {active && <span>{dir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-fg-muted">
                  No rows.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => editable && openEdit(row)}
                  className={`border-b border-glass-border last:border-0 ${
                    editable ? "cursor-pointer hover:bg-card/50" : ""
                  }`}
                >
                  {columns.map((c) => {
                    const { text, muted } = cell(row[c.name], kinds[c.name]);
                    return (
                      <td
                        key={c.name}
                        className={`whitespace-nowrap px-3 py-2 font-mono text-xs ${
                          muted ? "text-fg-disabled italic" : "text-fg"
                        }`}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between text-xs text-fg-muted">
        <span className="font-mono">
          {total === 0 ? "0" : `${from + 1}–${to}`} of {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => pushParams({ page: page - 1 })}
            className={ctrl}
          >
            ← Prev
          </button>
          <button
            type="button"
            disabled={to >= total}
            onClick={() => pushParams({ page: page + 1 })}
            className={ctrl}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Editor drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setEditing(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-glass-border bg-bg"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-glass-border bg-bg px-4 py-3">
              <p className="font-mono text-sm text-fg">
                {editing.mode === "edit" ? "Edit row" : "New row"} · {table}
              </p>
              <button type="button" onClick={() => setEditing(null)} className="text-fg-muted hover:text-fg">
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-3 p-4">
              {columns.map((c) => {
                const kind = kinds[c.name];
                const isPk = c.name === pkCol && editing.mode === "edit";
                return (
                  <div key={c.name} className="space-y-1">
                    <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
                      {c.name === pkCol && <span className="text-gold">★</span>}
                      {c.name}
                      <span className="text-fg-disabled normal-case">
                        {c.type}
                        {c.nullable ? "" : " · not null"}
                        {fks[c.name] ? ` → ${fks[c.name]}` : ""}
                      </span>
                    </label>
                    {kind === "bool" ? (
                      <select
                        value={form[c.name] ?? ""}
                        disabled={isPk}
                        onChange={(e) => setForm((f) => ({ ...f, [c.name]: e.target.value }))}
                        className={`${field} w-full disabled:opacity-50`}
                      >
                        <option value="">null</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : kind === "json" ? (
                      <textarea
                        value={form[c.name] ?? ""}
                        disabled={isPk}
                        onChange={(e) => setForm((f) => ({ ...f, [c.name]: e.target.value }))}
                        rows={2}
                        className="w-full rounded-[3px] border border-glass-border bg-input px-2.5 py-1.5 font-mono text-xs text-fg outline-none focus:border-fg-muted disabled:opacity-50"
                      />
                    ) : (
                      <input
                        value={form[c.name] ?? ""}
                        disabled={isPk}
                        inputMode={kind === "number" ? "numeric" : undefined}
                        onChange={(e) => setForm((f) => ({ ...f, [c.name]: e.target.value }))}
                        placeholder={c.nullable ? "null" : ""}
                        className={`${field} w-full disabled:opacity-50`}
                      />
                    )}
                  </div>
                );
              })}
              {err && <p className="font-mono text-xs text-error">{err}</p>}
            </div>

            <div className="sticky bottom-0 flex items-center gap-2 border-t border-glass-border bg-bg px-4 py-3">
              <button type="button" onClick={save} disabled={pending} className={ctrl}>
                {pending ? "Saving…" : editing.mode === "edit" ? "Save changes" : "Insert row"}
              </button>
              {editing.mode === "edit" && (
                <button type="button" onClick={remove} disabled={pending} className={`${ctrlDanger} ml-auto`}>
                  Delete row
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
