"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchMentionRoster,
  type MentionTarget,
} from "@/app/(student)/home/actions";
import {
  activeMentionQuery,
  parseMentions,
  serializeMentions,
} from "@/lib/mentions";

/**
 * @-mention autocomplete, shared by the comment composer and the post composer.
 *
 * Both surfaces need the identical behaviour — lazily load the viewer's matches
 * on the first "@", filter as they type, keyboard-navigate, and remember which
 * picks were CONFIRMED so only those serialise into tokens. This hook is that
 * behaviour; the caller owns the text state and renders <MentionMenu> wherever
 * its layout wants it.
 *
 * Generic over the field element so it works for an <input> (comments) and a
 * <textarea> (posts) without either one owning the logic.
 */
export function useMentionAutocomplete<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(
  text: string,
  setText: (next: string) => void,
  fieldRef: React.RefObject<T | null>
) {
  // Confirmed picks: lowercased username -> user id. Only these become tokens,
  // so merely typing something that looks like "@someone" stays plain text.
  const [mentions, setMentions] = useState<Record<string, string>>({});
  const [roster, setRoster] = useState<MentionTarget[] | null>(null);
  // The "@query" the caret currently sits in, or null when it is not in one.
  const [mq, setMq] = useState<{ start: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const rosterRequested = useRef(false);

  // Load the roster once, the first time a mention is actually being typed.
  useEffect(() => {
    if (mq && !rosterRequested.current) {
      rosterRequested.current = true;
      fetchMentionRoster().then(setRoster);
    }
  }, [mq]);

  const suggestions = useMemo(() => {
    if (!mq || !roster) return [];
    const q = mq.query.toLowerCase();
    return roster
      .filter((p) => {
        if (!p.username) return false;
        if (!q) return true;
        return (
          (p.full_name ?? "").toLowerCase().includes(q) ||
          p.username.toLowerCase().includes(q)
        );
      })
      .slice(0, 30);
  }, [mq, roster]);

  const showMenu = mq !== null && (roster === null || suggestions.length > 0);

  /** Call from the field's onChange, after the text state is updated. */
  const syncCaret = useCallback((value: string, caret: number) => {
    setMq(activeMentionQuery(value, caret));
    setActiveIdx(0);
  }, []);

  const pickMention = useCallback(
    (t: MentionTarget) => {
      if (!mq || !t.username) return;
      const before = text.slice(0, mq.start);
      const after = text.slice(mq.start + 1 + mq.query.length);
      const insert = `@${t.username} `;
      setText(before + insert + after);
      setMentions((prev) => ({ ...prev, [t.username!.toLowerCase()]: t.id }));
      setMq(null);
      const pos = (before + insert).length;
      requestAnimationFrame(() => {
        const el = fieldRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(pos, pos);
        }
      });
    },
    [mq, text, setText, fieldRef]
  );

  /** Call from the field's onKeyDown; returns true when the key was consumed. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<T>): boolean => {
      if (!showMenu || suggestions.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        pickMention(suggestions[activeIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setMq(null);
      } else {
        return false;
      }
      return true;
    },
    [showMenu, suggestions, activeIdx, pickMention]
  );

  /** Turn the plain composer text into the stored body. */
  const serialize = useCallback(
    (value: string) => serializeMentions(value, mentions),
    [mentions]
  );

  /** Dismiss the menu without clearing confirmed picks (e.g. on blur). */
  const close = useCallback(() => setMq(null), []);

  const reset = useCallback(() => {
    setMentions({});
    setMq(null);
  }, []);

  /**
   * Seed confirmed picks from a body that ALREADY contains tokens — used when
   * an existing post is opened for editing, so its mentions survive a re-save
   * instead of degrading to plain text.
   */
  const seedFrom = useCallback((storedBody: string) => {
    const seeded: Record<string, string> = {};
    for (const part of parseMentions(storedBody)) {
      if (part.type === "mention") seeded[part.username.toLowerCase()] = part.id;
    }
    setMentions(seeded);
  }, []);

  return {
    roster,
    suggestions,
    activeIdx,
    setActiveIdx,
    showMenu,
    syncCaret,
    pickMention,
    onKeyDown,
    close,
    serialize,
    reset,
    seedFrom,
  };
}
