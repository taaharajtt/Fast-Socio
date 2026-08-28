"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Heart, X, MessageCircle, RotateCcw, Flag, Info, Check } from "lucide-react";
import { GlassButton, GlassChip, GlassSheet, GlassInput } from "@/components/ui";
import { MotionReduced } from "@/components/ui/motion-reduced";
import { VerifiedBadge } from "@/components/ui";
import { AuraIcon } from "@/components/ui/aura-icon";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import type { DiscoverProfile } from "@/lib/profile/types";
import { semesterLabel } from "@/lib/profile/constants";
import { ReportSheet } from "@/components/discover/report-sheet";
import { IntentCardBody } from "@/components/discover/intent-card";
import {
  KIND_CAPSULE,
  SWIPE_CONFIRMATION,
  type DiscoverSwipeCard,
  type IntentKind,
} from "@/lib/discover/cards";
import {
  createDeckPager,
  restoreCard,
  type DiscoverDeckPage,
} from "@/lib/discover/deck-pager";
import { beginSwipe, endSwipe } from "@/lib/discover/swipe-guard";
import { safeMatchingDisplay } from "@/lib/smart-match/display";
import {
  recordSwipe,
  sendMessageRequest,
  undoSwipe,
} from "@/app/(student)/discover/actions";
import {
  getDiscoverSwipeDeck,
  respondToDiscoverPost,
  passDiscoverPost,
  unpassDiscoverPost,
  cancelDiscoverResponse,
  reportDiscoverPost,
} from "@/app/(student)/discover/discover-actions";

const SWIPE_THRESHOLD = 110;

/** An intent card, narrowed out of the union. */
type IntentCard = Extract<DiscoverSwipeCard, { kind: IntentKind }>;

/** What we need to undo the last swipe, whichever kind it was. */
type LastSwipe =
  | { card: DiscoverSwipeCard; kind: "socio" }
  | { card: IntentCard; kind: "intent"; direction: "like" | "pass"; responseId: string | null };

/**
 * Discover's one and only surface: a single swipe deck of mixed cards. SOCIO
 * people and campus opportunities are shuffled together and handled with the
 * same two gestures — right to act, left to dismiss. The SOCIO path (swipes,
 * matches, message requests, undo, the recycle-when-caught-up top-up) is
 * unchanged from the original deck; intents ride the same rails with their own
 * verbs underneath.
 */
export function SwipeDeck({ initial }: { initial: DiscoverDeckPage }) {
  const [deck, setDeck] = useState<DiscoverSwipeCard[]>(initial.cards);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<DiscoverProfile | null>(null);
  const [reportFor, setReportFor] = useState<DiscoverProfile | null>(null);
  const [detailFor, setDetailFor] = useState<DiscoverSwipeCard | null>(null);
  const [lastSwiped, setLastSwiped] = useState<LastSwipe | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keys whose swipe is optimistically applied but not yet persisted. Two jobs:
  // excluded from top-ups so a card can't be re-added by a fetch that races its
  // write, AND the duplicate-submission guard (see `beginSwipe`) — drag, button
  // and keyboard all funnel through it, so one visible card submits once.
  const inFlight = useRef<Set<string>>(new Set());
  // True once BOTH server feeds have said they have nothing left. This — never
  // "the local array is empty" — gates "You're all caught up".
  const [refilling, setRefilling] = useState(false);
  const [exhausted, setExhausted] = useState(
    () => !initial.socioHasMore && !initial.intentHasMore
  );

  // The pager owns continuation state (SOCIO exclusion set + opportunity
  // keyset), refill serialisation and the session's seen-card set. Passed
  // profiles are recycled by the RPC, and the exclusion set means that recycle
  // round runs at most ONCE per mounted session: a reload starts a fresh pager,
  // so passed people surface again next session, exactly as before.
  const pagerRef = useRef<ReturnType<typeof createDeckPager> | null>(null);
  if (pagerRef.current == null) {
    pagerRef.current = createDeckPager({
      initial,
      fetchPage: (req) => getDiscoverSwipeDeck(req),
    });
  }

  const top = deck[0];

  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // Pull the NEXT page and append what's new. Overlapping calls are collapsed
  // by the pager: a top-up requested while one is running queues a follow-up
  // round instead of being dropped, so the swipe that empties the deck always
  // ends up triggering a fetch.
  const topUp = useCallback(async () => {
    const pager = pagerRef.current!;
    setRefilling(true);
    await pager.refill((cards) => {
      setDeck((cur) => {
        const have = new Set(cur.map((c) => c.key));
        const add = cards.filter(
          (m) => !have.has(m.key) && !inFlight.current.has(m.key)
        );
        return add.length ? [...cur, ...add] : cur;
      });
    });
    setRefilling(pager.isRefilling);
    setExhausted(pager.isExhausted);
  }, []);

  const advance = useCallback(() => {
    setDeck((d) => {
      const next = d.slice(1);
      if (next.length <= 2) void topUp();
      return next;
    });
  }, [topUp]);

  /**
   * A swipe that did NOT persist must not count as traversed: put the card back
   * at the top of the deck, drop the undo affordance (there is nothing to undo)
   * and say what went wrong.
   */
  const restore = useCallback(
    (card: DiscoverSwipeCard, message: string) => {
      endSwipe(inFlight.current, card.key);
      setLastSwiped(null);
      setDeck((d) => restoreCard(d, card));
      flash(message || "That didn’t save — try again.");
    },
    [flash]
  );

  const act = useCallback(
    async (card: DiscoverSwipeCard, direction: "like" | "pass") => {
      // FIRST: claim the card. Drag release, button tap and keyboard arrow all
      // land here, and the handler is async, so without this the same visible
      // card could be submitted twice — two writes, two burst-quota entries and
      // an undo stack out of step with what the user saw. An ignored duplicate
      // returns before any optimistic change.
      if (!beginSwipe(inFlight.current, card.key)) return;
      // Optimistic: advance immediately, then persist. Offer a 3s undo window.
      advance();
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setLastSwiped(null), 3000);

      if (card.kind === "socio") {
        setLastSwiped({ card, kind: "socio" });
        const res = await recordSwipe(card.id, direction);
        endSwipe(inFlight.current, card.key);
        if (!res.ok) {
          restore(card, res.error);
          return;
        }
        if (res.matched) setMatchName(card.profile.full_name ?? "Someone");
      } else if (direction === "like") {
        const res = await respondToDiscoverPost(card.id);
        endSwipe(inFlight.current, card.key);
        if (res.ok) {
          setLastSwiped({
            card,
            kind: "intent",
            direction: "like",
            responseId: res.responseId,
          });
          flash(SWIPE_CONFIRMATION[card.kind]);
        } else {
          restore(card, res.error);
          return;
        }
      } else {
        setLastSwiped({ card, kind: "intent", direction: "pass", responseId: null });
        const res = await passDiscoverPost(card.id);
        endSwipe(inFlight.current, card.key);
        if (res && !res.ok) {
          restore(card, res.error);
          return;
        }
      }

      // Now that the decision is persisted, if that was the last card, refill.
      setDeck((d) => {
        if (d.length === 0) void topUp();
        return d;
      });
    },
    [advance, topUp, flash, restore]
  );

  // The deck can empty while the sources still have pages left (an early page
  // that was entirely duplicates, or a refill that lost a race). Keep asking
  // until either cards arrive or the pager declares itself exhausted — the
  // pager's empty-round guard is what makes this terminate.
  useEffect(() => {
    if (deck.length > 0 || exhausted || refilling) return;
    // Scheduled rather than called inline: the refill sets state, and an effect
    // body that does so synchronously cascades renders.
    const t = setTimeout(() => void topUp(), 0);
    return () => clearTimeout(t);
  }, [deck.length, exhausted, refilling, topUp]);

  // Clear pending timers if the deck unmounts mid-window.
  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const undo = useCallback(async () => {
    if (!lastSwiped) return;
    const entry = lastSwiped;
    setLastSwiped(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setMatchName(null);
    setToast(null);
    setDeck((d) => restoreCard(d, entry.card));
    if (entry.kind === "socio") await undoSwipe(entry.card.id);
    else if (entry.direction === "pass") await unpassDiscoverPost(entry.card.id);
    else if (entry.responseId) await cancelDiscoverResponse(entry.responseId);
  }, [lastSwiped]);

  // Keyboard fallback for desktop (OQ-13): ← Pass, → Like, M Message/details.
  useEffect(() => {
    if (!top || sheetFor || matchName || reportFor || detailFor) return;
    function onKey(e: KeyboardEvent) {
      if (!top) return;
      if (e.key === "ArrowLeft") act(top, "pass");
      else if (e.key === "ArrowRight") act(top, "like");
      else if (e.key.toLowerCase() === "m") {
        if (top.kind === "socio") setSheetFor(top.profile);
        else setDetailFor(top);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top, sheetFor, matchName, reportFor, detailFor, act]);

  // An empty deck is NOT the same as an empty campus. While either feed may
  // still have something — or a refill is in flight — this is a loading state;
  // only the pager's authoritative exhaustion earns "You're all caught up".
  if (!top) {
    if (!exhausted || refilling) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div
            className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-fg-muted/30 border-t-fg-muted"
            aria-hidden
          />
          <p className="text-fg-muted" role="status">
            Finding more people&hellip;
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <RotateCcw className="mb-3 h-8 w-8 text-fg-muted" aria-hidden />
        <p className="text-lg font-medium">You&rsquo;re all caught up</p>
        <p className="mt-1 text-fg-muted">
          Check back later for new people and opportunities on campus.
        </p>
      </div>
    );
  }

  const topIsSocio = top.kind === "socio";

  return (
    <MotionReduced>
      {/* `justify-center` is the composition fix: the card is sized by its
         aspect ratio, so on anything taller than an SE the leftover space all
         collected BELOW the action row and the whole screen sat high, with a
         band of nothing above the dock. Centring splits that slack above and
         below, so the card floats in the viewport and the controls sit under
         it with matching air on both sides. On short phones there is no slack
         to split and this is inert — the ratio still shrinks as before. */}
      <div className="relative flex min-h-0 flex-1 flex-col justify-center">
        {/* The aspect ratio is the ONLY thing that sizes the card stack. There
            used to be a `flex-1` here too, which was inert only because no
            ancestor had a definite height — the moment the shell became a real
            flex column it started winning over the ratio, stretching the stack
            until the action row below was pushed off screen.
            The default `flex: 0 1 auto` already says exactly what we want —
            size to the ratio, but shrink if the space isn't there. It only
            works with `min-h-0` on this element AND on every flex ancestor up
            to the shell, because a flex item's automatic minimum size would
            otherwise refuse to shrink and push the action row off screen on
            SE-class phones (~667px tall). Percentage caps like `max-h-full`
            do NOT work here: the shell sizes itself with min-height, so the
            ancestors' computed height is `auto` and the percentage never
            resolves. */}
        <div className="relative mx-auto aspect-[3/4.4] max-h-[calc(var(--shell-content-h)-var(--deck-chrome))] w-full min-h-0 max-w-sm">
          {deck
            .slice(0, 3)
            .map((c, i) =>
              i === 0 ? (
                <TopCard
                  key={c.key}
                  card={c}
                  onDecision={act}
                  onExpand={() => setDetailFor(c)}
                />
              ) : (
                <StackedCard key={c.key} card={c} index={i} />
              )
            )
            .reverse()}

          {/* Undo pill / transient toast — floats above the card stack as an
              overlay so it never pushes the action row below out of place. */}
          <AnimatePresence>
            {toast ? (
              <motion.div
                key="toast"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2"
              >
                <span className="glass inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium">
                  <Check className="h-4 w-4 text-success" aria-hidden />
                  {toast}
                </span>
              </motion.div>
            ) : lastSwiped ? (
              <motion.div
                key="undo"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="pointer-events-auto absolute bottom-3 left-1/2 z-30 -translate-x-1/2"
              >
                <button
                  type="button"
                  onClick={undo}
                  className="glass flex items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Undo{" "}
                  {lastSwiped.kind === "socio"
                    ? (lastSwiped.card.kind === "socio"
                        ? lastSwiped.card.profile.full_name?.split(" ")[0]
                        : null) ?? "swipe"
                    : "swipe"}
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/*
          Action row: Pass · Message · Like. On an intent card the middle button
          opens details instead of a DM — you can't message someone before they
          accept.

          Like was a solid accent disc with a coloured halo, which made it the
          brightest object on the screen — brighter than the photograph it is a
          verdict on. It rests as a neutral off-white RING and turns FILLED
          PURPLE only while you are pressing it: the heart carries the verdict,
          the disc does not light up around it. Still unmistakably the
          affirmative and still the largest target, but it frames the decision
          instead of shouting it. Pass and Message sit on a neutral fill so the
          only hue down here belongs to the one control that means "yes"
          (apple.md §16 — accent colours have jobs).
        */}
        <div className="mt-7 flex items-center justify-center gap-6">
          <button
            type="button"
            aria-label="Pass"
            onClick={() => act(top, "pass")}
            className="pressable focus-ring flex h-14 w-14 items-center justify-center rounded-full bg-fill text-fg-muted hover:text-fg"
          >
            <X className="h-6 w-6" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={topIsSocio ? "Message" : "Details"}
            onClick={() =>
              topIsSocio ? setSheetFor(top.profile) : setDetailFor(top)
            }
            className="pressable focus-ring flex h-14 w-14 items-center justify-center rounded-full bg-fill text-fg-muted hover:text-fg"
          >
            {topIsSocio ? (
              <MessageCircle className="h-6 w-6" aria-hidden />
            ) : (
              <Info className="h-6 w-6" aria-hidden />
            )}
          </button>
          <button
            type="button"
            aria-label={topIsSocio ? "Like" : "Request"}
            onClick={() => act(top, "like")}
            className={cn(
              "group pressable focus-ring flex h-16 w-16 items-center justify-center rounded-full",
              "border-2 border-emphasis text-emphasis",
              "active:border-accent active:bg-accent/10 active:text-accent"
            )}
          >
            {topIsSocio ? (
              <Heart
                className="h-7 w-7 group-active:fill-current"
                aria-hidden
              />
            ) : (
              <Check className="h-7 w-7" aria-hidden />
            )}
          </button>
        </div>

        <MessageRequestSheet profile={sheetFor} onClose={() => setSheetFor(null)} />
        <ReportSheet profile={reportFor} onClose={() => setReportFor(null)} />
        <DetailSheet
          card={detailFor}
          onClose={() => setDetailFor(null)}
          onReportProfile={(p) => {
            setDetailFor(null);
            setReportFor(p);
          }}
        />
        {matchName && (
          <MatchOverlay name={matchName} onClose={() => setMatchName(null)} />
        )}
      </div>
    </MotionReduced>
  );
}

function TopCard({
  card,
  onDecision,
  onExpand,
}: {
  card: DiscoverSwipeCard;
  onDecision: (c: DiscoverSwipeCard, d: "like" | "pass") => void;
  onExpand: () => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const likeOpacity = useTransform(x, [40, 140], [0, 1]);
  const passOpacity = useTransform(x, [-140, -40], [1, 0]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD) onDecision(card, "like");
    else if (info.offset.x < -SWIPE_THRESHOLD) onDecision(card, "pass");
  }

  // The drag verdict labels are shared by both card kinds; only the right-swipe
  // word changes, because "Like" means something different to an opportunity.
  const overlays = (
    <>
      <button
        type="button"
        aria-label={card.kind === "socio" ? "View full profile" : "View details"}
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
        {card.kind === "socio" ? "Like" : "Yes"}
      </motion.div>
      <motion.div
        style={{ opacity: passOpacity }}
        className="absolute right-5 top-20 rounded-xl border-2 border-error px-3 py-1 text-lg font-extrabold uppercase text-error"
      >
        Pass
      </motion.div>
    </>
  );

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
      {card.kind === "socio" ? (
        <ProfileCardBody profile={card.profile}>{overlays}</ProfileCardBody>
      ) : (
        <IntentCardBody card={card}>{overlays}</IntentCardBody>
      )}
    </motion.div>
  );
}

function StackedCard({ card, index }: { card: DiscoverSwipeCard; index: number }) {
  return (
    <div className="absolute inset-0">
      {/* Invisible preloader, sized identically to the top card slot: by the
          time this card is promoted to top, next/image has already requested
          (and the browser cached) this exact URL — no blank/pulsing flash on
          the swipe that promotes it (fix for the Discover image delay). The
          visible stacked-card look below is completely unchanged. */}
      <CardImagePreload card={card} />
      <div
        className="absolute inset-0"
        style={{
          transform: `scale(${1 - index * 0.04}) translateY(${index * 12}px)`,
          opacity: 1 - index * 0.25,
          zIndex: -index,
        }}
      >
        <div className="h-full w-full rounded-[var(--radius-xl)] bg-card" />
      </div>
    </div>
  );
}

/** The one image a swipe reveals immediately: a socio card's hero photo, or an
 *  intent card's small author avatar. Rendered at zero opacity, same box size
 *  and `sizes` as the real card will use once promoted, so next/image
 *  resolves to the identical cached URL. */
function CardImagePreload({ card }: { card: DiscoverSwipeCard }) {
  const src =
    card.kind === "socio"
      ? resolveAvatarUrl(card.profile.avatar_url, card.profile.gender)
      : card.post.authorAvatar;
  if (!src) return null;
  const sizes =
    card.kind === "socio" ? "(max-width: 448px) 100vw, 384px" : "36px";
  return (
    <div className="absolute inset-0 opacity-0" aria-hidden>
      <AppImage src={src} alt="" sizes={sizes} />
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
  const shared = new Set(profile.shared_interests ?? []);
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-xl)] bg-card">
      {resolveAvatarUrl(profile.avatar_url, profile.gender) ? (
        <AppImage
          src={resolveAvatarUrl(profile.avatar_url, profile.gender)!}
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

      {/*
        Top corners carry the two numbers that decide whether you swipe: how
        well you match, and how much Aura they carry. The card used to also
        repeat the person's first name in a third capsule up here — the same
        name that is already set in 22px directly below — so three chips
        competed across the top of a photograph. The duplicate is gone and each
        remaining signal owns a corner (apple.md §6 — simplicity is removing
        what doesn't earn its place, not hiding it).

        Match is the headline, so it keeps the accent pill — the number is
        matching semantics and purple is what this app means by that. It is a
        translucent material rather than a flat fill, though: at full opacity a
        saturated block sat ON the photograph instead of over it and was the
        first thing your eye landed on, ahead of the face it is describing.
        Aura is supporting, so it is set as bare vibrant type over the photo
        with its own label — no chip — which is also why the top of the image
        stays readable.
      */}
      {typeof profile.compatibility === "number" && (
        <span
          className="absolute left-4 top-4 rounded-full bg-accent/85 px-3 py-1.5 type-caption font-semibold text-white backdrop-blur-sm"
          aria-label={`${profile.compatibility}% compatibility`}
        >
          {profile.compatibility}% match
        </span>
      )}
      <div className="absolute right-4 top-4 flex flex-col items-end drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
        <span className="flex items-center gap-1">
          <AuraIcon className="h-4 w-4" />
          <span className="text-[19px] font-bold leading-none text-white">
            {profile.aura_score.toLocaleString()}
          </span>
        </span>
        <span className="type-caption text-white/75">Aura</span>
      </div>

      {/* BOTTOM OVERLAY — gradient fade + identity. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5 pt-20">
        <h2 className="flex items-center gap-1.5 text-[22px] font-bold text-white">
          {profile.full_name ?? "Student"}
          {profile.verified && <VerifiedBadge size={16} />}
        </h2>
        <p className="type-caption mt-1 text-fg-muted">
          {profile.department ?? ""}
          {profile.semester ? ` · ${semesterLabel(profile.semester)}` : ""}
        </p>
        {profile.bio && (
          <p className="type-callout mt-1.5 line-clamp-2 text-white">{profile.bio}</p>
        )}
        {/*
          Interests were four saturated purple pills stacked over the
          photograph — the loudest thing on a screen whose entire job is to show
          you a person. They are supporting detail, so they are set as a single
          dot-separated line of quiet type instead. Shared interests still sort
          to the front and stay the only ones in white, which is a quieter way
          of saying the same thing the ★ pills were shouting.
        */}
        {profile.interests?.length > 0 && (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 type-callout">
            {[...profile.interests]
              .sort((a, b) => Number(shared.has(b)) - Number(shared.has(a)))
              .slice(0, 4)
              .map((tag, i, arr) => (
                <span key={tag} className="flex items-center gap-1.5">
                  <span
                    className={
                      shared.has(tag) ? "font-medium text-white" : "text-white/60"
                    }
                  >
                    {tag}
                  </span>
                  {i < arr.length - 1 && (
                    <span aria-hidden className="text-white/35">
                      ·
                    </span>
                  )}
                </span>
              ))}
          </p>
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
          <h3 className="type-title">
            Message {profile.full_name ?? "them"}
          </h3>
          <p className="type-callout text-fg-muted">
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

/** Full detail for whichever card kind is open. */
function DetailSheet({
  card,
  onClose,
  onReportProfile,
}: {
  card: DiscoverSwipeCard | null;
  onClose: () => void;
  onReportProfile: (p: DiscoverProfile) => void;
}) {
  return (
    <GlassSheet open={Boolean(card)} onClose={onClose}>
      {card?.kind === "socio" && (
        <ProfileDetail profile={card.profile} onReport={onReportProfile} />
      )}
      {card && card.kind !== "socio" && <IntentDetail card={card} />}
    </GlassSheet>
  );
}

function ProfileDetail({
  profile,
  onReport,
}: {
  profile: DiscoverProfile;
  onReport: (p: DiscoverProfile) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="type-title flex items-center gap-1.5">
          {profile.full_name ?? "Student"}
          {profile.verified && <VerifiedBadge size={18} />}
        </h3>
        <p className="type-caption mt-1 text-fg-muted">
          {profile.department ?? ""}
          {profile.semester ? ` · ${semesterLabel(profile.semester)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {typeof profile.compatibility === "number" && (
          <GlassChip tone="cyan">{profile.compatibility}% match</GlassChip>
        )}
        <GlassChip tone="aura">★ {profile.aura_score} Aura</GlassChip>
      </div>
      {profile.bio && (
        <div>
          <h4 className="mb-1 text-sm font-medium text-fg-muted">About</h4>
          <p className="type-callout">{profile.bio}</p>
        </div>
      )}
      {profile.interests?.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-fg-muted">Interests</h4>
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
  );
}

function IntentDetail({ card }: { card: IntentCard }) {
  const post = card.post;
  const rows = safeMatchingDisplay(post.mode, post);
  const [reported, setReported] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <span className="text-[11px] font-bold uppercase tracking-wide text-accent-light">
          {KIND_CAPSULE[card.kind]}
        </span>
        <h3 className="type-title mt-1">{post.title}</h3>
        <p className="type-caption mt-1 text-fg-muted">
          {post.authorName ?? "Student"}
          {post.authorDepartment ? ` · ${post.authorDepartment}` : ""}
        </p>
      </div>

      {post.description && <p className="type-callout">{post.description}</p>}

      {rows.length > 0 && (
        <ul className="type-callout space-y-1 text-fg-muted">
          {rows.map((r) => (
            <li key={r.key}>{r.label}</li>
          ))}
        </ul>
      )}

      {post.skillsNeeded.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-fg-muted">Skills needed</h4>
          <div className="flex flex-wrap gap-2">
            {post.skillsNeeded.map((s) => (
              <GlassChip key={s}>{s}</GlassChip>
            ))}
          </div>
        </div>
      )}

      {post.teamMembers.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-fg-muted">
            Already on the team
          </h4>
          <div className="flex flex-wrap gap-2">
            {post.teamMembers.map((m) => (
              <GlassChip key={m.id}>
                {m.fullName ?? (m.username ? `@${m.username}` : "Student")}
              </GlassChip>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={reported}
        onClick={async () => {
          setReported(true);
          await reportDiscoverPost(post.id, "Reported from Discover");
        }}
        className="flex items-center gap-2 pt-1 text-sm font-medium text-error/90 hover:text-error disabled:text-fg-disabled"
      >
        <Flag className="h-4 w-4" aria-hidden />
        {reported ? "Reported — thanks" : "Report this post"}
      </button>
    </div>
  );
}

function MatchOverlay({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 px-6 text-center"
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
        <GlassButton className={cn("mt-8")} size="lg" onClick={onClose}>
          Keep swiping
        </GlassButton>
      </motion.div>
    </motion.div>
  );
}
