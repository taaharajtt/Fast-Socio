import { Skeleton } from "@/components/ui/skeleton";

/** Settings: header, profile card, grouped glass list sections. */
export default function SettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-4">
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-24" />
      </div>

      <Skeleton className="mb-5 h-20 w-full rounded-[var(--radius-lg)]" />

      {[0, 1, 2].map((section) => (
        <div key={section} className="mb-5">
          <Skeleton className="mb-2 h-3 w-24" />
          <Skeleton className="h-40 w-full rounded-[var(--radius-md)]" />
        </div>
      ))}
    </main>
  );
}
