"use client";

import { useTransition } from "react";
import { StatusDot, Tag, ctrl, ctrlDanger } from "@/components/admin/kit";
import { updateReportStatus } from "@/app/admin/reports/actions";

export type AdminReport = {
  id: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  reason: string;
  details: string | null;
  status: "pending" | "reviewing" | "actioned" | "dismissed";
  createdAt: string;
};

const statusTone: Record<AdminReport["status"], string> = {
  pending: "warning",
  reviewing: "info",
  actioned: "success",
  dismissed: "neutral",
};

export function ReportRow({ report }: { report: AdminReport }) {
  const [pending, start] = useTransition();

  return (
    <div className="rounded-[4px] border border-glass-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-fg">
            {report.targetName ?? report.targetId.slice(0, 8)}
            <Tag>{report.targetType}</Tag>
          </p>
          <p className="mt-1 text-sm text-fg">{report.reason}</p>
          {report.details && (
            <p className="mt-1 text-sm text-fg-muted">{report.details}</p>
          )}
          <p className="mt-1 font-mono text-[11px] text-fg-muted">{report.createdAt}</p>
        </div>
        <StatusDot tone={statusTone[report.status]} label={report.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["reviewing", "actioned", "dismissed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={s === "actioned" ? ctrlDanger : ctrl}
            disabled={pending || report.status === s}
            onClick={() =>
              start(async () => {
                await updateReportStatus(report.id, s);
              })
            }
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
