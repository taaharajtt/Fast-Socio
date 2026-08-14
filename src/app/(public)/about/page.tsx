import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "What FAST SOCIO is and who it's for.",
};

export default function AboutPage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-fg">
      <h1 className="text-2xl font-bold">About FAST SOCIO</h1>

      <p>
        FAST SOCIO is a university-exclusive social platform built for FAST
        NUCES students at the Islamabad campus. Signup is restricted to
        campus email addresses — current students on the{" "}
        <code className="rounded bg-bg-elevated px-1 py-0.5 text-xs">
          isb.nu.edu.pk
        </code>{" "}
        domain, plus older (pre-Fall 2023) Islamabad batches whose email is a
        roll number on the shared{" "}
        <code className="rounded bg-bg-elevated px-1 py-0.5 text-xs">
          nu.edu.pk
        </code>{" "}
        domain. Nobody outside that allow-list can create an account.
      </p>

      <h2 className="text-lg font-semibold">What it does</h2>
      <p>
        Inside the app, students can build a profile, post to a campus feed,
        message each other, join communities and societies, discover people
        and posted opportunities (projects, FYPs, hackathons, sports,
        recruitment) through a swipe-based Discover deck, ask for and offer
        help through Campus Help, and find their way around campus with an
        interactive map.
      </p>

      <h2 className="text-lg font-semibold">Who built it</h2>
      <p>
        FAST SOCIO is built by FAST NUCES students, as a student project — not
        an official university service and not a commercial company.
      </p>

      <h2 className="text-lg font-semibold">What it is not</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>It is not an official FAST NUCES / university-administered system.</li>
        <li>It is not open to the public — access is gated to campus email addresses.</li>
        <li>
          It does not claim any certification, compliance framework, or legal
          guarantee about how it handles data — see the{" "}
          <a href="/privacy" className="underline">
            Privacy
          </a>{" "}
          page for an honest, plain-language account of what is actually
          collected and why.
        </li>
      </ul>
    </article>
  );
}
