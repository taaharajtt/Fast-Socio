"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Heart, X, MessageCircle, RotateCcw, Flag, Info, Zap } from "lucide-react";
import { GlassButton, GlassChip, GlassSheet, GlassInput } from "@/components/ui";
import { VerifiedBadge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import type { DiscoverProfile } from "@/lib/profile/types";
import { ReportSheet } from "@/components/discover/report-sheet";
import {
  recordSwipe,
  sendMessageRequest,
  fetchCandidates,
  undoSwipe,
} from "@/app/(student)/discover/actions";

const SWIPE_THRESHOLD = 110;

export function SwipeDeck({
  initial,
}: {
  initial: DiscoverProfile[];
}) {
  const [deck, setDeck] = useState<DiscoverProfile[]>(initial);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<DiscoverProfile | null>(null);
  const [reportFor, setReportFor] = useState<DiscoverProfile | null>(null);
  const [detailFor, setDetailFor] = useState<DiscoverProfile | null>(null);
  const [lastSwiped, setLastSwiped] = useState<DiscoverProfile | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const top = deck[0];

  const advance = useCallback(() => {
    setDeck((d) => {
      const next = d.slice(1);
      if (next.length <= 2) {
        // Top up in the background when the deck runs low.
        fetchCandidates(20).then((more) => {
          if (more.length) {
            setDeck((cur) => {
              const seen = new Set(cur.map((c) => c.id));
              return [...cur, ...more.filter((m) => !seen.has(m.id))];
            });
          }
        });
      }
      return next;
    });
  }, []);

  const act = useCallback(
    async (profile: DiscoverProfile, direction: "like" | "pass") => {
      // Optimistic: advance immediately, then persist. Offer a 3s undo window.
      advance();
      setLastSwiped(profile);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setLastSwiped(null), 3000);
      const res = await recordSwipe(profile.id, direction);
      if (res.ok && res.matched) setMatchName(profile.full_name ?? "Someone");
    },
    [advance]
  );

  // Clear any pending undo timer if the deck unmounts mid-window.
  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  const undo = useCallback(async () => {
    if (!lastSwiped) return;
    const p = lastSwiped;
    setLastSwiped(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setMatchName(null);
    setDeck((d) => (d.some((c) => c.id === p.id) ? d : [p, ...d]));
    await undoSwipe(p.id);
  }, [lastSwiped]);

  // Keyboard fallback for desktop (OQ-13): ← Pass, → Like, M Message.
  useEffect(() => {
    if (!top || sheetFor || matchName || reportFor || detailFor) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") act(top, "pass");
      else if (e.key === "ArrowRight") act(top, "like");
      else if (e.key.toLowerCase() === "m") setSheetFor(top);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top, sheetFor, matchName, reportFor, detailFor, act]);

  if (!top) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <RotateCcw className="mb-3 h-8 w-8 text-fg-muted" aria-hidden />
        <p className="text-lg font-medium">You&rsquo;re all caught up</p>
        <p className="mt-1 text-fg-muted">
          Check back later for new people on campus.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col">
      <div className="relative mx-auto aspect-[3/4.4] w-full max-w-sm flex-1">
        {deck
          .slice(0, 3)
          .map((p, i) =>
            i === 0 ? (
              <TopCard
                key={p.id}
                profile={p}
                onDecision={act}
                onExpand={() => setDetailFor(p)}
              />
            ) : (
              <StackedCard key={p.id} index={i} />
            )
          )
          .reverse()}
      </div>

      {/* Undo affordance (CR-009, edge case 5): appears ~3s after a swipe. */}
      {lastSwiped && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={undo}
            className="glass flex items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Undo {lastSwiped.full_name?.split(" ")[0] ?? "swipe"}
          </button>
        </div>
      )}

      {/* Action row (UISpec V3 Screen 5): Pass 56 · Message 56 · Like 64 (glow). */}
      <div className="mt-5 flex items-center justify-center gap-6">
        <button
          type="button"
          aria-label="Pass"
          onClick={() => act(top, "pass")}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-card text-fg-muted transition-all hover:text-fg active:scale-90"
        >
          <X className="h-6 w-6" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Message"
          onClick={() => setSheetFor(top)}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-card text-fg-muted transition-all hover:text-fg active:scale-90"
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Like"
          onClick={() => act(top, "like")}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_24px_rgba(124,58,237,0.5)] transition-all hover:bg-accent-light active:scale-90"
        >
          <Heart className="h-7 w-7" aria-hidden />
        </button>
      </div>

      <MessageRequestSheet
        profile={sheetFor}
        onClose={() => setSheetFor(null)}
      />
      <ReportSheet profile={reportFor} onClose={() => setReportFor(null)} />
      <DetailSheet
        profile={detailFor}
        onClose={() => setDetailFor(null)}
        onReport={(p) => {
          setDetailFor(null);
          setReportFor(p);
        }}
      />
      {matchName && (
        <MatchOverlay name={matchName} onClose={() => setMatchName(null)} />
      )}
    </div>
  );
}

function TopCard({
  profile,
  onDecision,
  onExpand,
}: {
  profile: DiscoverProfile;
  onDecision: (p: DiscoverProfile, d: "like" | "pass") => void;
  onExpand: () => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const likeOpacity = useTransform(x, [40, 140], [0, 1]);
  const passOpacity = useTransform(x, [-140, -40], [1, 0]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD) onDecision(profile, "like");
    else if (info.offset.x < -SWIPE_THRESHOLD) onDecision(profile, "pass");
  }

  return (
    <motion.div
      className="absolute inset-0 cursor-grab active:cursor-grabbing"
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={onDragEnd}
      whileTap={{ scale: 0.98 }}
    >
      <ProfileCardBody profile={profile}>
        {/* Full-profile + report affordance (kept subtle so it doesn't clash
            with the V3 name badge / aura pill overlays). Report lives inside. */}
        <button
          type="button"
          aria-label="View full profile"
          onPointerDownCapture={(e) => e.stopPropagation()}
          onClick={onExpand}
          className="absolute bottom-4 right-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/90 hover:bg-black/60 hover:text-white"
        >
          <Info className="h-4 w-4" aria-hidden />
        </button>
        <motion.div
          style={{ opacity: likeOpacity }}
          className="absolute left-5 top-20 rounded-xl border-2 border-success px-3 py-1 text-lg font-extrabold uppercase text-success"
        >
          Like
        </motion.div>
        <motion.div
          style={{ opacity: passOpacity }}
          className="absolute right-5 top-20 rounded-xl border-2 border-error px-3 py-1 text-lg font-extrabold uppercase text-error"
        >
          Pass
        </motion.div>
      </ProfileCardBody>
    </motion.div>
  );
}

function StackedCard({ index }: { index: number }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        transform: `scale(${1 - index * 0.04}) translateY(${index * 12}px)`,
        opacity: 1 - index * 0.25,
        zIndex: -index,
      }}
    >
      <div className="h-full w-full rounded-3xl bg-card" />
    </div>
  );
}

function ProfileCardBody({
  profile,
  children,
}: {
  profile: DiscoverProfile;
  children?: React.ReactNode;
}) {
  const firstName = profile.full_name?.split(" ")[0] ?? "Student";
  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl bg-card">
      {profile.avatar_url ? (
        <AppImage
          src={profile.avatar_url}
          alt={profile.full_name ?? "Profile"}
          sizes="(max-width: 448px) 100vw, 384px"
          draggable={false}
          priority
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-bg-elevated text-fg-muted">
          No photo
        </div>
      )}

      {/* TOP OVERLAY (UISpec V3 Screen 5) — name badge (top-left) + aura pill
          (top-right). Dark pill backings stay legible over any photo without a
          per-frame backdrop blur. */}
      <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5">
        <Zap className="h-3 w-3 text-gold-text" aria-hidden />
        <span className="text-[13px] font-semibold text-white">{firstName}</span>
      </div>
      <div className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1">
        <Zap className="h-3 w-3 text-gold-text" aria-hidden />
        <span className="text-[13px] font-semibold text-gold-text">
          {profile.aura_score.toLocaleString()}
        </span>
      </div>

      {/* BOTTOM OVERLAY — gradient fade + identity. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5 pt-20">
        <h2 className="flex items-center gap-1.5 text-[22px] font-bold text-white">
          {profile.full_name ?? "Student"}
          {profile.verified && <VerifiedBadge size={16} />}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          {profile.department ?? ""}
          {profile.semester ? ` · ${ordinal(profile.semester)} Semester` : ""}
        </p>
        {profile.bio && (
          <p className="mt-1.5 line-clamp-2 text-sm text-white">{profile.bio}</p>
        )}
        {profile.interests?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {profile.interests.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs text-white"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** 1 → "1st", 6 → "6th", etc. (UISpec V3 "6th Semester"). */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function MessageRequestSheet({
  profile,
  onClose,
}: {
  profile: DiscoverProfile | null;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!profile) return;
    setSending(true);
    setError(null);
    const res = await sendMessageRequest(profile.id, message);
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(true);
    setMessage("");
    setTimeout(() => {
      setSent(false);
      onClose();
    }, 1200);
  }

  return (
    <GlassSheet open={Boolean(profile)} onClose={onClose}>
      {profile && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold">
            Message {profile.full_name ?? "them"}
          </h3>
          <p className="text-sm text-fg-muted">
            Send an opening message to start a conversation.
          </p>
          <GlassInput
            placeholder="Hey! Loved your bio…"
            value={message}
            maxLength={500}
            onChange={(e) => setMessage(e.target.value)}
            disabled={sending || sent}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-muted">{message.length}/500</span>
            <GlassButton
              size="md"
              onClick={send}
              disabled={sending || sent || message.trim().length === 0}
            >
              {sent ? "Sent ✓" : sending ? "Sending…" : "Send request"}
            </GlassButton>
          </div>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
        </div>
      )}
    </GlassSheet>
  );
}

function DetailSheet({
  profile,
  onClose,
  onReport,
}: {
  profile: DiscoverProfile | null;
  onClose: () => void;
  onReport: (p: DiscoverProfile) => void;
}) {
  return (
    <GlassSheet open={Boolean(profile)} onClose={onClose}>
      {profile && (
        <div className="space-y-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-2xl font-bold">
              {profile.full_name ?? "Student"}
              {profile.verified && <VerifiedBadge size={18} />}
            </h3>
            <p className="text-fg-muted">
              {profile.department ?? ""}
              {profile.semester ? ` · Semester ${profile.semester}` : ""}
            </p>
          </div>
          <GlassChip tone="aura">★ {profile.aura_score} Aura</GlassChip>
          {profile.bio && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-fg-muted">About</h4>
              <p className="text-[15px]">{profile.bio}</p>
            </div>
          )}
          {profile.interests?.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-fg-muted">
                Interests
              </h4>
              <div className="flex flex-wrap gap-2">
                {profile.interests.map((tag) => (
                  <GlassChip key={tag}>{tag}</GlassChip>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => onReport(profile)}
            className="flex items-center gap-2 pt-1 text-sm font-medium text-error/90 hover:text-error"
          >
            <Flag className="h-4 w-4" aria-hidden />
            Report {profile.full_name?.split(" ")[0] ?? "profile"}
          </button>
        </div>
      )}
    </GlassSheet>
  );
}

function MatchOverlay({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 px-6 text-center backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 18 }}
      >
        <h2 className="gradient-brand-text text-5xl font-extrabold">
          It&rsquo;s a match!
        </h2>
        <p className="mt-3 text-lg text-white/80">
          You and {name} liked each other.
        </p>
        <p className="mt-1 text-sm text-aura">+10 Aura</p>
        <GlassButton
          className={cn("mt-8")}
          size="lg"
          onClick={onClose}
        >
          Keep swiping
        </GlassButton>
      </motion.div>
    </motion.div>
  );
}
