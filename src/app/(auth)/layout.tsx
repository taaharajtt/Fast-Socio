/**
 * Pre-login shell. Auth screens are the only place that use the full-bleed
 * gradient background (UI Spec §2.2 exception); all post-login screens use the
 * flat dark/light glass surfaces.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-gradient relative flex min-h-full flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10">
      {/* V3 Screen 1: a single soft purple halo from top-center (the radial
          auth-gradient carries most of it; this deepens the glow). */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full opacity-40 [background:radial-gradient(circle,#7c3aed,transparent_70%)]"
      />
      <div className="relative z-10 flex w-full flex-col items-center">{children}</div>
    </div>
  );
}
