"use client";

import { useRef, useState, useTransition } from "react";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { saveProfile } from "./actions";
import {
  BIO_MAX,
  DEPARTMENTS,
  GENDERS,
  INTERESTS,
  MAX_INTERESTS,
  MIN_INTERESTS,
  SEMESTERS,
} from "@/lib/profile/constants";

const STEPS = ["Photo", "Academics", "Interests", "About you"];

export default function OnboardingPage() {
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  // Form state
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [department, setDepartment] = useState("");
  const [semester, setSemester] = useState<number | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [bio, setBio] = useState("");

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

  function toggleInterest(tag: string) {
    setInterests((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : prev.length < MAX_INTERESTS
          ? [...prev, tag]
          : prev
    );
  }

  const stepValid = [
    fullName.trim().length >= 2, // Photo step also collects the name
    Boolean(department) && Boolean(semester),
    interests.length >= MIN_INTERESTS,
    bio.length <= BIO_MAX,
  ][step];

  const isLast = step === STEPS.length - 1;

  function next() {
    setError(null);
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    startSaving(async () => {
      const res = await saveProfile({
        fullName,
        department,
        semester: semester!,
        gender,
        interests,
        bio,
        avatarUrl,
      });
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
                />
              ) : (
                <span className="text-sm">{uploading ? "Uploading…" : "Tap to add"}</span>
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
            <p className="mt-1 text-fg-muted">Department and semester.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Department</label>
            <div className="flex flex-wrap gap-2">
              {DEPARTMENTS.map((d) => (
                <Pill
                  key={d}
                  active={department === d}
                  onClick={() => setDepartment(d)}
                >
                  {d}
                </Pill>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Semester</label>
            <div className="flex flex-wrap gap-2">
              {SEMESTERS.map((s) => (
                <Pill
                  key={s}
                  active={semester === s}
                  onClick={() => setSemester(s)}
                >
                  {s}
                </Pill>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Gender <span className="text-fg-muted">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {GENDERS.map((g) => (
                <Pill
                  key={g.value}
                  active={gender === g.value}
                  onClick={() =>
                    setGender(gender === g.value ? null : g.value)
                  }
                >
                  {g.label}
                </Pill>
              ))}
            </div>
          </div>
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
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((tag) => (
              <Pill
                key={tag}
                active={interests.includes(tag)}
                onClick={() => toggleInterest(tag)}
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
              className="w-full resize-none rounded-[20px] bg-transparent p-4 text-[15px] text-fg outline-none placeholder:text-fg-muted/70"
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
