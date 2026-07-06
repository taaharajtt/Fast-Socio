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
      {/* Ambient orbs (Figma prototype) — soft radial glows behind the glass. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full opacity-30 [background:radial-gradient(circle,#c850c0,transparent_68%)]" />
        <div className="absolute -right-20 bottom-24 h-72 w-72 rounded-full opacity-25 [background:radial-gradient(circle,#7c5cff,transparent_68%)]" />
        <div className="absolute right-8 top-1/2 h-40 w-40 rounded-full opacity-[0.14] [background:radial-gradient(circle,#00d4ff,transparent_70%)]" />
      </div>
      <div className="relative z-10 flex w-full flex-col items-center">{children}</div>
    </div>
  );
}
