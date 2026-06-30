import { FloatingDock } from "@/components/floating-dock";

/**
 * Shell for the logged-in student experience. Hosts the floating glass dock and
 * reserves bottom space so scrollable content clears it. All six primary
 * destinations live under this route group.
 */
export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      {/* Ambient brand glow shared across student screens */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(40rem 30rem at 15% -10%, rgba(124,92,255,0.22), transparent), radial-gradient(35rem 25rem at 95% 5%, rgba(0,212,255,0.16), transparent)",
        }}
      />
      <div className="flex-1 pb-28">{children}</div>
      <FloatingDock />
    </div>
  );
}
