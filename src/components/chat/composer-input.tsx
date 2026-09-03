"use client";

import {
  ConversationComposer,
} from "@/components/chat/conversation-composer";

/**
 * The Messages composer.
 *
 * WHY THIS IS NOW A THIN WRAPPER. The draft used to live in <ChatThread/>,
 * where it was one of ~35 `useState` hooks in a component that also maps every
 * message inline — so every keystroke re-rendered every message row, in the
 * most-used interaction in the product, on phones. Moving the draft out fixed
 * that (perf audit Phase 5), and this file is where it went.
 *
 * The markup then moved one level further down, into <ConversationComposer/>,
 * so that the community rooms, event discussions and society broadcasts get
 * THIS composer rather than a lookalike. Nothing about the DM behaviour
 * changed in that move: the draft still lives below <ChatThread/>, so typing
 * still re-renders only the composer; the send contract is still "return false
 * and the text goes back in the box"; the camera still appears only while the
 * draft is empty; the mic still morphs into send.
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
  return (
    <ConversationComposer
      // Voice notes are a `messages`-table feature: no group surface has a
      // column to store one, which is why this is the only call site that asks
      // for the mic.
      capabilities={{ media: true, camera: true, voice: true }}
      busy={busy}
      replyPreview={replyPreview}
      replyActive={replyActive}
      onSend={onSend}
      onTyping={onTyping}
      onFilePicked={onFilePicked}
      onRecord={onRecord}
    />
  );
}
