import { Suspense } from "react";
import { RouteFallback } from "@/components/ui/route-fallback";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { EditCommunityForm } from "@/components/communities/edit-community-form";

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
export default function EditCommunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <EditCommunityPageBody params={params} />
    </Suspense>
  );
}

async function EditCommunityPageBody({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = await getAuthUserId();

  const { data: community } = await supabase
    .from("communities")
    .select("id, name, description, cover_url, owner_id")
    .eq("id", id)
    .single();
  if (!community) notFound();
  // Only the owner may edit metadata.
  if (community.owner_id !== userId) redirect(`/communities/${id}`);

  return (
    <EditCommunityForm
      id={community.id}
      initialName={community.name}
      initialDescription={community.description ?? ""}
      initialCoverUrl={community.cover_url ?? null}
    />
  );
}
