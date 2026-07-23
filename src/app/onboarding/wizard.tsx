"use client";

import { useRef, useState, useTransition } from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { saveOnboardingStep, saveProfile, type OnboardingDraft } from "./actions";
import {
  BIO_MAX,
  DEPARTMENTS,
  GENDERS,
  graduationYears,
  HOSTEL_STATUS,
  INTERESTS,
  LANGUAGES,
  MAX_INTERESTS,
  MAX_LANGUAGES,
  MAX_PERSONALITY,
  MIN_INTERESTS,
  PERSONALITY_TRAITS,
  RELATIONSHIP_PREFS,
} from "@/lib/profile/constants";

const STEPS = [
  "Photo",
  "Academics",
  "Interests",
  "Personality",
  "About you",
  "Discover",
  "Bio",
];

/**
 * Multi-step onboarding wizard (Refactor Phase 2). Extends the original 4-step
 * flow into a full identity-vector capture. Every "Continue" autosaves the
 * partial draft server-side (saveOnboardingStep) so progress survives a reload
 * or a closed tab; the final step calls saveProfile which validates required
 * fields, awards the completion bonus, and routes to /home.
 */
export function OnboardingWizard({
  initial,
  initialStep,
}: {
  initial: OnboardingDraft;
  initialStep: number;
}) {
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(
    Math.max(0, Math.min(initialStep, STEPS.length - 1))
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  // Draft state — seeded from any previously saved progress.
  const [fullName, setFullName] = useState(initial.fullName ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    initial.avatarUrl ?? null
  );
  const [uploading, setUploading] = useState(false);
  const [department, setDepartment] = useState(initial.department ?? "");
  const [gender, setGender] = useState<string | null>(initial.gender ?? null);
  const [gradYear, setGradYear] = useState<number | null>(
    initial.graduationYear ?? null
  );
  const [hostel, setHostel] = useState<string | null>(
    initial.hostelStatus ?? null
  );
  const [interests, setInterests] = useState<string[]>(initial.interests ?? []);
  const [personality, setPersonality] = useState<string[]>(
    initial.personality ?? []
  );
  const [languages, setLanguages] = useState<string[]>(initial.languages ?? []);
  const [pronouns, setPronouns] = useState(initial.pronouns ?? "");
  const [hometown, setHometown] = useState(initial.hometown ?? "");
  const [relPref, setRelPref] = useState<string | null>(
    initial.relationshipPref ?? null
  );
  const [prefGenders, setPrefGenders] = useState<string[]>(
    initial.prefGenders ?? []
  );
  const [prefVerified, setPrefVerified] = useState(
    initial.prefVerifiedOnly ?? false
  );
  const [bio, setBio] = useState(initial.bio ?? "");

  function draft(): OnboardingDraft {
    return {
      fullName,
      avatarUrl,
      department,
      gender,
      graduationYear: gradYear,
      hostelStatus: hostel,
      interests,
      personality,
      languages,
      pronouns,
      hometown,
      relationshipPref: relPref,
      prefGenders,
      prefVerifiedOnly: prefVerified,
      bio,
    };
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      setError("You are not signed in.");
      return;
    }
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setUploading(false);
      setError(upErr.message);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
    setUploading(false);
  }

  function toggle(
    value: string,
    list: string[],
    setList: (v: string[]) => void,
    max: number
  ) {
    setList(
      list.includes(value)
        ? list.filter((t) => t !== value)
        : list.length < max
          ? [...list, value]
          : list
    );
  }

  // Only the originally-required fields gate progression; the new identity
  // steps are always skippable (they enrich, they don't block).
  const stepValid = [
    fullName.trim().length >= 2,
    Boolean(department),
    interests.length >= MIN_INTERESTS,
    true, // personality
    true, // about you
    true, // discover
    bio.length <= BIO_MAX,
  ][step];

  const isLast = step === STEPS.length - 1;

  function next() {
    setError(null);
    if (!isLast) {
      const nextStep = step + 1;
      // Fire-and-forget autosave so progress persists without blocking the UI.
      void saveOnboardingStep(draft(), nextStep);
      setStep(nextStep);
      return;
    }
    startSaving(async () => {
      const res = await saveProfile(draft());
      if (res?.error) setError(res.error);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-8 pb-32">
      {/* Thin progress bar (UI Spec §5.2: not numbered dots) */}
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-glass">
        <div
          className="h-full rounded-full bg-aura transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>
      <p className="mb-6 text-sm text-fg-muted">
        Step {step + 1} of {STEPS.length} · {STEPS[step]}
      </p>

      {step === 0 && (
        <section className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold">Add a photo</h1>
            <p className="mt-1 text-fg-muted">Help people recognize you.</p>
          </div>
          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="glass relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-full text-fg-muted"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt="Your avatar"
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="text-sm">
                  {uploading ? "Uploading…" : "Tap to add"}
                </span>
              )}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={onPickFile}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Display name
            </label>
            <GlassInput
              id="name"
              placeholder="Your name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Your academics</h1>
            <p className="mt-1 text-fg-muted">
              Your school. Your semester is set automatically from your roll
              number.
            </p>
          </div>
          <Field label="School">
            <PillRow>
              {DEPARTMENTS.map((d) => (
                <Pill key={d} active={department === d} onClick={() => setDepartment(d)}>
                  {d}
                </Pill>
              ))}
            </PillRow>
          </Field>
          <Field label="Gender" optional>
            <PillRow>
              {GENDERS.map((g) => (
                <Pill
                  key={g.value}
                  active={gender === g.value}
                  onClick={() => setGender(gender === g.value ? null : g.value)}
                >
                  {g.label}
                </Pill>
              ))}
            </PillRow>
          </Field>
          <Field label="Expected graduation" optional>
            <PillRow>
              {graduationYears().map((y) => (
                <Pill key={y} active={gradYear === y} onClick={() => setGradYear(gradYear === y ? null : y)}>
                  {y}
                </Pill>
              ))}
            </PillRow>
          </Field>
          <Field label="Living" optional>
            <PillRow>
              {HOSTEL_STATUS.map((h) => (
                <Pill key={h.value} active={hostel === h.value} onClick={() => setHostel(hostel === h.value ? null : h.value)}>
                  {h.label}
                </Pill>
              ))}
            </PillRow>
          </Field>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Your interests</h1>
            <p className="mt-1 text-fg-muted">
              Pick {MIN_INTERESTS}–{MAX_INTERESTS}. ({interests.length} selected)
            </p>
          </div>
          <PillRow>
            {INTERESTS.map((tag) => (
              <Pill
                key={tag}
                active={interests.includes(tag)}
                onClick={() => toggle(tag, interests, setInterests, MAX_INTERESTS)}
              >
                {tag}
              </Pill>
            ))}
          </PillRow>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Your vibe</h1>
            <p className="mt-1 text-fg-muted">
              Pick up to {MAX_PERSONALITY} that fit you. ({personality.length}{" "}
              selected)
            </p>
          </div>
          <PillRow>
            {PERSONALITY_TRAITS.map((t) => (
              <Pill
                key={t}
                active={personality.includes(t)}
                onClick={() =>
                  toggle(t, personality, setPersonality, MAX_PERSONALITY)
                }
              >
                {t}
              </Pill>
            ))}
          </PillRow>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">A bit about you</h1>
            <p className="mt-1 text-fg-muted">All optional — helps us match you.</p>
          </div>
          <Field label={`Languages (up to ${MAX_LANGUAGES})`} optional>
            <PillRow>
              {LANGUAGES.map((l) => (
                <Pill
                  key={l}
                  active={languages.includes(l)}
                  onClick={() => toggle(l, languages, setLanguages, MAX_LANGUAGES)}
                >
                  {l}
                </Pill>
              ))}
            </PillRow>
          </Field>
          <Field label="Looking for" optional>
            <PillRow>
              {RELATIONSHIP_PREFS.map((r) => (
                <Pill key={r.value} active={relPref === r.value} onClick={() => setRelPref(relPref === r.value ? null : r.value)}>
                  {r.label}
                </Pill>
              ))}
            </PillRow>
          </Field>
          <Field label="Pronouns" optional>
            <GlassInput
              placeholder="e.g. she/her"
              value={pronouns}
              maxLength={40}
              onChange={(e) => setPronouns(e.target.value)}
            />
          </Field>
          <Field label="Hometown" optional>
            <GlassInput
              placeholder="e.g. Lahore"
              value={hometown}
              maxLength={60}
              onChange={(e) => setHometown(e.target.value)}
            />
          </Field>
        </section>
      )}

      {step === 5 && (
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Who you&apos;ll discover</h1>
            <p className="mt-1 text-fg-muted">
              Shape your Discover deck. You can change this later in Settings.
            </p>
          </div>
          <Field label="Show me" optional>
            <PillRow>
              {GENDERS.filter((g) => g.value !== "prefer_not_to_say").map((g) => (
                <Pill
                  key={g.value}
                  active={prefGenders.includes(g.value)}
                  onClick={() => toggle(g.value, prefGenders, setPrefGenders, 4)}
                >
                  {g.label}
                </Pill>
              ))}
            </PillRow>
          </Field>
          <Field label="Verified students only" optional>
            <PillRow>
              <Pill active={prefVerified} onClick={() => setPrefVerified(true)}>
                Yes
              </Pill>
              <Pill active={!prefVerified} onClick={() => setPrefVerified(false)}>
                No
              </Pill>
            </PillRow>
          </Field>
        </section>
      )}

      {step === 6 && (
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">About you</h1>
            <p className="mt-1 text-fg-muted">A short bio (optional).</p>
          </div>
          <GlassCard className="p-1">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
              placeholder="Looking for a hackathon teammate ☕"
              rows={5}
              className="w-full resize-none rounded-[20px] bg-transparent p-4 text-[15px] text-fg outline-none placeholder:text-fg-muted"
            />
          </GlassCard>
          <p className="text-right text-xs text-fg-muted">
            {bio.length}/{BIO_MAX}
          </p>
        </section>
      )}

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      {/* Pinned bottom CTA (UI Spec §5.2) */}
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex gap-3">
          {step > 0 && (
            <GlassButton
              variant="glass"
              size="lg"
              onClick={() => setStep((s) => s - 1)}
              disabled={isSaving}
            >
              Back
            </GlassButton>
          )}
          <GlassButton
            size="lg"
            className="flex-1"
            onClick={next}
            disabled={!stepValid || uploading || isSaving}
          >
            {isSaving ? "Saving…" : isLast ? "Finish" : "Continue"}
          </GlassButton>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">
        {label}{" "}
        {optional && <span className="text-fg-muted">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

function PillRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        active
          ? "bg-aura text-white shadow-[0_4px_16px_rgba(124,92,255,0.35)]"
          : "glass text-fg-muted hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}
