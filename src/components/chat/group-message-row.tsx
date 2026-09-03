"use client";

import { Loader2, Pin, VenetianMask } from "lucide-react";
import { cn } from "@/lib/utils";
import { absoluteTime } from "@/lib/time";
import { exactMessageTime } from "@/lib/chat/status-labels";
import { renderLinkifiedText } from "@/lib/linkify";
import { QuotedMessage } from "@/components/chat/quoted-message";
import { SwipeToReply } from "@/components/chat/swipe-to-reply";
import { ReactionChips } from "@/components/chat/reaction-chips";
import { AppImage } from "@/components/ui/app-image";
import type { ReactionChip } from "@/lib/chat/reactions";
import type { MessagePressHandlers } from "@/lib/chat/use-message-press";
import {
  displayName,
  isInert,
  quoteLabel,
  toQuotable,
  type ConversationMessage,
} from "@/lib/chat/conversation-message";

/**
 * One message in a GROUP conversation — a community/chat room, an event
 * discussion, or a society broadcast channel — drawn to the Messages thread's
 * conventions.
 *
 * Everything visual here is the DM bubble: the same radii and corner cut, the
 * same gradient for your own messages and soft fill for everyone else's, the
 * same borderless media (an image IS the bubble), the same quote strip above a
 * reply, the same reaction chips beneath, the same swipe-to-reply and
 * long-press gestures, the same double-tap heart burst, and the same
 * exceptional meta line — no clock under every bubble, a time revealed on tap
 * or hover instead.
 *
 * The two things a group has that a DM does not:
 *
 *  * AN AUTHOR. Incoming messages carry an avatar and a name, and consecutive
 *    messages from one author collapse to a single header. Anonymity is
 *    honoured here as the read path presents it: `authorName` is already NULL
 *    for a masked row, so this component cannot leak an identity it was never
 *    given.
 *  * A PIN MARK. Pinned messages are flagged in place, because a group thread
 *    has a pinned bar above it and the reader needs to know which bubble it is.
 */
export function GroupMessageRow({
  message,
  quoted,
  quotedLoaded = false,
  signedUrl,
  chips,
  poll,
  revealed,
  highlighted = false,
  burst = false,
  showAuthor,
  canReply = false,
  canReact = false,
  press,
  onReply,
  onToggleReaction,
  onJumpToQuoted,
  onOpenPhoto,
  onRetry,
  onDiscard,
  fallbackName = "Member",
}: {
  message: ConversationMessage;
  /** The message being replied to, when it is known. */
  quoted: ConversationMessage | null;
  /** True when the quoted message is on screen, so the quote can jump to it. */
  quotedLoaded?: boolean;
  /** Resolved URL for a private `chat-media` attachment. */
  signedUrl?: string;
  chips: ReactionChip[];
  /** The surface's own <PollCard/>, when this message carries a poll. */
  poll?: React.ReactNode;
  /** This message's exact time has been asked for by tapping it. */
  revealed: boolean;
  /** Briefly ringed after jumping here from a quote. */
  highlighted?: boolean;
  burst?: boolean;
  /** False when the previous message came from the same author (grouping). */
  showAuthor: boolean;
  canReply?: boolean;
  canReact?: boolean;
  press: MessagePressHandlers;
  onReply?: () => void;
  onToggleReaction: (emoji: string) => void;
  onJumpToQuoted?: () => void;
  onOpenPhoto?: () => void;
  onRetry?: () => void;
  onDiscard?: () => void;
  fallbackName?: string;
}) {
  const m = message;
  const mine = m.mine;
  const deleted = Boolean(m.deletedAt);
  const sending = m.status === "sending";
  const failed = m.status === "error";
  const isImage = !deleted && m.attachmentType === "image";
  const isMedia = isImage;
  const src = signedUrl ?? m.localSrc;
  const showMeta = !deleted && (revealed || sending || failed);
  const name = displayName(m, fallbackName);

  return (
    <>
      {/* Press and swipe to reply: theirs drags right, mine drags left, each
          away from the edge its bubble sits against. */}
      <SwipeToReply
        onReply={() => onReply?.()}
        direction={mine ? "left" : "right"}
        disabled={!canReply || !onReply || isInert(m)}
      >
        <div
          className={cn(
            "flex items-end gap-2",
            mine ? "justify-end" : "justify-start"
          )}
        >
          {/* The avatar column is always reserved on incoming rows, so a run of
              messages from one author stays aligned instead of stepping left
              when the header collapses. */}
          {!mine && (
            <div className="h-7 w-7 shrink-0">
              {showAuthor && (
                <div className="glass relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full">
                  {m.isAnonymous ? (
                    // A mask, never an initial: "A" for Anonymous next to "A"
                    // for Ayesha reads as a name, which is the one thing an
                    // anonymous message must not suggest.
                    <VenetianMask className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                  ) : m.authorAvatar ? (
                    <AppImage src={m.authorAvatar} alt="" sizes="28px" />
                  ) : (
                    <span className="text-[11px] font-semibold text-fg-muted">
                      {name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div
            className={cn(
              "group/msg relative flex min-w-0 max-w-[78%] flex-col gap-1",
              mine ? "items-end" : "items-start"
            )}
          >
            {/* Desktop reveal: hovering or keyboard-focusing a message floats
                its exact time beside the bubble. Absolutely positioned so
                nothing reserves a row of empty space, and opacity-only so the
                layout never shifts. Touch gets the same time from a tap. */}
            {!deleted && (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-1/2 hidden -translate-y-1/2 whitespace-nowrap text-[11px] text-fg-subtle opacity-0 transition-opacity",
                  "group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 sm:block",
                  mine ? "right-full mr-2" : "left-full ml-2"
                )}
              >
                {exactMessageTime(m.createdAt)}
              </span>
            )}

            {/* The author's name sits above the bubble, not inside it, so an
                image message is attributed too (it has no padded interior). */}
            {!mine && showAuthor && (
              <span
                className={cn(
                  "flex items-center gap-1 px-1 text-xs font-semibold",
                  m.isAnonymous ? "text-fg-muted" : "text-aura"
                )}
              >
                {m.isAnonymous && (
                  <VenetianMask className="h-3 w-3" aria-hidden />
                )}
                {name}
              </span>
            )}

            {m.replyToId && (
              <QuotedMessage
                preview={quoted ? toQuotable(quoted) : null}
                label={quoteLabel(m, quoted)}
                onClick={quotedLoaded ? onJumpToQuoted : undefined}
                className="max-w-full"
              />
            )}

            <div
              {...(deleted ? {} : press)}
              tabIndex={deleted ? undefined : 0}
              title={deleted ? undefined : absoluteTime(m.createdAt)}
              className={cn(
                "relative max-w-full text-[15px]",
                // Media already has its own edge — no outer frame, padding or
                // background. Text and polls keep the bubble chrome and inset.
                isMedia ? undefined : "overflow-hidden rounded-2xl px-4 py-2",
                deleted
                  ? "overflow-hidden rounded-2xl border border-dashed border-glass-border bg-transparent text-fg-disabled"
                  : isMedia
                    ? "cursor-pointer"
                    : mine
                      ? "gradient-brand rounded-br-md text-white"
                      : "bg-fill rounded-bl-md cursor-pointer text-fg",
                highlighted && "ring-2 ring-accent",
                sending && "opacity-70",
                failed && "ring-1 ring-error/60"
              )}
            >
              {deleted ? (
                <span className="text-[13px] italic">
                  This message was deleted
                </span>
              ) : isImage ? (
                !src ? (
                  <div className="h-40 w-[220px] animate-pulse rounded-2xl bg-fg-muted/10" />
                ) : (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed,
                        transform-sized storage URL; next/image would re-proxy it. */}
                    <img
                      src={src}
                      alt="Shared image"
                      draggable={false}
                      onClick={sending || failed ? undefined : onOpenPhoto}
                      className={cn(
                        "block max-h-72 w-[220px] rounded-2xl object-cover transition-opacity",
                        sending && "opacity-70",
                        !sending && !failed && "cursor-zoom-in"
                      )}
                      loading="lazy"
                      decoding="async"
                    />
                    {sending && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/25">
                        <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-medium text-white">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          Uploading…
                        </span>
                      </div>
                    )}
                    {failed && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
                        <span className="rounded-full bg-error px-3 py-1.5 text-[11px] font-semibold text-white">
                          Upload failed
                        </span>
                      </div>
                    )}
                  </div>
                )
              ) : poll ? (
                poll
              ) : (
                <span className="whitespace-pre-wrap break-words">
                  {renderLinkifiedText(m.body ?? "")}
                  {m.editedAt && (
                    <span
                      className={cn(
                        "ml-1.5 align-baseline text-[11px]",
                        mine ? "text-white/60" : "text-fg-disabled"
                      )}
                    >
                      edited
                    </span>
                  )}
                </span>
              )}

              {/* Double-tap heart, the same burst the feed and DMs use. */}
              {burst && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <span className="animate-like-burst text-4xl drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                    ❤️
                  </span>
                </span>
              )}

            </div>

            {/* Outside the bubble: a text bubble is `overflow-hidden` (so a
                long URL cannot escape its radius), which would clip a marker
                drawn inside it. */}
            {m.pinned && !deleted && (
              <span
                aria-label="Pinned"
                className={cn(
                  "pointer-events-none absolute top-0 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white",
                  mine ? "-left-1.5" : "-right-1.5"
                )}
              >
                <Pin className="h-2.5 w-2.5" aria-hidden />
              </span>
            )}
          </div>
        </div>
      </SwipeToReply>

      <ReactionChips
        chips={chips}
        align={mine ? "end" : "start"}
        disabled={!canReact}
        onToggle={onToggleReaction}
      />

      {/* The meta line is EXCEPTIONAL, not per-message: a time the reader asked
          for, or an in-flight/failed send. The day separators carry the "when"
          for everything else, exactly as in Messages. */}
      {showMeta && (
        <p
          className={cn(
            "mt-0.5 flex items-center gap-1 text-[11px] text-fg-muted",
            mine ? "justify-end pr-1" : "justify-start pl-8",
            failed && "text-error"
          )}
        >
          {revealed && (
            <time dateTime={m.createdAt} title={absoluteTime(m.createdAt)}>
              {exactMessageTime(m.createdAt)}
            </time>
          )}
          {revealed && (sending || failed) && <span aria-hidden>·</span>}
          {sending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Sending…
            </>
          ) : failed ? (
            // A failed send is recoverable rather than a stuck row: retry
            // re-runs the upload and insert, discard drops the bubble.
            <>
              Failed to send
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="focus-ring rounded font-semibold text-fg underline underline-offset-2"
                >
                  Retry
                </button>
              )}
              {onDiscard && (
                <button
                  type="button"
                  onClick={onDiscard}
                  className="focus-ring rounded text-fg-muted underline underline-offset-2"
                >
                  Discard
                </button>
              )}
            </>
          ) : null}
        </p>
      )}
    </>
  );
}
