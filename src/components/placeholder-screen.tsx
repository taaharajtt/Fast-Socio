import { GlassCard } from "@/components/ui";

/**
 * Temporary screen scaffold for the six primary destinations. Each is replaced
 * by its real feature build in later phases (Home → Phase 4, Discover → Phase 2,
 * Chat → Phase 3, etc.).
 */
export function PlaceholderScreen({
  title,
  subtitle,
  phase,
}: {
  title: string;
  subtitle: string;
  phase: string;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-fg-muted">{subtitle}</p>
      <GlassCard className="mt-6 p-6">
        <p className="text-sm text-fg-muted">
          This screen is scaffolded. The full experience ships in {phase}.
        </p>
      </GlassCard>
    </main>
  );
}
