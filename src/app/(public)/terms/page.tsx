import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The plain-language terms and agreement for using FAST SOCIO.",
};

export default function TermsPage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-fg">
      <h1 className="text-2xl font-bold">Terms of Use</h1>

      <div className="glass rounded-[14px] p-4 text-xs text-fg-muted">
        This is our own plain-language agreement, written by the students who
        built FAST SOCIO. It has <strong>not</strong> been reviewed by a lawyer
        and is not a formal legal contract or a substitute for one.
      </div>

      {/* TODO(owner): replace with a real effective date before launch. */}
      <p className="text-xs text-fg-muted">
        Last updated: [EFFECTIVE DATE — set before launch]
      </p>

      <p>
        These terms are the agreement between you and the students who run FAST
        SOCIO (&quot;we&quot;, &quot;us&quot;). By creating an account or using
        the app, you agree to them. If you do not agree, please do not use FAST
        SOCIO.
      </p>

      <h2 className="text-lg font-semibold">Who runs this</h2>
      <p>
        FAST SOCIO is an independent, student-built project. It is{" "}
        <strong>not</strong> operated, endorsed, supervised, or officially
        affiliated with FAST NUCES or its administration, and the university is
        not responsible for it. We ask for a campus email address only to check
        that you are a student — that check does not make this a university
        service. University rules and discipline policies still apply to your
        conduct independently of these terms.
      </p>

      <h2 className="text-lg font-semibold">Eligibility</h2>
      <p>
        FAST SOCIO is only for FAST NUCES students. Signup requires a campus
        email address (see{" "}
        <a href="/privacy" className="underline">
          Privacy
        </a>{" "}
        for the exact rule). You must be old enough to consent to using an
        online service where you live. One account per person: do not create an
        account you are not eligible for, do not create an account for someone
        else, and do not share your login or let anyone else use your account.
        You are responsible for everything done through it.
      </p>

      <h2 className="text-lg font-semibold">Your account</h2>
      <p>
        Your username is fixed to your roll number and cannot be changed. Keep
        your profile information accurate, and keep your email and sign-in link
        or password secure. If you think someone else has access to your
        account, sign out other devices at Settings → Devices and contact us.
      </p>

      <h2 className="text-lg font-semibold">Rules of conduct</h2>
      <p>Do not use FAST SOCIO to:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          harass, bully, threaten, stalk, or send unwanted sexual advances to
          anyone;
        </li>
        <li>
          post someone&apos;s private information — phone number, address,
          photos of them, screenshots of private chats — without their consent;
        </li>
        <li>
          impersonate another student, a faculty member, a society, or the
          university;
        </li>
        <li>
          post sexual content involving minors, non-consensual intimate images,
          hate speech, or content that incites violence;
        </li>
        <li>
          post anything illegal under Pakistani law, or use the app to arrange
          anything illegal;
        </li>
        <li>
          use the app for academic dishonesty — selling or distributing exam
          papers, solved assignments, or paid &quot;do my work&quot; services.
          Campus Help is for genuine help, not for cheating;
        </li>
        <li>
          spam, scam, phish, run commercial advertising, or mass-message
          students;
        </li>
        <li>
          scrape, bulk-collect, or republish other students&apos; profiles,
          photos, or posts anywhere outside the app;
        </li>
        <li>
          attack, probe, overload, or try to bypass the app&apos;s security,
          rate limits, or access controls — including accessing data that is not
          yours. Genuine, good-faith security reports are welcome; see{" "}
          <a href="/support" className="underline">
            Support
          </a>
          .
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Your content</h2>
      <p>
        You keep ownership of what you post. By posting, you give us permission
        to store, display, and distribute that content inside the app so the
        features work — showing your post in feeds, delivering your message,
        listing your Campus Help request. This permission is limited to running
        FAST SOCIO; we do not sell your content or license it to anyone else,
        and it ends when the content is removed, except for copies already made
        by other users and copies retained in backups or moderation records.
      </p>
      <p>
        You are responsible for what you post, message, or upload, and you
        confirm you have the right to post it. Remember that other students can
        screenshot, save, or repeat anything you share — including in
        conversations that feel private. Deleting something from FAST SOCIO does
        not delete it from wherever else it has already travelled.
      </p>

      <h2 className="text-lg font-semibold">Anonymous features</h2>
      <p>
        Some features — anonymous Campus Help requests and offers, and anonymous
        community chat — hide your name from other students. This is anonymity{" "}
        <em>from other students only</em>: your identity is still stored on our
        servers, stays attached to the content, and can be seen by moderators.
        Do not treat anonymous posting as untraceable, and do not use it to say
        things you would not stand behind.
      </p>

      <h2 className="text-lg font-semibold">
        Meeting people, communities and events
      </h2>
      <p>
        Discover, Chat, communities, societies, events, and Campus Help connect
        you with other students. We do not vet people, verify claims made in
        profiles, screen communities, or check that events are real, safe, or
        approved. Any decision to meet, collaborate with, lend to, pay, or trust
        another user is yours alone, and you make it at your own risk. Meet in
        public places on campus, tell someone where you are going, and use your
        judgement.
      </p>
      <p>
        FAST SOCIO is not an emergency service. If you are in danger or witness
        something serious, contact campus security, the university
        administration, or the police — do not rely on an in-app report.
      </p>

      <h2 className="text-lg font-semibold">Aura, badges and leaderboard</h2>
      <p>
        Aura points, badges, and leaderboard rank are in-app scores with no
        monetary or real-world value. They can be recalculated, corrected, or
        removed — including by moderators where points were earned through abuse
        or manipulation — and they carry no entitlement of any kind.
      </p>

      <h2 className="text-lg font-semibold">Moderation and enforcement</h2>
      <p>
        Moderators can act on reported content and accounts: removing or hiding
        content, issuing strikes, restricting features, and suspending or
        banning an account (you would see this as an &quot;account
        suspended&quot; screen). We can also act without a report where we
        believe these terms have been broken or someone is at risk. If you think
        an action against your account was wrong, you can submit an appeal from
        the app.
      </p>

      <h2 className="text-lg font-semibold">Account actions</h2>
      <p>
        You can deactivate your own account at any time from Settings → Account,
        which hides your profile and pauses the account; you can reactivate it
        later. See{" "}
        <a href="/privacy" className="underline">
          Privacy
        </a>{" "}
        for what happens to your data, and for how to request permanent
        deletion.
      </p>

      <h2 className="text-lg font-semibold">No guarantees</h2>
      <p>
        FAST SOCIO is a student-built project, not a commercial or
        professionally-run service. It is provided <strong>as-is</strong>,
        without uptime guarantees, warranties, or any promise of fitness for a
        particular purpose. Features may change, break, or be removed as the
        project evolves, and data can be lost. To the fullest extent the law
        allows, we are not liable for any loss or damage arising from your use
        of the app, from content posted by other users, or from anything that
        happens between you and someone you met through it.
      </p>

      <h2 className="text-lg font-semibold">Changes to these terms</h2>
      <p>
        We may update these terms as the app changes. We will change the date at
        the top; continued use after an update means you accept the current
        version.
      </p>

      <h2 className="text-lg font-semibold">Governing law</h2>
      <p>
        These terms are governed by the laws of Pakistan, and any dispute is
        subject to the courts of Islamabad.
      </p>

      <h2 className="text-lg font-semibold">Contact</h2>
      {/* TODO(owner): replace with a real, monitored contact address before launch. */}
      <p>
        Questions about these terms:{" "}
        <span className="font-medium">[CONTACT EMAIL — set before launch]</span>
        .
      </p>
    </article>
  );
}
