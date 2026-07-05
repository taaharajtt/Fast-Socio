import { notFound } from "next/navigation";
import { DevLoginForm } from "./dev-login-form";

// TEMPORARY — local dogfooding only. Hard-gated to non-production so the
// hardcoded demo credentials (including an admin account) can never be used
// against a deployed environment.
export default function DevLogin() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevLoginForm />;
}
