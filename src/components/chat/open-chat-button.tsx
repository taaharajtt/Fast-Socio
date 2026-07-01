"use client";

import { useTransition } from "react";
import { GlassButton } from "@/components/ui";
import { openConversation } from "@/app/(student)/chat/actions";

/** Opens (or creates) a conversation with `otherId`; the action redirects. */
export function OpenChatButton({ otherId }: { otherId: string }) {
  const [pending, start] = useTransition();
  return (
    <GlassButton
      variant="primary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await openConversation(otherId);
        })
      }
    >
      {pending ? "Opening…" : "Message"}
    </GlassButton>
  );
}
