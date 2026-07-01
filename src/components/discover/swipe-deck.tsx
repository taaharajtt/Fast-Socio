"use client";

import { useCallback, useEffect, useState } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Heart, X, Mail, RotateCcw, Flag } from "lucide-react";
import { GlassButton, GlassChip, GlassSheet, GlassInput } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { DiscoverProfile } from "@/lib/profile/types";
import { ReportSheet } from "@/components/discover/report-sheet";
import {
  recordSwipe,
  sendMessageRequest,
  fetchCandidates,
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
      advance();
      const res = await recordSwipe(profile.id, direction);
      if (res.ok && res.matched) setMatchName(profile.full_name ?? "Someone");
    },
    [advance]
  );

  // Keyboard fallback for desktop (OQ-13): ← Pass, → Like, M Message.
  useEffect(() => {
    if (!top || sheetFor || matchName || reportFor) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") act(top, "pass");
      else if (e.key === "ArrowRight") act(top, "like");
      else if (e.key.toLowerCase() === "m") setSheetFor(top);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top, sheetFor, matchName, reportFor, act]);

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
                onReport={() => setReportFor(p)}
              />
            ) : (
              <StackedCard key={p.id} index={i} />
            )
          )
          .reverse()}
      </div>

      {/* Action row (UI Spec §5.6: Pass / Message / Like) */}
      <div className="mt-5 flex items-center justify-center gap-6">
        <GlassButton
          variant="glass"
          size="icon"
          className="h-14 w-14"
          aria-label="Pass"
          onClick={() => act(top, "pass")}
        >
          <X className="h-6 w-6 text-error" aria-hidden />
        </GlassButton>
        <GlassButton
          variant="glass"
          size="icon"
          className="h-12 w-12"
          aria-label="Message"
          onClick={() => setSheetFor(top)}
        >
          <Mail className="h-5 w-5 text-cyan" aria-hidden />
        </GlassButton>
        <GlassButton
          variant="primary"
          size="icon"
          className="h-14 w-14"
          aria-label="Like"
          onClick={() => act(top, "like")}
        >
          <Heart className="h-6 w-6" aria-hidden />
        </GlassButton>
      </div>

      <MessageRequestSheet
        profile={sheetFor}
        onClose={() => setSheetFor(null)}
      />
      <ReportSheet profile={reportFor} onClose={() => setReportFor(null)} />
      {matchName && (
        <MatchOverlay name={matchName} onClose={() => setMatchName(null)} />
      )}
    </div>
  );
}

function TopCard({
  profile,
  onDecision,
  onReport,
}: {
  profile: DiscoverProfile;
  onDecision: (p: DiscoverProfile, d: "like" | "pass") => void;
  onReport: () => void;
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
        <button
          type="button"
          aria-label="Report"
          onPointerDownCapture={(e) => e.stopPropagation()}
          onClick={onReport}
          className="glass absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:text-white"
        >
          <Flag className="h-4 w-4" aria-hidden />
        </button>
        <motion.div
          style={{ opacity: likeOpacity }}
          className="absolute left-5 top-5 rounded-xl border-2 border-success px-3 py-1 text-lg font-extrabold uppercase text-success"
        >
          Like
        </motion.div>
        <motion.div
          style={{ opacity: passOpacity }}
          className="absolute right-5 top-5 rounded-xl border-2 border-error px-3 py-1 text-lg font-extrabold uppercase text-error"
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
      <div className="glass h-full w-full rounded-[36px]" />
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
  return (
    <div className="glass relative h-full w-full overflow-hidden rounded-[36px]">
      {profile.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.avatar_url}
          alt={profile.full_name ?? "Profile"}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-bg-elevated text-fg-muted">
          No photo
        </div>
      )}

      {/* Aura chip overlaid top-right (UI Spec §5.6) */}
      <div className="absolute right-4 top-4">
        <GlassChip tone="aura">★ {profile.aura_score}</GlassChip>
      </div>

      {/* Gradient scrim + identity (bottom third) */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5 pt-16">
        <h2 className="text-2xl font-bold text-white">
          {profile.full_name ?? "Student"}
        </h2>
        <p className="text-white/80">
          {profile.department ?? ""}
          {profile.semester ? ` · Semester ${profile.semester}` : ""}
        </p>
        {profile.bio && (
          <p className="mt-1 line-clamp-2 text-sm text-white/70">
            {profile.bio}
          </p>
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
          {error && <p className="text-sm text-error">{error}</p>}
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
