import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { HelpComposer } from "@/components/help/help-composer";
import { HELP_REQUEST_COLUMNS, type HelpRequestRow } from "@/lib/help/types";

export const metadata = { title: "Edit request · FAST SOCIO" };

export default async function EditHelpPage({
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
