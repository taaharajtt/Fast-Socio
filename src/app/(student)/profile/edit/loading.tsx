import { Skeleton } from "@/components/ui/skeleton";

/** Edit profile: header, avatar picker, stacked form fields, save bar. */
export default function EditProfileLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-4">
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-28" />
      </div>

      <div className="mb-6 flex justify-center">
        <Skeleton className="h-24 w-24 rounded-full" />
      </div>

      <div className="space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-11 w-full rounded-[var(--radius-sm)]" />
          </div>
        ))}
        <Skeleton className="h-24 w-full rounded-[var(--radius-sm)]" />
      </div>

      <Skeleton className="mt-6 h-12 w-full rounded-[var(--radius-pill)]" />
    </main>
  );
}
