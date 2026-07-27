/**
 * Onboarding shell. No dock — this is a focused, single-task flow.
 *
 * Both gates that used to live here (no session → /login, already-onboarded →
 * /home) now run in the proxy/middleware, which was already reading this user's
 * profile row on every request. That makes this layout fully static, so the
 * wizard's shell is part of the prerendered output instead of waiting on two
 * sequential round trips before anything paints.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(40rem 30rem at 15% -10%, rgba(124,92,255,0.22), transparent), radial-gradient(35rem 25rem at 95% 5%, rgba(0,212,255,0.16), transparent)",
        }}
      />
      {children}
    </div>
  );
}
