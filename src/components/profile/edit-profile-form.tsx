"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";
import { GlassCard, GlassInput } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { updateProfile } from "@/app/(student)/profile/actions";
import { CoverUpload } from "@/components/communities/cover-upload";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";
import { UploadProgressRing } from "@/components/ui/upload-progress";
import { uploadWithProgress, publicStorageUrl } from "@/lib/storage-upload";
import {
  BIO_MAX,
  DEPARTMENTS,
  GENDERS,
  INTERESTS,
  MAX_INTERESTS,
  MIN_INTERESTS,
} from "@/lib/profile/constants";

export type EditableProfile = {
  full_name: string | null;
  department: string | null;
  gender: string | null;
  interests: string[];
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
};

export function EditProfileForm({ profile }: { profile: EditableProfile }) {
  const router = useRouter();
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const initial = useMemo(
    () => ({
      fullName: profile.full_name ?? "",
      avatarUrl: profile.avatar_url,
      coverUrl: profile.cover_url,
      department: profile.department ?? "",
      gender: profile.gender,
      interests: profile.interests ?? [],
      bio: profile.bio ?? "",
    }),
    [profile]
  );

  const [fullName, setFullName] = useState(initial.fullName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl);
  const [coverUrl, setCoverUrl] = useState<string | null>(initial.coverUrl);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [department, setDepartment] = useState(initial.department);
  const [gender, setGender] = useState<string | null>(initial.gender);
  const [interests, setInterests] = useState<string[]>(initial.interests);
  const [bio, setBio] = useState(initial.bio);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  // The baseline changes are compared against: starts as the loaded profile,
  // then advances to whatever was last WRITTEN by autosave. `dirty` therefore
  // means "different from what's actually saved right now", not "different
  // from page load" — otherwise a successful save would never clear it.
  const [savedSnapshot, setSavedSnapshot] = useState(initial);
  const [justSaved, setJustSaved] = useState(false);

  const dirty =
    fullName !== savedSnapshot.fullName ||
    avatarUrl !== savedSnapshot.avatarUrl ||
    coverUrl !== savedSnapshot.coverUrl ||
    department !== savedSnapshot.department ||
    gender !== savedSnapshot.gender ||
    bio !== savedSnapshot.bio ||
    interests.length !== savedSnapshot.interests.length ||
    interests.some((t) => !savedSnapshot.interests.includes(t));

  const valid =
    fullName.trim().length >= 2 &&
    Boolean(department) &&
    interests.length >= MIN_INTERESTS &&
    interests.length <= MAX_INTERESTS &&
    bio.length <= BIO_MAX;

  /** Pick → crop (UAT-008) → upload. Only the square crop reaches storage. */
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setPendingAvatar(file);
  }

  async function onAvatarCropped({ blob, extension, mimeType }: CropResult) {
    setPendingAvatar(null);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You are not signed in.");
      return;
    }
    const path = `${user.id}/${Date.now()}.${extension}`;
    setUploading(true);
    setUploadPct(0);
    try {
      await uploadWithProgress("avatars", path, blob, {
        contentType: mimeType,
        upsert: true,
        onProgress: (p) => setUploadPct(p.percent),
      });
      setAvatarUrl(publicStorageUrl("avatars", path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
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

  // Autosave: 900ms after the last change to any tracked field, if the form is
  // dirty (relative to what's actually saved) and valid, write it — no manual
  // Save button. Skips while an avatar upload is still in flight (coverUrl only
  // ever changes to its FINAL url once CoverUpload's own upload finishes, so it
  // doesn't need the same guard). The setState calls all live inside the timer
  // callback, never in the effect body itself, so this isn't the disallowed
  // "setState synchronously in an effect" pattern.
  useEffect(() => {
    if (!dirty || !valid || uploading || saving) return;
    const t = setTimeout(() => {
      setError(null);
      startSaving(async () => {
        const res = await updateProfile({
          fullName,
          department,
          gender,
          interests,
          bio,
          avatarUrl,
          coverUrl,
        });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setSavedSnapshot({
          fullName,
          avatarUrl,
          coverUrl,
          department,
          gender,
          interests,
          bio,
        });
        setJustSaved(true);
        router.refresh();
      });
    }, 900);
    return () => clearTimeout(t);
  }, [
    fullName,
    avatarUrl,
    coverUrl,
    department,
    gender,
    interests,
    bio,
    uploading,
    dirty,
    valid,
    saving,
    router,
  ]);

  // "Saved" capsule fades on its own after a beat.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  const initials =
    fullName
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="space-y-6 pb-8">
      {/* Cover photo — 16:9 banner shown behind the avatar on the profile. */}
      <CoverUpload
        value={coverUrl}
        onChange={setCoverUrl}
        label="Cover photo"
        prefix="cover"
      />

      {/* Avatar */}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="glass relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full text-fg-muted"
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
            <span className="text-2xl font-bold text-fg">{initials}</span>
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
              <UploadProgressRing percent={uploadPct} size={64} />
            </span>
          )}
          <span className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-aura text-white shadow-[0_2px_10px_rgba(124,92,255,0.5)]">
            <Camera className="h-4 w-4" aria-hidden />
          </span>
        </button>
        <span className="text-xs text-fg-muted">
          {uploading ? "Uploading…" : "Tap to change photo"}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={onPickFile}
        />
        {pendingAvatar && (
          <ImageCropper
            file={pendingAvatar}
            aspect={1}
            round
            title="Crop photo"
            onCancel={() => setPendingAvatar(null)}
            onCropped={onAvatarCropped}
          />
        )}
      </div>

      {/* Name */}
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

      {/* Bio */}
      <div className="space-y-2">
        <label htmlFor="bio" className="text-sm font-medium">
          Bio
        </label>
        <GlassCard className="p-1">
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            placeholder="Looking for a hackathon teammate ☕"
            rows={4}
            className="w-full resize-none rounded-[20px] bg-transparent p-4 text-[15px] text-fg outline-none placeholder:text-fg-muted"
          />
        </GlassCard>
        <p className="text-right text-xs text-fg-muted">
          {bio.length}/{BIO_MAX}
        </p>
      </div>

      {/* School (UAT-008) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">School</label>
        <div className="flex flex-wrap gap-2">
          {DEPARTMENTS.map((d) => (
            <Pill key={d} active={department === d} onClick={() => setDepartment(d)}>
              {d}
            </Pill>
          ))}
        </div>
      </div>

      {/* Semester is derived from the roll number (lib/profile/semester.ts) and
          no longer editable here. */}

      {/* Gender */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Gender <span className="text-fg-muted">(optional)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <Pill
              key={g.value}
              active={gender === g.value}
              onClick={() => setGender(gender === g.value ? null : g.value)}
            >
              {g.label}
            </Pill>
          ))}
        </div>
      </div>

      {/* Interests */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Interests{" "}
          <span className="text-fg-muted">
            (pick {MIN_INTERESTS}–{MAX_INTERESTS} · {interests.length} selected)
          </span>
        </label>
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
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {/* Autosave status — a small floating capsule instead of a Save button.
          Bottom-centered, above the bottom nav; fades in/out with opacity so it
          never causes layout shift. */}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "gradient-brand pointer-events-none fixed bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5.5rem))] left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(124,92,255,0.4)] transition-opacity duration-300",
          saving || justSaved ? "opacity-100" : "opacity-0"
        )}
      >
        {saving ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Saving changes…
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
            Changes saved
          </span>
        )}
      </div>
    </div>
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
          ? "gradient-brand text-white shadow-[0_4px_16px_rgba(200,80,192,0.4)]"
          : "glass text-fg-muted hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}
