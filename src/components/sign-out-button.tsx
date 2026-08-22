"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassButton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <GlassButton
      variant="glass"
      size="md"
      onClick={signOut}
      disabled={loading}
    >
      {loading ? "Signing out…" : "Sign out"}
    </GlassButton>
  );
}
