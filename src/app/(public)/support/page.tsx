import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support",
  description: "How to get help, report a bug, or report abuse on FAST SOCIO.",
};

export default function SupportPage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-fg">
      <h1 className="text-2xl font-bold">Support</h1>

      <h2 className="text-lg font-semibold">Getting help</h2>
      <p>
        If something isn&apos;t working, or you have a question about your
        account, contact us at the address below.
      </p>

      <h2 className="text-lg font-semibold">Reporting a bug</h2>
      <p>
        Describe what you were doing, what you expected, and what happened
        instead (a screenshot helps a lot), and send it to the address below.
      </p>

      <h2 className="text-lg font-semibold">Reporting abuse or another user</h2>
      <p>
        FAST SOCIO has a built-in report feature. From a post, comment,
        profile, or message, use its report action to flag it for the
        moderation team — this is the fastest way to get abusive content or
        behavior reviewed. You can also block a user from seeing or
        contacting you at any time from Settings → Blocked.
      </p>
      <p>
        If you cannot access the app to file an in-app report (for example,
        your account was suspended), email the address below instead.
      </p>

      <h2 className="text-lg font-semibold">Contact</h2>
      {/* TODO(owner): replace with a real, monitored contact address before launch. */}
      <p>
        <span className="font-medium">
          [CONTACT EMAIL — set before launch]
        </span>
      </p>

      <p className="text-xs text-fg-muted">
        See also our{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a href="/terms" className="underline">
          Terms of Use
        </a>
        .
      </p>
    </article>
  );
}
