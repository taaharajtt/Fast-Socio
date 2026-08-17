import Link from "next/link";

/**
 * Plain public shell for unauthenticated informational pages (/privacy,
 * /terms, /about, /support). Deliberately does NOT reuse the (student) group's
 * layout (bottom nav / authenticated shell) or the (auth) group's gradient
 * pre-login shell — signed-out visitors who are not going through login must
 * get a neutral, static page with no app chrome. The root layout
 * (src/app/layout.tsx) is otherwise neutral (just html/body + providers), so
 * this group only adds a minimal header/footer wrapper on top of it.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <header className="mb-8">
        <Link href="/" className="text-sm font-semibold text-fg">
          FAST SOCIO
        </Link>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-12 flex flex-wrap gap-4 border-t border-glass-border pt-6 text-xs text-fg-muted">
        <Link href="/about" className="hover:text-fg">
          About
        </Link>
        <Link href="/privacy" className="hover:text-fg">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-fg">
          Terms
        </Link>
        <Link href="/support" className="hover:text-fg">
          Support
        </Link>
      </footer>
    </div>
  );
}
