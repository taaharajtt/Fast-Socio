import { Skeleton } from "@/components/ui/skeleton";

/**
 * Ask for help: the composer form.
 *
 * Nearest boundary was `help/loading.tsx`, which draws the help LIST — rows of
 * requests. This route is a form, so the list skeleton promised content that
 * never arrives and then replaced it wholesale.
 */
export default function NewHelpLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-32" />
      </div>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-2 h-11 w-full rounded-[var(--radius-sm)]" />
      <Skeleton className="mt-5 h-4 w-24" />
      <Skeleton className="mt-2 h-32 w-full rounded-[var(--radius-sm)]" />
      <Skeleton className="mt-5 h-4 w-20" />
      <div className="mt-2 flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <Skeleton className="mt-6 h-11 w-full rounded-full" />
    </main>
  );
}
