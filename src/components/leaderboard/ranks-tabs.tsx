"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  tabListClass,
  tabTriggerClass,
  TAB_INDICATOR_CLASS,
} from "@/components/ui/tab-style";
import { AuraIcon } from "@/components/ui/aura-icon";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { SkeletonRow } from "@/components/ui/skeleton";
import { LEADERBOARD_TITLES } from "@/lib/leaderboard/titles";
import { deptMeta } from "@/lib/leaderboard/departments";
import {
  fetchLeaderboard,
  type LeaderboardPeriod,
} from "@/app/(student)/leaderboard/actions";

const PERIODS: { key: LeaderboardPeriod; label: string; span: string }[] = [
  { key: "weekly", label: "Weekly", span: "This week" },
  { key: "monthly", label: "Monthly", span: "This month" },
  { key: "alltime", label: "All-Time", span: "All time" },
];

const periodSpan = (p: LeaderboardPeriod) =>
  PERIODS.find((x) => x.key === p)?.span ?? "This week";

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
  gender: string | null;
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
      <div className={cn(tabListClass(), "mb-6")}>
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
      className={tabTriggerClass(active)}
    >
      {children}
      {active && <span className={TAB_INDICATOR_CLASS} />}
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
      <PeriodPicker period={period} onSelect={select} />

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
  const span = periodSpan(period).toLowerCase();
  if (rows.length === 0) {
    return (
      <p className="rounded-[14px] bg-card p-6 text-center text-sm text-fg-muted">
        No Aura earned yet {span}. Match, post, and attend events to climb.
      </p>
    );
  }
  return (
    <>
      <div>
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
                isMe && "-mx-2 rounded-[10px] bg-fill px-2"
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
                {resolveAvatarUrl(r.avatar_url, r.gender) && (
                  <AppImage
                    src={resolveAvatarUrl(r.avatar_url, r.gender)!}
                    alt={r.full_name ?? ""}
                    sizes="48px"
                  />
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
                <AuraIcon className="h-4 w-4" />
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
  // `border` is no longer used for a container — the rows have no frames. It is
  // kept on the type so the badge/accent/pill triple stays one table.
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

function DepartmentBoard({ rows }: { rows: DeptRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[14px] bg-card p-6 text-center text-sm text-fg-muted">
        No department activity yet this week.
      </p>
    );
  }

  /*
    One row shape for every rank.

    This was three different layouts: a 2xl "hero" card for #1 with a glowing
    orange border, a differently-arranged card for #2, and a third variant for
    #3 — so the eye had to re-learn where the Aura number lived on each row, and
    the department that happened to be winning got a light-emitting box around
    it. Ranking is a comparison, and a comparison only works when the things
    being compared are laid out identically (apple.md 16: things that look the
    same must behave the same, and live in the same place).

    Rank now reads from position, the numbered badge, and a single accent on the
    Aura figure — not from the container. The frames are gone; hairlines
    separate the rows, the same way the student leaderboard above does it.
  */
  return (
    <div>
      {rows.slice(0, 3).map((d, i) => (
        <DeptRowItem key={d.department} d={d} rank={i + 1} />
      ))}
    </div>
  );
}

function DeptRowItem({ d, rank }: { d: DeptRow; rank: number }) {
  const m = deptMeta(d.department);
  const r = DEPT_RANK[rank];
  return (
    <div className="py-5">
      {/*
        Rank badge and standing pill only. The green "+N this week" delta that
        used to sit here restated the number already shown at full size on the
        right, under a scope the tab itself declares — three ways of saying one
        thing, and the only green on a screen whose colour is otherwise reserved
        for rank (apple.md 16: accent colours have jobs).
      */}
      <div className="flex items-center gap-2.5">
        <RankBadge rank={rank} />
        {r.pill && (
          <span
            className="rounded-full px-3 py-1 type-caption font-bold text-white"
            style={{ backgroundColor: r.badge }}
          >
            {r.pill}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[30px] font-black leading-none text-fg">{m.abbr}</p>
          {/* No truncation: "Fast School of Managem…" told the reader nothing
              the abbreviation above it hadn't already said. It wraps instead. */}
          <p className="type-callout mt-1.5 text-fg-muted">{d.department}</p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="flex items-center justify-end gap-1 text-[28px] font-black leading-none"
            style={{ color: r.accent ?? undefined }}
          >
            <AuraIcon
              className="h-5 w-5"
              tone={r.accent ? "inherit" : "gold"}
            />
            <span className={r.accent ? undefined : "text-fg"}>
              {d.total_aura.toLocaleString()}
            </span>
          </p>
          <p className="type-caption mt-1 text-fg-muted">Total Aura</p>
        </div>
      </div>

      <div className="mt-3">
        <ContributorRow d={d} />
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
          className="relative h-7 w-7 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-bg"
          style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 4 - i }}
        >
          <AppImage src={u} alt="" sizes="28px" />
        </div>
      ))}
    </div>
  );
}

/**
 * The scope control: "Top 10 · This week", with a menu for the other periods.
 *
 * This replaces a row of three filled pills sitting directly above a
 * `TOP 10 THIS WEEK` caps label — two elements saying the same thing, one of
 * them the third-largest block of purple on the screen. Collapsing them into a
 * single line means the scope is stated once, in the place you would change it
 * (apple.md §16 — place a control next to what it affects; §6 — adding context
 * can simplify).
 *
 * Closed by a click anywhere outside and by Escape, so it never traps focus.
 */
function PeriodPicker({
  period,
  onSelect,
}: {
  period: LeaderboardPeriod;
  onSelect: (p: LeaderboardPeriod) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="pressable focus-ring -ml-2 flex items-center gap-2 rounded-lg px-2 py-2 type-callout"
      >
        <CalendarDays className="h-[18px] w-[18px] text-fg-muted" aria-hidden />
        <span className="text-fg-muted">Top 10</span>
        <span aria-hidden className="text-fg-disabled">
          ·
        </span>
        <span className="font-semibold text-fg">{periodSpan(period)}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-fg-muted transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="material-panel absolute left-0 top-full z-30 mt-1 min-w-[11rem] overflow-hidden rounded-[12px] border border-glass-border"
        >
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="menuitemradio"
              aria-checked={p.key === period}
              onClick={() => {
                onSelect(p.key);
                setOpen(false);
              }}
              className={cn(
                "pressable flex w-full items-center justify-between gap-4 px-3.5 py-2.5 text-left type-callout",
                p.key === period ? "font-semibold text-fg" : "text-fg-muted"
              )}
            >
              {p.label}
              {p.key === period && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
