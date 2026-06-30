"use client";

import { useState } from "react";
import {
  GlassButton,
  GlassCard,
  GlassChip,
  GlassInput,
  SegmentedPills,
} from "@/components/ui";

/**
 * Temporary design-system showcase for the glass primitives (Task #001d).
 * Replaced by the real Home feed in Phase 4.
 */
export default function Home() {
  const [tab, setTab] = useState("foryou");
  const [email, setEmail] = useState("");
  const invalid = email.length > 0 && !email.endsWith("@nu.edu.pk");

  return (
    <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-10">
      {/* Ambient brand glow behind the glass */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-70"
        style={{
          background:
            "radial-gradient(40rem 30rem at 20% -10%, rgba(124,92,255,0.25), transparent), radial-gradient(35rem 25rem at 90% 10%, rgba(0,212,255,0.18), transparent)",
        }}
      />

      <header className="space-y-1">
        <p className="text-sm text-fg-muted">Design system preview</p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          <span className="gradient-brand-text">FAST SOCIO</span>
        </h1>
        <p className="text-fg-muted">Liquid Glass primitives · UI Spec v2</p>
      </header>

      <SegmentedPills
        scrollable
        value={tab}
        onChange={setTab}
        options={[
          { value: "foryou", label: "For You" },
          { value: "astrology", label: "Astrology" },
          { value: "double", label: "Double Date" },
          { value: "nearby", label: "Nearby" },
        ]}
      />

      <GlassCard radius="card" className="relative overflow-hidden p-5">
        <div className="absolute right-4 top-4 flex gap-2">
          <GlassChip tone="cyan">96% match</GlassChip>
          <GlassChip tone="aura">★ 1,240</GlassChip>
        </div>
        <div className="mt-10 space-y-1">
          <h2 className="text-2xl font-bold">Ayesha · 21</h2>
          <p className="text-fg-muted">Computer Science · 5th Semester</p>
          <p className="text-sm text-fg-muted">
            &ldquo;Looking for a hackathon teammate &#9749;&rdquo;
          </p>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <GlassButton variant="glass" size="icon" aria-label="Pass">
            ✕
          </GlassButton>
          <GlassButton variant="glass" size="icon" aria-label="Message">
            ✉
          </GlassButton>
          <GlassButton variant="primary" size="icon" aria-label="Like">
            ♥
          </GlassButton>
        </div>
      </GlassCard>

      <GlassCard className="space-y-3 p-5">
        <label className="text-sm font-medium">FAST email</label>
        <GlassInput
          type="email"
          inputMode="email"
          placeholder="k21-1234@nu.edu.pk"
          value={email}
          invalid={invalid}
          onChange={(e) => setEmail(e.target.value)}
        />
        {invalid && (
          <p className="text-sm text-error">
            Use your @nu.edu.pk university email.
          </p>
        )}
        <GlassButton variant="primary" size="lg" className="w-full">
          Continue
        </GlassButton>
        <GlassButton variant="glass" size="lg" className="w-full">
          Continue with Google
        </GlassButton>
      </GlassCard>

      <div className="flex flex-wrap gap-2">
        <GlassChip tone="success">Verified</GlassChip>
        <GlassChip tone="warning">Pending</GlassChip>
        <GlassChip tone="error">Reported</GlassChip>
        <GlassChip>Neutral</GlassChip>
      </div>
    </main>
  );
}
