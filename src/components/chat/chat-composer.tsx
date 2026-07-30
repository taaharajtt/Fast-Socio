"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, ImagePlus, Send, VenetianMask } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one chat composer (fix-058), shared by every surface that posts a message
 * into a community: community chat, campus chat rooms, Discover team rooms and
 * the announcements thread. Those are all the same table and the same thread
 * component — a Discover team room is a `communities` row carrying
 * `is_discover_group`, not a separate conversation — so this is one wiring, not
 * three. DMs keep their own composer; they are a different table with voice
 * notes and forwarding that none of these surfaces have.
 *
 * Per-surface differences are expressed ONLY through `capabilities`, never by
 * forking the component:
 *
 *   community / chat room   { poll: true,  anonymous: true,  media: true }
 *   Discover team room      { poll: true,  anonymous: false, media: true }
 *   announcements           { poll: true,  anonymous: false, media: true }
 *
 * Discover deliberately has no anonymous option — that was decided in fix-018.
 */

export type ComposerCapabilities = {
  poll?: boolean;
  anonymous?: boolean;
  media?: boolean;
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
 * so `min-h-[40px]` is exactly one line box plus its symmetric padding, and a
 * single line — placeholder or text — is centred by construction at every font
 * size and in either theme. Nudging with `mt-`/`translate-y` would only be
 * correct at one font size.
 */
const LINE_HEIGHT = 20;
const PAD_Y = 10;
const MIN_H = LINE_HEIGHT + PAD_Y * 2; // 40
/** fix-050: grow to five lines, then scroll internally. */
const MAX_LINES = 5;
const MAX_H = LINE_HEIGHT * MAX_LINES + PAD_Y * 2; // 120

export function ChatComposer({
  placeholder = "Message...",
  capabilities,
  anonymous = false,
  onToggleAnonymous,
  pollActive = false,
  onTogglePoll,
  onPickImage,
  onSend,
  busy = false,
  disabled = false,
}: {
  placeholder?: string;
  capabilities: ComposerCapabilities;
  anonymous?: boolean;
  onToggleAnonymous?: () => void;
  pollActive?: boolean;
  onTogglePoll?: () => void;
  onPickImage?: () => void;
  onSend: (text: string) => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // fix-050: grow with content up to MAX_H, then let the textarea scroll.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(Math.min(el.scrollHeight, MAX_H), MIN_H)}px`;
  }, [draft]);

  const canSend = !busy && !disabled && draft.trim().length > 0;

  async function submit() {
    const text = draft.trim();
    if (!text || busy || disabled) return;
    // Clear optimistically so the field is ready for the next line immediately;
    // the surface owns retry/error reporting.
    setDraft("");
    await onSend(text);
  }

  const showIcons =
    capabilities.poll || capabilities.anonymous || capabilities.media;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      /* items-end keeps the icon cluster and the send button pinned to the
         BOTTOM of a grown field, per fix-050. */
      className="flex items-end gap-2 pt-2"
    >
      <div
        className={cn(
          "glass flex min-w-0 flex-1 items-end gap-1 rounded-2xl px-3",
          "focus-within:ring-2 focus-within:ring-aura/40"
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter inserts a newline (fix-050).
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
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

        {/* fix-058: the capability icons live INSIDE the field's right edge as
            one rounded cluster, in the order poll → anonymous → media. */}
        {showIcons && (
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-full"
            style={{ marginBottom: (MIN_H - 32) / 2 }}
          >
            {capabilities.poll && (
              <button
                type="button"
                aria-label="Create a poll"
                aria-pressed={pollActive}
                disabled={disabled}
                onClick={onTogglePoll}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  pollActive ? "bg-aura text-white" : "text-fg-muted hover:text-fg"
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
                  "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  anonymous ? "bg-aura text-white" : "text-fg-muted hover:text-fg"
                )}
              >
                <VenetianMask className="h-[18px] w-[18px]" aria-hidden />
              </button>
            )}
            {capabilities.media && (
              <button
                type="button"
                aria-label="Add a photo"
                disabled={disabled || busy}
                onClick={onPickImage}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  "text-fg-muted hover:text-fg disabled:opacity-40"
                )}
              >
                <ImagePlus className="h-[18px] w-[18px]" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Send sits OUTSIDE the field as its own circle (fix-058). */}
      <button
        type="submit"
        aria-label="Send"
        disabled={!canSend}
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
          "bg-accent text-white transition-colors hover:bg-accent-light",
          "disabled:opacity-40"
        )}
      >
        <Send className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </form>
  );
}
