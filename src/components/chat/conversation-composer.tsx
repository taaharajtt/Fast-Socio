"use client";

import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Camera,
  Mic,
  Paperclip,
  Send,
  VenetianMask,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE composer. One component behind every conversation in the app: direct
 * messages, community and campus chat rooms, Discover team rooms, event
 * discussions and society broadcast channels.
 *
 * It is the Messages composer — the auto-growing textarea, the 16px font that
 * stops iOS Safari zooming on focus, Enter-to-send with Shift+Enter for a
 * newline, the reply banner inside the card, the round send button floating
 * outside the pill, the safe-area padding — with the per-surface extras
 * expressed ONLY as capabilities:
 *
 *   direct message        { attach, camera, voice }
 *   community / room      { camera, poll, anonymous }
 *   Discover team room    { camera, poll }              (no anonymity)
 *   event discussion      { camera }                    (no poll, no anonymity)
 *   society broadcast     { camera, poll, anonymous? }  (anonymity by role)
 *
 * `attach` IS A DIRECT-MESSAGE CAPABILITY. The paperclip — the general
 * "attach a file" control — belongs to a private conversation between two
 * people. On the community surfaces it was a second button opening the same
 * image picker as the camera beside it, so it added a control without adding
 * an ability; those surfaces keep the camera and lose the paperclip. Note the
 * consequence, because it is the design and not an oversight: on a community
 * surface an image is attached from an EMPTY composer (the camera is the
 * idle-state control, as in Messages), not mid-sentence.
 *
 * WHAT IS NOT A CAPABILITY. Whether someone may post AT ALL is not decided
 * here: a surface that must not accept a message does not render a composer,
 * and the database refuses the write regardless. `disabled` is for a composer
 * that is present but temporarily inert (a send in flight, an upload running).
 *
 * SEND SEMANTICS. `onSend` returns FALSE when the send failed and the text
 * should go back in the box — the optimistic-clear/restore contract from the
 * Messages thread, unchanged, so nothing unsendable is ever left on screen.
 */

export type ComposerCapabilities = {
  /**
   * The general attachment control (paperclip), available at any draft length.
   * Direct messages only — see the header. A surface that wants images but not
   * a paperclip asks for `camera` alone.
   */
  attach?: boolean;
  /** Camera shortcut, shown only while the draft is empty (as in Messages). */
  camera?: boolean;
  /** Mic replaces Send while the draft is empty. DMs only — voice notes are a
   *  `messages` feature; no group surface has a column to store one. */
  voice?: boolean;
  /** Poll builder toggle. */
  poll?: boolean;
  /** Post without your name attached. */
  anonymous?: boolean;
};

/**
 * Geometry, stated once so nobody "fixes" the placeholder with a margin later.
 *
 * fix-059 asks for the placeholder to sit in the exact vertical centre of the
 * field at its resting single-line height. That is a line-height/padding
 * problem, not an offset problem:
 *
 *     line-height 20px + padding-top 10px + padding-bottom 10px = 40px
 *
 * so the resting height is exactly one line box plus its symmetric padding,
 * and a single line — placeholder or text — is centred by construction at
 * every font size and in either theme. Nudging with `mt-`/`translate-y` would
 * only be correct at one font size. 40px is also the Messages composer's own
 * resting height, so nothing moves there.
 */
const LINE_HEIGHT = 20;
const PAD_Y = 10;
const MIN_H = LINE_HEIGHT + PAD_Y * 2; // 40
/** Grow to ~6 lines, then scroll internally. */
const MAX_H = 144;

export function ConversationComposer({
  placeholder = "Message...",
  capabilities,
  busy = false,
  disabled = false,
  anonymous = false,
  onToggleAnonymous,
  pollActive = false,
  onTogglePoll,
  onFilePicked,
  onSend,
  onTyping,
  onRecord,
  replyPreview,
  replyActive = false,
  sticky = true,
  className,
}: {
  placeholder?: string;
  capabilities: ComposerCapabilities;
  /** A send is in flight — the controls grey out but the draft is untouched. */
  busy?: boolean;
  /** Composer present but inert (e.g. an upload running). */
  disabled?: boolean;
  anonymous?: boolean;
  onToggleAnonymous?: () => void;
  pollActive?: boolean;
  onTogglePoll?: () => void;
  /** Receives the picker's change event; this component owns the input. */
  onFilePicked?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** FALSE means the send failed and the draft must be restored. */
  onSend: (text: string) => Promise<boolean>;
  onTyping?: () => void;
  onRecord?: () => void;
  /** The reply banner, rendered by the parent (it owns the reply target). */
  replyPreview?: React.ReactNode;
  /** True while replying — moves the caret into the box. */
  replyActive?: boolean;
  /**
   * Sticky bottom + safe-area padding. True for surfaces that scroll the whole
   * screen; false where the parent already pins the composer to a fixed-height
   * shell's bottom edge and adds its own inset.
   */
  sticky?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-grow with content, capped at MAX_H where it starts scrolling instead.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(Math.min(el.scrollHeight, MAX_H), MIN_H)}px`;
  }, [draft]);

  // Entering reply mode moves the caret into the composer, once the reply row
  // has rendered. In an effect because that is where a ref may be touched.
  useEffect(() => {
    if (replyActive) textareaRef.current?.focus();
  }, [replyActive]);

  const empty = draft.trim().length === 0;
  const inert = busy || disabled;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    // Unchanged guard: an empty or in-flight send must not clear the box.
    if (!text || inert) return;
    setDraft("");
    const ok = await onSend(text);
    // The text goes back so the send is retried by pressing send again —
    // nothing unsendable is left on screen.
    if (!ok) setDraft(text);
  }

  // Both controls open the SAME picker below, so neither can be shown without
  // a handler to receive what it picks.
  const showAttach = Boolean(capabilities.attach && onFilePicked);
  const showCamera = Boolean(capabilities.camera && onFilePicked);

  return (
    <form
      onSubmit={submit}
      className={cn(
        sticky
          ? "sticky bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
          : "pt-2",
        className
      )}
    >
      {/* items-end keeps the side buttons anchored to the textarea's last line
          as it grows, matching the WhatsApp composer feel. */}
      <div className="flex items-end gap-2">
        {/* One picker for both the camera and the paperclip. It is rendered
            whenever EITHER can open it — never for a surface that has neither,
            so no unreachable input is left in the tree. */}
        {(showAttach || showCamera) && (
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onFilePicked}
          />
        )}

        {/* One rounded composer card: the reply banner (when replying) and the
            input row live INSIDE it, separated by a hairline, so replying grows
            the composer rather than floating a second card above it. Neutral
            border and shadow only — no accent outline, focused or otherwise. */}
        <div className="glass flex min-w-0 flex-1 flex-col rounded-2xl">
          {replyPreview}
          <div className="flex min-w-0 items-end gap-1 px-3">
            {/* text-base (16px): anything smaller triggers iOS Safari's
                auto-zoom on focus — the root cause of the chat "jump" on
                iPhones. rows=1 + the auto-grow effect above own the height. */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              disabled={disabled}
              onChange={(e) => {
                setDraft(e.target.value);
                onTyping?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={placeholder}
              enterKeyHint="send"
              aria-label={placeholder}
              className={cn(
                "min-w-0 flex-1 resize-none overflow-y-auto border-none bg-transparent",
                "text-base text-fg outline-none placeholder:text-fg-muted",
                "disabled:opacity-60"
              )}
              style={{
                lineHeight: `${LINE_HEIGHT}px`,
                paddingTop: PAD_Y,
                paddingBottom: PAD_Y,
                minHeight: MIN_H,
                maxHeight: MAX_H,
              }}
            />

            {/* The capability cluster sits INSIDE the field's right edge, in
                the order poll -> anonymous -> camera -> attach. It is a plain
                flex row with no placeholders: a capability the surface does not
                have renders nothing at all, so the textarea (flex-1) simply
                takes the width back and there is no gap where a button used to
                be. */}
            <div
              className="flex shrink-0 items-center gap-0.5"
              style={{ marginBottom: (MIN_H - 28) / 2 }}
            >
              {capabilities.poll && (
                <button
                  type="button"
                  aria-label="Create a poll"
                  aria-pressed={pollActive}
                  disabled={disabled}
                  onClick={onTogglePoll}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                    pollActive
                      ? "bg-aura text-white"
                      : "text-fg-muted hover:text-fg"
                  )}
                >
                  <BarChart3 className="h-[18px] w-[18px]" aria-hidden />
                </button>
              )}
              {capabilities.anonymous && (
                <button
                  type="button"
                  aria-label={anonymous ? "Posting anonymously" : "Post anonymously"}
                  aria-pressed={anonymous}
                  disabled={disabled}
                  onClick={onToggleAnonymous}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                    anonymous ? "bg-aura text-white" : "text-fg-muted hover:text-fg"
                  )}
                >
                  <VenetianMask className="h-[18px] w-[18px]" aria-hidden />
                </button>
              )}
              {/* Camera only shows idle (no draft) — matches Messages; both
                  icons open the same picker. */}
              {showCamera && empty && (
                <button
                  type="button"
                  aria-label="Take photo"
                  onClick={() => fileRef.current?.click()}
                  disabled={inert}
                  className="flex h-7 w-7 items-center justify-center text-fg-muted disabled:opacity-40"
                >
                  <Camera className="h-5 w-5" aria-hidden />
                </button>
              )}
              {showAttach && (
                <button
                  type="button"
                  aria-label="Attach image"
                  onClick={() => fileRef.current?.click()}
                  disabled={inert}
                  className="flex h-7 w-7 items-center justify-center text-fg-muted disabled:opacity-40"
                >
                  <Paperclip className="h-5 w-5" aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Floating action button outside the pill: on a surface with voice
            notes the idle state is a Mic that morphs into Send once there is
            text; everywhere else Send is always the button and is simply
            disabled while the draft is empty. */}
        {capabilities.voice && empty ? (
          <button
            type="button"
            aria-label="Record voice note"
            onClick={onRecord}
            disabled={inert}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-light disabled:opacity-40"
          >
            <Mic className="h-5 w-5" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={inert || empty}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-light disabled:opacity-40"
          >
            <Send className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}
