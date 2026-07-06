import { Skeleton } from "@/components/ui/skeleton";

/** Chat room: header (avatar + name), alternating bubbles, composer bar. */
const BUBBLES = [
  { mine: false, w: "w-3/5" },
  { mine: true, w: "w-2/5" },
  { mine: false, w: "w-4/6" },
  { mine: true, w: "w-1/2" },
  { mine: false, w: "w-2/5" },
];

export default function ChatRoomLoading() {
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col">
      <div className="flex items-center gap-3 border-b border-glass-border px-5 py-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-hidden px-5 py-4">
        {BUBBLES.map((b, i) => (
          <div
            key={i}
            className={b.mine ? "flex justify-end" : "flex justify-start"}
          >
            <Skeleton className={`h-10 rounded-2xl ${b.w}`} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-glass-border px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <Skeleton className="h-11 flex-1 rounded-[var(--radius-pill)]" />
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      </div>
    </div>
  );
}
