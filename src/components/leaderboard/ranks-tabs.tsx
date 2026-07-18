"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
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
      {/* Underlined text tabs (Leaderboard refresh). */}
      <div className="mb-5 flex border-b border-white/[0.08]">
        <Tab active={tab === "students"} onClick={() => setTab("students")}>
          Leaderboard
        </Tab>
        <Tab active={tab === "depts"} onClick={() => setTab("depts")}>
          Department Rankings
        </Tab>
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

function Tab({
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
        "relative flex-1 pb-3 text-center text-[17px] font-semibold transition-colors",
        active ? "text-fg" : "text-fg-muted hover:text-fg"
      )}
    >
      {children}
      {/* Purple underline for the active tab, sitting on top of the hairline. */}
      {active && (
        <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent" />
      )}
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
              "rounded-full px-4 py-2 text-[15px] font-semibold transition-all active:scale-95",
              period === p.key
                ? "gradient-brand text-white shadow-[0_4px_16px_rgba(124,58,237,0.4)]"
                : "text-fg-muted hover:text-fg"
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
      <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-disabled">
        Top {rows.length} {span}
      </p>
      <div className="divide-y divide-white/[0.06]">
        {rows.map((r) => {
          const medal = MEDAL[r.rank];
          const title = LEADERBOARD_TITLES[r.rank]?.title;
          const isMe = r.user_id === meId;
          return (
            // Tapping a row opens that student's profile (your own row goes to
            // your profile) — avatars are tappable everywhere else in the app.
            <Link
              key={r.user_id}
              href={isMe ? "/profile" : `/profile/${r.user_id}`}
              className={cn(
                "flex items-center gap-3.5 py-3.5 transition-transform active:scale-[0.99]",
                isMe && "-mx-2 rounded-[12px] bg-accent/[0.10] px-2"
              )}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold"
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
                className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-bg-elevated"
                style={medal ? { boxShadow: `0 0 0 2px ${medal.ring}` } : undefined}
              >
                {r.avatar_url && (
                  <AppImage src={r.avatar_url} alt={r.full_name ?? ""} sizes="48px" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold text-fg">
                  {r.full_name ?? "Student"}
                </p>
                <p className="truncate text-[14px] text-fg-muted">
                  {deptMeta(r.department).abbr}
                  {title && (
                    <>
                      {" · "}
                      <span style={{ color: medal?.chip }}>{title}</span>
                    </>
                  )}
                </p>
              </div>

              <span className="flex shrink-0 items-center gap-1 text-[17px] font-semibold text-gold">
                <Zap className="h-4 w-4" aria-hidden />
                {r.weekly_aura.toLocaleString()}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

/**
 * Per-rank styling for the three department cards (Leaderboard refresh). Ranks 1
 * and 3 get an orange frame, rank 2 a muted silver one — mirroring the medal
 * palette used on the student board. Only the top two carry a status pill.
 */
const DEPT_RANK: Record<
  number,
  {
    border: string;
    badge: string;
    accent: string | null;
    pill: string | null;
  }
> = {
  1: { border: "#D97706", badge: "#D97706", accent: "#F59E0B", pill: "Current Leader" },
  2: { border: "rgba(148,163,184,0.30)", badge: "#9CA3AF", accent: null, pill: "Runner-Up" },
  3: { border: "#F97316", badge: "#F97316", accent: "#F97316", pill: null },
};

function RankBadge({ rank }: { rank: number }) {
  const r = DEPT_RANK[rank];
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[14px] font-bold"
      style={{ borderColor: r.badge, color: r.badge }}
    >
      {rank}
    </span>
  );
}

function ContributorRow({ d }: { d: DeptRow }) {
  return (
    <div className="flex items-center gap-2.5">
      <AvatarStack urls={d.avatars} />
      <span className="text-[13px] text-fg-muted">
        {d.member_count.toLocaleString()} member
        {d.member_count === 1 ? "" : "s"} contributing
      </span>
    </div>
  );
}

function WeeklyChange({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-success">
      <ArrowUp className="h-3.5 w-3.5" aria-hidden />+{value.toLocaleString()} this
      week
    </span>
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

  const top3 = rows.slice(0, 3);
  return (
    <div className="space-y-3">
      {top3.map((d, i) =>
        i === 0 ? (
          <LeaderCard key={d.department} d={d} />
        ) : (
          <DeptCard key={d.department} d={d} rank={i + 1} />
        )
      )}
    </div>
  );
}

/** Rank-1 hero card. */
function LeaderCard({ d }: { d: DeptRow }) {
  const m = deptMeta(d.department);
  const r = DEPT_RANK[1];
  return (
    <div
      className="rounded-2xl bg-card p-5"
      style={{
        border: `2px solid ${r.border}`,
        boxShadow: "0 8px 36px rgba(217,119,6,0.26)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <RankBadge rank={1} />
          <span
            className="rounded-full px-3 py-1 text-[13px] font-bold text-white"
            style={{ backgroundColor: r.badge }}
          >
            {r.pill}
          </span>
        </div>
        <div className="text-right">
          <p
            className="text-[32px] font-black leading-none"
            style={{ color: r.accent ?? undefined }}
          >
            {d.total_aura.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-fg-muted">Total Aura</p>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[32px] font-black leading-none text-fg">{m.abbr}</p>
          <p className="mt-1.5 truncate text-[15px] text-fg-muted">
            {d.department}
          </p>
        </div>
        <WeeklyChange value={d.weekly_change} />
      </div>

      <div className="my-4 h-px bg-white/[0.06]" />
      <ContributorRow d={d} />
    </div>
  );
}

/** Compact card for ranks 2 and 3. */
function DeptCard({ d, rank }: { d: DeptRow; rank: number }) {
  const m = deptMeta(d.department);
  const r = DEPT_RANK[rank];
  return (
    <div
      className="rounded-2xl bg-card p-4"
      style={{ border: `2px solid ${r.border}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <RankBadge rank={rank} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[22px] font-black leading-none text-fg">
                {m.abbr}
              </p>
              {r.pill && (
                <span className="rounded-full bg-[#64748B] px-2.5 py-0.5 text-[12px] font-bold text-white">
                  {r.pill}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-[14px] text-fg-muted">
              {d.department}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="flex items-center justify-end gap-1 text-[24px] font-black leading-none"
            style={{ color: r.accent ?? undefined }}
          >
            <Zap
              className={cn("h-4 w-4", !r.accent && "text-fg-muted")}
              aria-hidden
            />
            <span className={r.accent ? undefined : "text-fg"}>
              {d.total_aura.toLocaleString()}
            </span>
          </p>
          <p className="mt-1 text-xs text-fg-muted">Total Aura</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <ContributorRow d={d} />
        <WeeklyChange value={d.weekly_change} />
      </div>
    </div>
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
