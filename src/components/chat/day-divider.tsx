/**
 * The date separator between runs of messages from different days
 * ("Today", "Yesterday", "Thursday", "24th August 2026").
 *
 * Deliberately quieter than the unread divider that can sit right below it:
 * that one is an event the reader must notice, this one is orientation.
 */
export function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-3">
      <span className="rounded-full bg-fg-muted/10 px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
        {label}
      </span>
    </div>
  );
}
