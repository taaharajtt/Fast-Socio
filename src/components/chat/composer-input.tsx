"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Paperclip, Send } from "lucide-react";

/** Single-line pill height; the textarea grows past this and then scrolls. */
const MIN_TEXTAREA_HEIGHT = 40;
const MAX_TEXTAREA_HEIGHT = 144;

/**
 * The chat composer's text input, extracted from <ChatThread/> so that TYPING
 * does not re-render the message list (perf audit Phase 5).
 *
 * WHY. `draft` used to be one of ~35 `useState` hooks in a single 2,211-line
 * component that also maps every message inline, with no `memo`, `useMemo` or
 * `React.memo` anywhere in the file. So every keystroke re-rendered every
 * message row's JSX — in the most-used interaction in the product, on phones.
 * Moving the draft down here means a keystroke re-renders this component and
 * nothing else; the list above it is untouched.
 *
 * The split is drawn at the DRAFT, not at "the composer", and that is
 * deliberate. The reply preview, the recording strip, the attachment cropper
 * and the send pipeline all stay in the parent where their state already
 * lives. Only the three things that read `draft` on every keystroke moved: the
 * textarea, the camera button (shown only when the draft is empty) and the
 * send/mic button (which swaps on the same condition). Those span the pill and
 * the button beside it, so this component renders both.
 *
 * SEND SEMANTICS ARE PRESERVED EXACTLY. The old `onSendText` cleared the draft
 * optimistically and restored it if the server action failed, so a failed send
 * left the text back in the box rather than losing it. That contract now
 * travels through `onSend`'s return value: `false` means "put it back". The
 * parent still owns the optimistic bubble and the reply-target restore.
 */
export function ComposerInput({
  busy,
  replyPreview,
  replyActive,
  onSend,
  onTyping,
  onFilePicked,
  onRecord,
}: {
  busy: boolean;
  /** The reply banner, rendered by the parent (it owns `replyTo`). */
  replyPreview: React.ReactNode;
  /** True while replying — moves the caret into the box, as before. */
  replyActive: boolean;
  /** Returns false when the send failed and the text should be restored. */
  onSend: (text: string) => Promise<boolean>;
  onTyping: () => void;
  onFilePicked: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRecord: () => void;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-grow the textarea with its content, capped at MAX_TEXTAREA_HEIGHT
  // (~5-6 lines) where it starts scrolling internally instead.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${Math.max(next, MIN_TEXTAREA_HEIGHT)}px`;
  }, [draft]);

  // Entering reply mode moves the caret into the composer, once the reply row
  // has rendered. In an effect because that is where a ref may be touched.
  useEffect(() => {
    if (replyActive) textareaRef.current?.focus();
  }, [replyActive]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    // Unchanged guard: an empty or in-flight send must not clear the box.
    if (!text || busy) return;
    setDraft("");
    const ok = await onSend(text);
    // The text goes back in the composer, so the send is retried by pressing
    // send again — nothing unsendable is left on screen.
    if (!ok) setDraft(text);
  }

  return (
    <form
      onSubmit={submit}
      className="sticky bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
    >
      {/* items-end keeps the side buttons anchored to the textarea's last
          line as it grows, matching the WhatsApp composer feel. */}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onFilePicked}
        />

        {/* One rounded composer card: the reply preview (when replying) and
            the input row live INSIDE it, separated by a hairline, so replying
            grows the composer rather than floating a second card above it.
            Neutral border and shadow only — no accent outline, focused or
            otherwise. */}
        <div className="glass flex min-w-0 flex-1 flex-col rounded-2xl">
          {replyPreview}
          <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
            {/* text-base (16px): anything smaller triggers iOS Safari's
                auto-zoom on focus — the root cause of the chat "jump" on
                iPhones. rows=1 + the auto-grow effect above own the height. */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                onTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Message..."
              enterKeyHint="send"
              className="min-h-[40px] min-w-0 flex-1 resize-none overflow-y-auto border-none bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
              style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
            />

            {/* Camera only shows idle (no draft) — matches WhatsApp, both
                icons open the same file picker. */}
            {draft.trim() === "" && (
              <button
                type="button"
                aria-label="Take photo"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-muted disabled:opacity-40"
              >
                <Camera className="h-5 w-5" aria-hidden />
              </button>
            )}
            <button
              type="button"
              aria-label="Attach image"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-muted disabled:opacity-40"
            >
              <Paperclip className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Floating action button outside the pill: standalone Mic (idle)
            morphs into Send once text is entered (typing). */}
        {draft.trim().length > 0 ? (
          <button
            type="submit"
            aria-label="Send"
            disabled={busy}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-light disabled:opacity-40"
          >
            <Send className="h-5 w-5" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Record voice note"
            onClick={onRecord}
            disabled={busy}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-light disabled:opacity-40"
          >
            <Mic className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}
