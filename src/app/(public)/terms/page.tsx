import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The plain-language terms for using FAST SOCIO.",
};

export default function TermsPage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-fg">
      <h1 className="text-2xl font-bold">Terms of Use</h1>

      <div className="glass rounded-[14px] p-4 text-xs text-fg-muted">
        This is our own plain-language terms page, written by the students
        who built FAST SOCIO. It has <strong>not</strong> been reviewed by a
        lawyer and is not a formal legal contract or a substitute for one.
      </div>

      {/* TODO(owner): replace with a real effective date before launch. */}
      <p className="text-xs text-fg-muted">
        Last updated: [EFFECTIVE DATE — set before launch]
      </p>

      <h2 className="text-lg font-semibold">Eligibility</h2>
      <p>
        FAST SOCIO is only for FAST NUCES students. Signup requires a campus
        email address (see{" "}
        <a href="/privacy" className="underline">
          Privacy
        </a>{" "}
        for the exact rule). Do not create an account you are not eligible
        for, and do not share your login.
      </p>

      <h2 className="text-lg font-semibold">Your content</h2>
      <p>
        You are responsible for what you post, message, or upload. Don&apos;t
        post anything illegal, harassing, or that violates someone else&apos;s
        privacy or rights. Moderators can act on reported content or accounts,
        including suspending an account (you would see this as an
        &quot;account suspended&quot; screen).
      </p>

      <h2 className="text-lg font-semibold">No guarantees</h2>
      <p>
        FAST SOCIO is a student-built project, not a commercial or
        professionally-run service. It is provided as-is, without uptime
        guarantees, warranties, or any promise of fitness for a particular
        purpose. Features may change or be removed as the project evolves.
      </p>

      <h2 className="text-lg font-semibold">Account actions</h2>
      <p>
        You can deactivate your own account at any time from Settings →
        Account. We may suspend an account that violates these terms, based
        on a report or other review.
      </p>

      <h2 className="text-lg font-semibold">Changes</h2>
      <p>
        We may update these terms as the app changes. Continued use after an
        update means you accept the current version.
      </p>

      <h2 className="text-lg font-semibold">Contact</h2>
      {/* TODO(owner): replace with a real, monitored contact address before launch. */}
      <p>
        Questions about these terms:{" "}
        <span className="font-medium">
          [CONTACT EMAIL — set before launch]
        </span>
        .
      </p>
    </article>
  );
}
