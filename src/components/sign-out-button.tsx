"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassButton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { clearBrowserSessionState } from "@/lib/pwa/sign-out-cleanup";
import { clearInboxSnapshot } from "@/lib/chat/inbox-store";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    await createClient().auth.signOut();
    // In-memory stores are browser-held copies of this session's data too, and
    // they are module state: nothing unmounts them on a client-side navigation
    // to /login. Cleared here so the next account in this tab cannot be handed
    // the previous one's inbox for a frame. (`pickFreshestInbox` also refuses a
    // snapshot whose `me` differs — this is the belt to that brace.)
    clearInboxSnapshot();
    // Drop any browser-held copies of this session's data before navigating.
    // Ordered after signOut and before the redirect so nothing can repopulate
    // a cache from a still-valid session. Never throws — see the module note.
    await clearBrowserSessionState();
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
