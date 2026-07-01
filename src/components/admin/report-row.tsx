"use client";

import { useTransition } from "react";
import { GlassButton, GlassCard, GlassChip } from "@/components/ui";
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

const statusTone: Record<AdminReport["status"], "warning" | "cyan" | "success" | "neutral"> = {
  pending: "warning",
  reviewing: "cyan",
  actioned: "success",
  dismissed: "neutral",
};

export function ReportRow({ report }: { report: AdminReport }) {
  const [pending, start] = useTransition();

  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {report.targetName ?? report.targetId.slice(0, 8)}
            <span className="ml-2 text-xs font-normal text-fg-muted">
              {report.targetType}
            </span>
          </p>
          <p className="mt-1 text-sm">{report.reason}</p>
          {report.details && (
            <p className="mt-1 text-sm text-fg-muted">{report.details}</p>
          )}
          <p className="mt-1 text-xs text-fg-muted">{report.createdAt}</p>
        </div>
        <GlassChip tone={statusTone[report.status]}>{report.status}</GlassChip>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["reviewing", "actioned", "dismissed"] as const).map((s) => (
          <GlassButton
            key={s}
            variant={s === "actioned" ? "danger" : "glass"}
            size="sm"
            disabled={pending || report.status === s}
            onClick={() =>
              start(async () => {
                await updateReportStatus(report.id, s);
              })
            }
          >
            {s}
          </GlassButton>
        ))}
      </div>
    </GlassCard>
  );
}
