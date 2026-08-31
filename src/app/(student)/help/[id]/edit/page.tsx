import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { HelpComposer } from "@/components/help/help-composer";
import { HELP_REQUEST_COLUMNS, type HelpRequestRow } from "@/lib/help/types";

export const metadata = { title: "Edit request · FAST SOCIO" };

/**
 * PERF/CORRECTNESS (perf audit Phase 4) — this default export is deliberately
 * NOT async and never awaits `params`/`searchParams`. Under Cache Components,
 * reading request data (or calling `notFound()`) at the top level makes the
 * route dynamic while Next is still building its fallback shell; resuming that
 * shell then throws
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided        (E592)
 *
 * which surfaces as a 500. The request-scoped work lives in the async body
 * below, behind a Suspense boundary. Same shape as /post/[id], which hit this
 * exact bug first and documents it.
 */
/** Form-shaped placeholder for this editor. Static: no auth, no queries. */
function EditFormSkeleton() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-28" />
      </div>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-2 h-11 w-full rounded-[var(--radius-sm)]" />
      <Skeleton className="mt-5 h-4 w-24" />
      <Skeleton className="mt-2 h-32 w-full rounded-[var(--radius-sm)]" />
      <Skeleton className="mt-6 h-11 w-full rounded-full" />
    </main>
  );
}

export default function EditHelpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<EditFormSkeleton />}>
      <EditHelpPageBody params={params} />
    </Suspense>
  );
}

async function EditHelpPageBody({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const uid = await getAuthUserId();
  if (!uid) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("help_request_feed")
    .select(HELP_REQUEST_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const req = data as unknown as HelpRequestRow;
  // Only the owner may edit, and only while open — otherwise bounce to the thread.
  if (!req.is_mine || req.status !== "open") redirect(`/help/${id}`);

  return (
    <HelpComposer
      initial={{
        id: req.id,
        title: req.title,
        body: req.body,
        category: req.category,
        urgency: req.urgency,
        is_anonymous: req.is_anonymous,
      }}
    />
  );
}
