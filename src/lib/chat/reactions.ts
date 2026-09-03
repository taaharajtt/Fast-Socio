/**
 * Emoji reactions, shared by every conversation surface.
 *
 * The DM thread grew this logic inline (`aggregateReactions`, plus an
 * optimistic toggle written out longhand inside `react()`), and each non-DM
 * surface would otherwise have re-derived it. All four use the SAME model —
 * ONE reaction per user per message, where picking a new emoji replaces your
 * old one and picking the same emoji again clears it — because every backing
 * RPC (`toggle_message_reaction`, `toggle_community_chat_reaction`,
 * `toggle_event_message_reaction`, `toggle_announcement_reaction`) is written
 * against a `(message, user)` primary key. So the optimistic prediction below
 * is exactly what the server will do, and reconciling is a no-op in the common
 * case rather than a correction.
 *
 * Pure and DOM-free so the prediction is unit-tested without a socket.
 */

/** One row of a reactions table: who reacted, with what. */
export type MessageReaction = { emoji: string; user_id: string };

/** One rendered chip under a bubble. */
export type ReactionChip = { emoji: string; count: number; mine: boolean };

/** The quick-reaction row at the top of the message action sheet. */
export const QUICK_EMOJIS = ["❤️", "😂", "🔥", "👍", "😮", "😢", "🙏"] as const;

/** Group a message's raw reactions into per-emoji chips, flagging mine. */
export function aggregateReactions(
  list: MessageReaction[] | undefined,
  meId: string
): ReactionChip[] {
  if (!list || list.length === 0) return [];
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const r of list) {
    const cur = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === meId) cur.mine = true;
    byEmoji.set(r.emoji, cur);
  }
  return [...byEmoji.entries()]
    .map(([emoji, v]) => ({ emoji, ...v }))
    .sort((a, b) => b.count - a.count);
}

/**
 * What the list becomes when `meId` taps `emoji` — the optimistic prediction.
 *
 * Tapping the emoji you already have removes it; tapping a different one
 * REPLACES yours rather than adding a second, which is the one-per-user rule
 * the RPCs enforce. Other people's reactions are never touched.
 */
export function applyReactionToggle(
  list: MessageReaction[] | undefined,
  meId: string,
  emoji: string
): MessageReaction[] {
  const current = list ?? [];
  const mine = current.find((r) => r.user_id === meId);
  if (mine && mine.emoji === emoji) {
    return current.filter((r) => r.user_id !== meId);
  }
  return [...current.filter((r) => r.user_id !== meId), { emoji, user_id: meId }];
}

/** True when `meId` has already reacted to this message with `emoji`. */
export function hasMyReaction(
  list: MessageReaction[] | undefined,
  meId: string,
  emoji: string
): boolean {
  return (list ?? []).some((r) => r.user_id === meId && r.emoji === emoji);
}

/**
 * Fold a flat read of reaction rows into the per-message map the surfaces hold
 * in state.
 *
 * `ids` matters: a message whose reactions were all removed must come back as
 * an EMPTY list, not a missing key, or the previous state would survive the
 * refresh and the chip would never disappear. Callers pass the ids they asked
 * about so every one of them is represented.
 */
export function groupReactionsByMessage(
  rows: { message_id: string; emoji: string; user_id: string }[] | null | undefined,
  ids: string[] = []
): Record<string, MessageReaction[]> {
  const out: Record<string, MessageReaction[]> = {};
  for (const id of ids) out[id] = [];
  for (const r of rows ?? []) {
    (out[r.message_id] ??= []).push({ emoji: r.emoji, user_id: r.user_id });
  }
  return out;
}
