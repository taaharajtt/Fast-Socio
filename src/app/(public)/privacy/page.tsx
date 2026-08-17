import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What FAST SOCIO collects, why, and how you can control it.",
};

export default function PrivacyPage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-fg">
      <h1 className="text-2xl font-bold">Privacy Policy</h1>

      <div className="glass rounded-[14px] p-4 text-xs text-fg-muted">
        This is our own plain-language policy, written by the students who
        built FAST SOCIO. It has <strong>not</strong> been reviewed by a
        lawyer and is not a substitute for one. It does not claim compliance
        with any specific data-protection law (e.g. GDPR, CCPA) — it is
        simply an honest description of what the app collects and how you can
        control it.
      </div>

      {/* TODO(owner): replace with a real effective date before launch. */}
      <p className="text-xs text-fg-muted">
        Last updated: [EFFECTIVE DATE — set before launch]
      </p>

      <h2 className="text-lg font-semibold">Who can use this</h2>
      <p>
        FAST SOCIO is restricted to FAST NUCES students. Account creation
        requires a campus email address on the{" "}
        <code className="rounded bg-bg-elevated px-1 py-0.5 text-xs">
          isb.nu.edu.pk
        </code>{" "}
        domain, or (for pre-Fall 2023 batches) a roll-number address on the
        shared{" "}
        <code className="rounded bg-bg-elevated px-1 py-0.5 text-xs">
          nu.edu.pk
        </code>{" "}
        domain.
      </p>

      <h2 className="text-lg font-semibold">What we collect</h2>
      <p>Derived from the app&apos;s own data export, this is everything tied to your account:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Account &amp; profile:</strong> your campus email, username
          (fixed to your roll number), full name, department, semester, bio,
          avatar image, and an in-app &quot;aura&quot; score.
        </li>
        <li>
          <strong>Privacy &amp; matching preferences:</strong> location and
          discoverability settings you choose in Settings.
        </li>
        <li>
          <strong>Activity:</strong> posts, comments, likes, messages you
          send, swipes and matches in Discover, community/society
          memberships, event hosting and RSVPs, Campus Help requests and
          responses, and notifications.
        </li>
        <li>
          <strong>Moderation data:</strong> users you block, and reports you
          file against content or other users.
        </li>
        <li>
          <strong>Device data:</strong> push-notification subscriptions for
          devices where you enable notifications, and basic session/device
          records for sign-in.
        </li>
        <li>
          <strong>Uploaded media:</strong> images/files you upload (avatar,
          post media, chat attachments), stored in object storage.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Why we collect it</h2>
      <p>
        Solely to operate the app&apos;s features described above — building
        your profile, showing your feed, running Discover, delivering
        messages and notifications, and letting moderators act on reports. We
        do not sell data, and we do not use it for advertising.
      </p>

      <h2 className="text-lg font-semibold">Who processes it</h2>
      <p>The app is built on the following third-party infrastructure, each of which processes some data on our behalf to run the service:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Supabase</strong> — hosts the database, authentication, and
          realtime messaging.
        </li>
        <li>
          <strong>Vercel</strong> — hosts and serves the application
          (deployment platform), and provides Vercel Analytics and Speed
          Insights (aggregate usage/performance metrics).
        </li>
        <li>
          <strong>Sentry</strong> — error monitoring, so we can find and fix
          bugs (can include stack traces tied to a request).
        </li>
        <li>
          An S3-compatible object storage provider — stores uploaded media
          (avatars, post images, chat attachments).
        </li>
        <li>
          A web-push service (via the standard Web Push protocol) — delivers
          push notifications to devices that opt in.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">How long we keep it</h2>
      <p>
        We keep account and activity data for as long as your account exists.
        Deactivating your account (see below) hides your profile from
        Discover and marks it dormant, but preserves your data so
        reactivation restores everything. We do not currently offer permanent
        account/data deletion from within the app; if you want your data
        permanently deleted, use the contact below.
      </p>

      <h2 className="text-lg font-semibold">Your controls</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Privacy toggles</strong> (discoverability, search
          visibility, online status, read receipts, and what shows on your
          profile) — in-app at Settings → Privacy.
        </li>
        <li>
          <strong>Blocked users</strong> — manage who you&apos;ve blocked at
          Settings → Blocked.
        </li>
        <li>
          <strong>Data export</strong> — download a JSON copy of everything
          tied to your account from Settings → Export Data.
        </li>
        <li>
          <strong>Deactivate account</strong> — hide your profile and pause
          the account (reversible) from Settings → Account.
        </li>
        <li>
          <strong>Reporting &amp; blocking abuse</strong> — report a post,
          comment, profile, or message directly from its report action in the
          app; see{" "}
          <a href="/support" className="underline">
            Support
          </a>{" "}
          for details.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Contact</h2>
      {/* TODO(owner): replace with a real, monitored contact address before launch. */}
      <p>
        Questions about this policy or a request regarding your data:{" "}
        <span className="font-medium">
          [CONTACT EMAIL — set before launch]
        </span>
        .
      </p>
    </article>
  );
}
