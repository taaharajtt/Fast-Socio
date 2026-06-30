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
    <div className="auth-gradient relative flex min-h-full flex-1 flex-col items-center justify-center px-6 py-10">
      {children}
    </div>
  );
}
