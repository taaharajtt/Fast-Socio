import { cn } from "@/lib/utils";

/**
 * Circular upload-progress indicator (UAT-004). An SVG ring that fills as the
 * percentage climbs, with the number in the middle — sits as an overlay on the
 * thing being uploaded (avatar, cover, post image). At 100% it reads "Done" for
 * a beat before the caller swaps in the real image.
 */
export function UploadProgressRing({
  percent,
  size = 56,
  className,
}: {
  percent: number;
  size?: number;
  className?: string;
}) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-white",
        className
      )}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Upload progress"
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-white/20"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="text-accent transition-[stroke-dashoffset] duration-200 ease-out"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums">
          {clamped}%
        </span>
      </div>
    </div>
  );
}

/** Slim horizontal progress bar — for wide upload previews (post/cover). */
export function UploadProgressBar({
  percent,
  label = "Uploading",
}: {
  percent: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-white">
        <span>{clamped < 100 ? label : "Processing…"}</span>
        <span className="tabular-nums">{clamped}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
