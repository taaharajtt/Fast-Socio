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
        This is our own plain-language policy, written by the students who built
        FAST SOCIO. It has <strong>not</strong> been reviewed by a lawyer and is
        not a substitute for one. It does not claim compliance with any specific
        data-protection law (e.g. GDPR, CCPA) — it is simply an honest
        description of what the app collects and how you can control it.
      </div>

      {/* TODO(owner): replace with a real effective date before launch. */}
      <p className="text-xs text-fg-muted">
        Last updated: [EFFECTIVE DATE — set before launch]
      </p>

      <h2 className="text-lg font-semibold">Who runs FAST SOCIO</h2>
      <p>
        FAST SOCIO is an independent, student-built project. It is{" "}
        <strong>not</strong> operated, endorsed, or officially affiliated with
        FAST NUCES, and the university does not run this app or hold the data
        described below. We ask for a campus email address only to verify that
        you are a student.
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
      <p>
        Derived from the app&apos;s own data export, this is everything tied to
        your account:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Account &amp; profile:</strong> your campus email, username
          (fixed to your roll number), full name, department, semester, bio,
          gender, avatar image, and an in-app &quot;aura&quot; score.
        </li>
        <li>
          <strong>Privacy &amp; matching preferences:</strong> the
          discoverability and visibility settings you choose in Settings, and
          your Discover preferences — including which genders you want to be
          matched with, which is used to build your deck.
        </li>
        <li>
          <strong>Activity:</strong> posts, comments, likes, messages you send,
          swipes and matches in Discover, community/society memberships, event
          hosting and RSVPs, Campus Help requests and responses, and
          notifications.
        </li>
        <li>
          <strong>Moderation data:</strong> users you block or mute, reports you
          file against content or other users, reports filed about you, strikes,
          and appeals you submit.
        </li>
        <li>
          <strong>Session &amp; device data:</strong> for each signed-in device
          we store the browser/device identifier (user agent), the IP address
          the session was seen from, and when it was last active — this is what
          Settings → Devices shows you, so you can spot and revoke a session you
          do not recognise. We also store push-notification subscriptions for
          devices where you turn notifications on.
        </li>
        <li>
          <strong>Uploaded media:</strong> images and files you upload (avatar,
          post media, chat attachments), stored in object storage.
        </li>
      </ul>
      <p>
        We do not collect your device&apos;s GPS location. The Campus Map is a
        static map image with fixed pins — it does not track where you are.
      </p>

      <h2 className="text-lg font-semibold">Why we collect it</h2>
      <p>
        Solely to operate the app&apos;s features described above — building
        your profile, showing your feed, running Discover, delivering messages
        and notifications, keeping your account secure, and letting moderators
        act on reports. We do not sell data, and we do not use it for
        advertising.
      </p>

      <h2 className="text-lg font-semibold">What other students can see</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Your profile</strong> — name, roll number, department,
          semester, bio, avatar and badges are visible to other signed-in
          students, subject to your Settings → Privacy toggles.
        </li>
        <li>
          <strong>Your aura score and leaderboard rank</strong> are public to
          other students: the leaderboard ranks students against each other by
          aura.
        </li>
        <li>
          <strong>Posts, comments, communities and events</strong> are visible
          to the students the feature is designed to show them to. Assume
          anything you post can be screenshotted.
        </li>
        <li>
          <strong>Anonymous Campus Help posts and anonymous community chat</strong>{" "}
          hide your name from other students, but not from us: your identity is
          stored on our servers, stays attached to the content, and can be seen
          by moderators. Anonymity here is from other students only.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Moderation access</h2>
      <p>
        Moderators can review content — including reported conversations — when
        investigating reports or enforcing the{" "}
        <a href="/terms" className="underline">
          Terms
        </a>
        . This access is recorded in an internal audit log. Direct messages are
        not end-to-end encrypted, so you should not treat them as technically
        private from the people running the app.
      </p>

      <h2 className="text-lg font-semibold">Who processes it</h2>
      <p>
        The app is built on the following third-party infrastructure, each of
        which processes some data on our behalf to run the service:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Supabase</strong> — hosts the database, authentication, and
          realtime messaging.
        </li>
        <li>
          <strong>Vercel</strong> — hosts and serves the application (deployment
          platform), and provides Vercel Analytics and Speed Insights (aggregate
          usage and performance metrics).
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
      <p>
        These providers host data on servers outside Pakistan, so using FAST
        SOCIO means your data is stored abroad. We may also disclose data where
        we are legally required to, or where we believe it is necessary to
        prevent serious harm.
      </p>

      <h2 className="text-lg font-semibold">How long we keep it</h2>
      <p>
        We keep account and activity data for as long as your account exists.
        Deactivating your account (see below) hides your profile from Discover
        and marks it dormant, but preserves your data so reactivation restores
        everything. We do not currently offer permanent account/data deletion
        from within the app; if you want your data permanently deleted, use the
        contact below. Some records may be retained after deletion where we need
        them for moderation or safety — for example a ban record, so a banned
        account cannot simply be recreated.
      </p>

      <h2 className="text-lg font-semibold">Security</h2>
      <p>
        Access to data is restricted at the database level per user, uploads are
        access-controlled, and admin actions are audited. That said, FAST SOCIO
        is a student-built project with no security guarantee — no system is
        perfectly secure, and you should not store anything here that would be
        seriously harmful if exposed.
      </p>

      <h2 className="text-lg font-semibold">Your controls</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Privacy toggles</strong> (discoverability, search visibility,
          online status, read receipts, and what shows on your profile) — in-app
          at Settings → Privacy.
        </li>
        <li>
          <strong>Blocked users</strong> — manage who you&apos;ve blocked at
          Settings → Blocked.
        </li>
        <li>
          <strong>Devices &amp; sessions</strong> — see where your account is
          signed in and revoke a session at Settings → Devices.
        </li>
        <li>
          <strong>Notifications</strong> — turn push notifications on or off per
          device at Settings → Notifications.
        </li>
        <li>
          <strong>Data export</strong> — download a JSON copy of everything tied
          to your account from Settings → Export Data.
        </li>
        <li>
          <strong>Deactivate account</strong> — hide your profile and pause the
          account (reversible) from Settings → Account.
        </li>
        <li>
          <strong>Permanent deletion</strong> — not yet available in-app; email
          the contact below and we will delete your account and data manually.
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

      <h2 className="text-lg font-semibold">Changes to this policy</h2>
      <p>
        We will update this page as the app changes and change the date at the
        top. If a change materially affects what we collect or who can see it,
        we will try to tell you in the app rather than only editing this page.
      </p>

      <h2 className="text-lg font-semibold">Contact</h2>
      {/* TODO(owner): replace with a real, monitored contact address before launch. */}
      <p>
        Questions about this policy, or a request regarding your data:{" "}
        <span className="font-medium">[CONTACT EMAIL — set before launch]</span>
        .
      </p>
    </article>
  );
}
