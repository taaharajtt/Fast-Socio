"use client";

import {
  ConversationComposer,
  type ComposerCapabilities,
} from "@/components/chat/conversation-composer";

/**
 * The non-DM chat composer (fix-058), shared by every surface that posts a
 * message into a community: community chat, campus chat rooms, Discover team
 * rooms, event discussions and the society broadcast channel. Those are the
 * same component with different capabilities — a Discover team room is a
 * `communities` row carrying `is_discover_group`, not a separate conversation.
 *
 * It no longer owns any markup. Direct messages and these surfaces render the
 * SAME composer now (<ConversationComposer/>), because "the chat rooms should
 * feel like Messages" is not achievable while the two composers are separate
 * implementations that drift. What survives here is the per-surface capability
 * wiring and this note:
 *
 *   community / chat room   { poll: true,  anonymous: true,  media: true }
 *   Discover team room      { poll: true,  anonymous: false, media: true }
 *   event discussion        { poll: false, anonymous: false, media: true }
 *   announcements           { poll: true,  anonymous: by role, media: true }
 *
 * Discover deliberately has no anonymous option — that was decided in fix-018.
 */

export type { ComposerCapabilities };

export function ChatComposer({
  placeholder = "Message...",
  capabilities,
  anonymous = false,
  onToggleAnonymous,
  pollActive = false,
  onTogglePoll,
  onFilePicked,
  onSend,
  onTyping,
  replyPreview,
  replyActive = false,
  busy = false,
  disabled = false,
  sticky = false,
}: {
  placeholder?: string;
  capabilities: ComposerCapabilities;
  anonymous?: boolean;
  onToggleAnonymous?: () => void;
  pollActive?: boolean;
  onTogglePoll?: () => void;
  onFilePicked?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** FALSE means the send failed and the draft must be restored. */
  onSend: (text: string) => Promise<boolean>;
  onTyping?: () => void;
  replyPreview?: React.ReactNode;
  replyActive?: boolean;
  busy?: boolean;
  disabled?: boolean;
  sticky?: boolean;
}) {
  return (
    <ConversationComposer
      placeholder={placeholder}
      // The camera shortcut travels with media everywhere: it is the same
      // picker, and its absence was one of the visible differences between
      // these surfaces and Messages.
      capabilities={{ ...capabilities, camera: capabilities.media }}
      anonymous={anonymous}
      onToggleAnonymous={onToggleAnonymous}
      pollActive={pollActive}
      onTogglePoll={onTogglePoll}
      onFilePicked={onFilePicked}
      onSend={onSend}
      onTyping={onTyping}
      replyPreview={replyPreview}
      replyActive={replyActive}
      busy={busy}
      disabled={disabled}
      sticky={sticky}
    />
  );
}
