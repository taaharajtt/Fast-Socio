import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth/user";
import { HelpComposer } from "@/components/help/help-composer";

export const metadata = { title: "Ask for help · FAST SOCIO" };

export default async function NewHelpPage() {
  const uid = await getAuthUserId();
  if (!uid) redirect("/login");

  // Semester/school/department/course are shown from the profile at read time,
  // so the composer collects only title, body, category, and the two toggles.
  return <HelpComposer />;
}
