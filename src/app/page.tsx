import { redirect } from "next/navigation";

/**
 * App entry. Until the auth gate lands (Phase 1), the root routes straight into
 * the student shell. This becomes a session check / landing split later.
 */
export default function RootPage() {
  redirect("/home");
}
