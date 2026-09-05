import { cn } from "@/lib/utils";

/**
 * The one place tab selection is styled.
 *
 * There were five tab implementations in the app — RouteTabs, ProfileTabs,
 * HelpTabs, RanksTabs and SpaceShell — each hard-coding its own indicator, and
 * each drifting slightly in label size and geometry. They all read from here,
 * so a change to how "selected" looks is one edit rather than five. (Profile
 * no longer has tabs at all: it is Posts-only on both screens.)
 *
 * Two things carry selection, and they do different jobs:
 *
 *   WEIGHT + CONTRAST  active is off-white, inactive is tertiary grey. This is
 *                      what survives the grayscale test — you can tell which
 *                      tab you are on with the hue removed.
 *   THE PURPLE RULE    the brand accent, spent on the one piece of chrome that
 *                      answers "where am I" on almost every screen. It is a
 *                      2px rule, not a fill: the tab does not become a purple
 *                      block, it gets a purple underline.
 *
 * Every tab row is an equal split — `flex-1` on each trigger, so two tabs are
 * exactly 50/50 regardless of how long their labels are. "Leaderboard" and
 * "Department Rankings" get the same half of the screen. The indicator spans
 * that whole half (`inset-x-0`) rather than hugging the text, so the underline
 * measures the segment, not the word.
 *
 * The label size is fluid rather than fixed, because a 50/50 split plus a
 * twenty-character label is what actually breaks at 320px. It resolves to 17px
 * from ~390px up (the design size) and eases down to 12.5px on the narrowest
 * phones we support — shrinking type is a much smaller compromise than
 * truncating "Department Ranking…" or abandoning the split.
 */

/** The row that holds the triggers. `bordered` draws the baseline rule. */
export function tabListClass(bordered = true) {
  return cn("flex", bordered && "border-b border-hairline");
}

/** One tab trigger. `grow` makes triggers share the row equally. */
export function tabTriggerClass(active: boolean, grow = true) {
  return cn(
    "pressable focus-ring relative flex items-center justify-center gap-1.5",
    "pb-2.5 text-center font-semibold leading-tight transition-colors",
    "text-[clamp(0.78rem,4.36vw,1.0625rem)] tracking-[-0.01em]",
    grow && "min-w-0 flex-1",
    active ? "text-fg" : "text-fg-subtle hover:text-fg-muted"
  );
}

/**
 * The active indicator: a purple rule on the list's baseline, spanning the
 * trigger's full width. Render it only for the active trigger.
 */
export const TAB_INDICATOR_CLASS =
  "absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-accent";
