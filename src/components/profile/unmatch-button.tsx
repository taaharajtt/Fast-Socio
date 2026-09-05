"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartOff } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { unmatchUser } from "@/app/(student)/profile/matches/actions";

/**
 * Unmatch, on your own matches list only.
 *
 * Destructive and not undoable from the UI, so it goes through the app's one
 * confirm dialog rather than firing on tap. The button is `disabled` while the
 * action is in flight (and the dialog ignores backdrop/Escape while pending),
 * so a double tap cannot submit twice — and even if one did, `unmatch_user` is
 * idempotent.
 *
 * On success the row is hidden immediately and the route refreshed, so the
 * count in the header and the profile stat catch up without a reload.
 */
export function UnmatchButton({
  otherId,
  name,
}: {
  otherId: string;
  name: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) return null;

  function confirm() {
    setError(null);
    start(async () => {
      const res = await unmatchUser(otherId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      setDone(true);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label={`Unmatch ${name ?? "this person"}`}
        // 44px tall: a destructive control needs a real tap target on a phone.
        className="pressable focus-ring flex h-11 items-center gap-1.5 rounded-full bg-fill px-4 text-sm font-semibold text-error disabled:opacity-50"
      >
        <HeartOff className="h-4 w-4" aria-hidden />
        {pending ? "Unmatching…" : "Unmatch"}
      </button>

      <ConfirmDialog
        open={confirming}
        title={`Unmatch ${name ?? "this person"}?`}
        description="You'll both stop appearing in each other's matches and your chat will close. You can match again if you both like each other in Discover."
        confirmLabel="Unmatch"
        pendingLabel="Unmatching…"
        onConfirm={confirm}
        onCancel={() => {
          setConfirming(false);
          setError(null);
        }}
        pending={pending}
        error={error}
      />
    </>
  );
}
