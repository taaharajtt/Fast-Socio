import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EditCommunityForm } from "@/components/communities/edit-community-form";

export default async function EditCommunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: community } = await supabase
    .from("communities")
    .select("id, name, description, cover_url, owner_id")
    .eq("id", id)
    .single();
  if (!community) notFound();
  // Only the owner may edit metadata.
  if (community.owner_id !== user?.id) redirect(`/communities/${id}`);

  return (
    <EditCommunityForm
      id={community.id}
      initialName={community.name}
      initialDescription={community.description ?? ""}
      initialCoverUrl={community.cover_url ?? null}
    />
  );
}
