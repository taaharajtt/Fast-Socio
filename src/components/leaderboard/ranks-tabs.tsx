"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import { SkeletonRow } from "@/components/ui/skeleton";
import { LEADERBOARD_TITLES } from "@/lib/leaderboard/titles";
import { deptMeta } from "@/lib/leaderboard/departments";
import {
  fetchLeaderboard,
  type LeaderboardPeriod,
} from "@/app/(student)/leaderboard/actions";

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "alltime", label: "All-Time" },
];

/**
 * Shows a shimmer for a short beat after a tab change so switching feels smooth
 * and intentional even though the data is already client-side (UAT-013).
 */
function useTabTransition(dep: unknown, ms = 380) {
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setLoading(true);
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [dep, ms]);
  return loading;
}

export type StudentRow = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  department: string | null;
  weekly_aura: number;
  rank: number;
};

export type DeptRow = {
  department: string;
  member_count: number;
  total_aura: number;
  weekly_change: number;
  avatars: string[];
};

/**
 * Medal accent for the first three ranks (UAT-007). The board used to promote
 * these into oversized podium hero cards, which crowded the remaining students
 * off the screen; they are now ordinary rows with a coloured rank chip.
 */
const MEDAL: Record<number, { chip: string; ring: string }> = {
  1: { chip: "#D97706", ring: "rgba(217,119,6,0.45)" },
  2: { chip: "#6B7280", ring: "rgba(156,163,175,0.40)" },
  3: { chip: "#F97316", ring: "rgba(249,115,22,0.40)" },
};

export function RanksTabs({
  students,
  depts,
  meId,
}: {
  students: StudentRow[];
  depts: DeptRow[];
  meId: string;
}) {
  const [tab, setTab] = useState<"students" | "depts">("students");
  const switching = useTabTransition(tab);

  return (
    <>
      {/* Purple pill tabs (UISpec V3 §Ranks). */}
      <div className="mb-5 flex gap-2">
        <Pill active={tab === "students"} onClick={() => setTab("students")}>
          Leaderboard
        </Pill>
        <Pill active={tab === "depts"} onClick={() => setTab("depts")}>
          Department Rankings
        </Pill>
      </div>

      {switching ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : tab === "students" ? (
        <StudentSection initial={students} meId={meId} />
      ) : (
        <DepartmentBoard rows={depts} />
      )}
    </>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95",
        active
          ? "gradient-brand text-white shadow-[0_4px_16px_rgba(124,58,237,0.4)]"
          : "bg-card text-fg-muted hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Student leaderboard with a Weekly / Monthly / All-Time period switch
 * (Refactor Phase 5). Weekly is the SSR default; the other periods lazily fetch
 * via a server action and are cached so re-selecting a period is instant.
 */
function StudentSection({
  initial,
  meId,
}: {
  initial: StudentRow[];
  meId: string;
}) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("weekly");
  const [cache, setCache] = useState<
    Partial<Record<LeaderboardPeriod, StudentRow[]>>
  >({ weekly: initial });
  const [pending, startTransition] = useTransition();

  function select(next: LeaderboardPeriod) {
    setPeriod(next);
    if (cache[next]) return;
    startTransition(async () => {
      const rows = await fetchLeaderboard(next);
      setCache((c) => ({ ...c, [next]: rows }));
    });
  }

  const rows = cache[period];
  const loading = pending && !rows;

  return (
    <>
      <div className="mb-4 flex gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => select(p.key)}
            aria-pressed={period === p.key}
            className={cn(
              "rounded-full px-3 py-1.5 text-[13px] font-semibold transition-all active:scale-95",
              period === p.key
                ? "bg-accent/[0.12] text-accent ring-1 ring-accent/40"
                : "bg-card text-fg-muted hover:text-fg"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : (
        <StudentBoard rows={rows ?? []} meId={meId} period={period} />
      )}
    </>
  );
}

function StudentBoard({
  rows,
  meId,
  period,
}: {
  rows: StudentRow[];
  meId: string;
  period: LeaderboardPeriod;
}) {
  const span =
    period === "monthly"
      ? "this month"
      : period === "alltime"
        ? "all time"
        : "this week";
  if (rows.length === 0) {
    return (
      <p className="rounded-[14px] bg-card p-6 text-center text-sm text-fg-muted">
        No Aura earned yet {span}. Match, post, and attend events to climb.
      </p>
    );
  }
  return (
    <>
      <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-disabled">
        Top {rows.length} {span}
      </p>
      <div className="space-y-2">
        {rows.map((r) => {
          const medal = MEDAL[r.rank];
          const title = LEADERBOARD_TITLES[r.rank]?.title;
          const isMe = r.user_id === meId;
          return (
            <div
              key={r.user_id}
              className={cn(
                "flex items-center gap-3 rounded-[12px] px-3 py-3",
                isMe ? "bg-accent/[0.10] ring-1 ring-accent/40" : "bg-card"
              )}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
                style={
                  medal
                    ? { backgroundColor: medal.chip, color: "#fff" }
                    : undefined
                }
              >
                <span className={medal ? undefined : "text-fg-disabled"}>
                  {r.rank}
                </span>
              </span>

              <div
                className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-bg-elevated"
                style={medal ? { boxShadow: `0 0 0 2px ${medal.ring}` } : undefined}
              >
                {r.avatar_url && (
                  <AppImage src={r.avatar_url} alt={r.full_name ?? ""} sizes="44px" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-fg">
                  {r.full_name ?? "Student"}
                </p>
                <p className="truncate text-[13px] text-fg-muted">
                  {deptMeta(r.department).abbr}
                  {title && (
                    <>
                      {" · "}
                      <span style={{ color: medal?.chip }}>{title}</span>
                    </>
                  )}
                </p>
              </div>

              <span className="flex shrink-0 items-center gap-1 text-[15px] font-semibold text-gold">
                <Zap className="h-3.5 w-3.5" aria-hidden />
                {r.weekly_aura.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function DepartmentBoard({ rows }: { rows: DeptRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[14px] bg-card p-6 text-center text-sm text-fg-muted">
        No department activity yet this week.
      </p>
    );
  }
  const [leader, ...others] = rows;
  const lead = deptMeta(leader.department);

  return (
    <>
      {/* Current-leader hero card. */}
      <div
        className="rounded-2xl bg-card p-5"
        style={{
          border: "2px solid #D97706",
          boxShadow: "0 8px 36px rgba(217,119,6,0.26)",
        }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl" aria-hidden>
              {lead.icon}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-[#D97706] px-2.5 py-1 text-xs font-bold text-white">
              🥇 Current Leader
            </span>
          </div>
          <div className="text-right">
            <p className="text-[32px] font-black leading-none text-gold">
              {leader.total_aura.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-fg-muted">Total Aura</p>
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-[32px] font-black leading-none text-fg">
              {lead.abbr}
            </p>
            <p className="mt-1 text-[15px] text-fg-muted">{leader.department}</p>
          </div>
          {leader.weekly_change > 0 && (
            <span className="flex items-center gap-1 text-[13px] font-semibold text-success">
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />+
              {leader.weekly_change.toLocaleString()} this week
            </span>
          )}
        </div>
        <div className="my-4 h-px bg-white/[0.06]" />
        <div className="flex items-center gap-3">
          <AvatarStack urls={leader.avatars} />
          <span className="text-[13px] text-fg-muted">
            {leader.member_count.toLocaleString()} member
            {leader.member_count === 1 ? "" : "s"} contributing
          </span>
        </div>
      </div>

      <p className="my-4 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-disabled">
        All Departments
      </p>

      <div className="space-y-2">
        {rows.map((d, i) => {
          const m = deptMeta(d.department);
          const medal = ["🥇", "🥈", "🥉"][i];
          return (
            <div
              key={d.department}
              className="flex items-center gap-3 rounded-[12px] bg-card px-4 py-3.5"
            >
              <span className="w-6 shrink-0 text-center text-lg">
                {medal ?? (
                  <span className="text-sm font-bold text-fg-disabled">
                    {i + 1}
                  </span>
                )}
              </span>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-lg">
                {m.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-fg">
                  {m.abbr}
                </p>
                <p className="truncate text-xs text-fg-muted">{d.department}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="flex items-center justify-end gap-1 text-[15px] font-semibold text-gold">
                  <Zap className="h-3.5 w-3.5" aria-hidden />
                  {d.total_aura.toLocaleString()}
                </p>
                {d.weekly_change > 0 && (
                  <p className="flex items-center justify-end gap-0.5 text-xs text-success">
                    <ArrowUp className="h-3 w-3" aria-hidden />
                    {d.weekly_change.toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function AvatarStack({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex">
      {urls.slice(0, 4).map((u, i) => (
        <div
          key={i}
          className="relative h-7 w-7 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-card"
          style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 4 - i }}
        >
          <AppImage src={u} alt="" sizes="28px" />
        </div>
      ))}
    </div>
  );
}
