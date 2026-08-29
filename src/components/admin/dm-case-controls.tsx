"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ctrl, ctrlDanger, field } from "@/components/admin/kit";
import {
  addCaseNote,
  setCaseAssignment,
  setCaseStatus,
  type DmCaseStatus,
} from "@/app/admin/dm-reports/actions";

const STATUSES: DmCaseStatus[] = [
  "pending",
  "reviewing",
  "actioned",
  "dismissed",
];

/**
 * Case triage: status, assignment, internal note.
 *
 * Warnings, strikes, DM restrictions, suspensions and bans are deliberately
 * NOT reimplemented here. They live on the reported user's admin page as
 * audited RPCs (`issue_strike`, `set_shadow_ban`, `admin_set_ban`), and
 * `issue_strike` already escalates warn → restrict → suspend on its own. A
 * second copy of that ladder driven from this page would drift out of
 * agreement with the first one. The link below is the whole integration.
 */
export function CaseControls({
  reportId,
  status,
  assignedToMe,
  reportedUserId,
}: {
  reportId: string;
  status: DmCaseStatus;
  assignedToMe: boolean;
  reportedUserId: string;
}) {
  const [current, setCurrent] = useState<DmCaseStatus>(status);
  const [mine, setMine] = useState(assignedToMe);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function changeStatus(next: DmCaseStatus) {
    setErr(null);
    start(async () => {
      const res = await setCaseStatus(reportId, next);
      if (res.ok) setCurrent(next);
      else setErr(res.error);
    });
  }

  function toggleAssign() {
    setErr(null);
    start(async () => {
      const res = await setCaseAssignment(reportId, !mine);
      if (res.ok) setMine((v) => !v);
      else setErr(res.error);
    });
  }

  function submitNote() {
    setErr(null);
    setSaved(false);
    start(async () => {
      const res = await addCaseNote(reportId, note);
      if (res.ok) {
        setNote("");
        setSaved(true);
      } else setErr(res.error);
    });
  }

  return (
    <div className="mt-2 space-y-4">
      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Status
        </p>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending || current === s}
              onClick={() => changeStatus(s)}
              className={s === "actioned" ? ctrlDanger : ctrl}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Assignment
        </p>
        <button
          type="button"
          onClick={toggleAssign}
          disabled={pending}
          className={ctrl}
        >
          {mine ? "Unassign me" : "Assign to me"}
        </button>
      </div>

      <div>
        <label
          htmlFor={`note-${reportId}`}
          className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted"
        >
          Internal note
        </label>
        <textarea
          id={`note-${reportId}`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          rows={3}
          maxLength={2000}
          placeholder="Visible to moderators in the case history."
          className={`${field} w-full`}
        />
        <div className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={submitNote}
            disabled={pending || note.trim().length < 3}
            className={ctrl}
          >
            Add note
          </button>
          <span aria-live="polite" className="text-xs text-fg-muted">
            {saved ? "Note added." : ""}
          </span>
        </div>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Act on the reported user
        </p>
        <Link href={`/admin/users/${reportedUserId}`} className={ctrl}>
          Warn · strike · restrict · suspend · ban →
        </Link>
        <p className="mt-1.5 text-xs text-fg-muted">
          These live on the user&rsquo;s page so there is one audited
          implementation of each. Strikes escalate automatically.
        </p>
      </div>

      {err && <p className="font-mono text-[11px] text-error">{err}</p>}
    </div>
  );
}
