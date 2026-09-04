"use client";

import { useRef, useState, useTransition } from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { uploadWithProgress, publicStorageUrl } from "@/lib/storage-upload";
import { InstallStep } from "@/components/pwa/install-step";
import { saveOnboardingStep, saveProfile, type OnboardingDraft } from "./actions";
import {
  BIO_MAX,
  DEPARTMENTS,
  getDegreesForSchool,
  INTERESTS,
  MIN_INTERESTS,
  SELECTABLE_GENDERS,
} from "@/lib/profile/constants";

const STEPS = [
  "Photo",
  "Academics",
  "Interests",
  "Bio",
  // The install ask. Last on purpose — see the note in <InstallStep/>: this is
  // the point of peak commitment, and the only moment in the whole journey
  // where asking pre-empts a return trip instead of interrupting one. It is
  // skippable ("Finish" is always enabled on this step).
  "Home Screen",
];

/**
 * Onboarding wizard. Collects only what every FAST SOCIO account must have:
 * a real photo and name, school + degree, gender, five interests, and an
 * optional bio. Every "Continue" autosaves the partial draft server-side
 * (saveOnboardingStep) so progress survives a reload or a closed tab; the final
 * step calls saveProfile which re-validates the required fields and routes to
 * /home.
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
  const [degree, setDegree] = useState<string | null>(initial.degree ?? null);
  const [gender, setGender] = useState<string | null>(initial.gender ?? null);
  const [interests, setInterests] = useState<string[]>(initial.interests ?? []);
  const [bio, setBio] = useState(initial.bio ?? "");

  function draft(): OnboardingDraft {
    return {
      fullName,
      avatarUrl,
      department,
      degree,
      gender,
      interests,
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
    try {
      await uploadWithProgress("avatars", path, file, { contentType: file.type });
      setAvatarUrl(publicStorageUrl("avatars", path));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // Photo, name, school, degree, gender and interests are all required; only
  // the bio and the install ask are skippable.
  const stepValid = [
    Boolean(avatarUrl) && fullName.trim().length >= 2,
    Boolean(department) && Boolean(degree) && Boolean(gender),
    interests.length >= MIN_INTERESTS,
    bio.length <= BIO_MAX,
    true, // home screen — never blocks Finish
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
            <h1 className="text-2xl font-bold">Add your photo</h1>
            <p className="mt-1 text-fg-muted">
              To maintain the authenticity and decorum of the FAST SOCIO
              community, every account is required to have a profile photo.
            </p>
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
            <p className="text-xs text-fg-muted">
              Use recognizable and appropriate display names. Avoid misleading,
              offensive, or inappropriate names. Profiles with such names will be
              banned by FAST SOCIO admins.
            </p>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={onPickFile}
          />
        </section>
      )}

      {step === 1 && (
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Your academics</h1>
            <p className="mt-1 text-fg-muted">
              Your school and degree. Your semester is set automatically from
              your roll number.
            </p>
          </div>
          <Field label="School">
            <PillRow>
              {DEPARTMENTS.map((d) => (
                <Pill
                  key={d}
                  active={department === d}
                  onClick={() => {
                    setDepartment(d);
                    const degrees = getDegreesForSchool(d);
                    if (degree && !degrees.includes(degree)) setDegree(null);
                  }}
                >
                  {d}
                </Pill>
              ))}
            </PillRow>
          </Field>
          {department && (
            <Field label="Degree">
              <PillRow>
                {getDegreesForSchool(department).map((deg) => (
                  <Pill
                    key={deg}
                    active={degree === deg}
                    onClick={() => setDegree(deg)}
                  >
                    {deg}
                  </Pill>
                ))}
              </PillRow>
            </Field>
          )}
          <Field label="Gender">
            <PillRow>
              {SELECTABLE_GENDERS.map((g) => (
                <Pill
                  key={g.value}
                  active={gender === g.value}
                  onClick={() => setGender(g.value)}
                >
                  {g.label}
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
              Pick at least {MIN_INTERESTS}. ({interests.length} selected)
            </p>
          </div>
          <div className="flex max-h-96 flex-wrap gap-2 overflow-y-auto pr-1">
            {INTERESTS.map((tag) => (
              <Pill
                key={tag}
                active={interests.includes(tag)}
                onClick={() =>
                  setInterests((prev) =>
                    prev.includes(tag)
                      ? prev.filter((t) => t !== tag)
                      : [...prev, tag]
                  )
                }
              >
                {tag}
              </Pill>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
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

      {step === 4 && <InstallStep />}

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
          ? "bg-aura text-white"
          : "glass text-fg-muted hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}
