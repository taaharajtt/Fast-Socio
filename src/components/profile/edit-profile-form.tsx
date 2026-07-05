"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { updateProfile } from "@/app/(student)/profile/actions";
import {
  BIO_MAX,
  DEPARTMENTS,
  GENDERS,
  INTERESTS,
  MAX_INTERESTS,
  MIN_INTERESTS,
  SEMESTERS,
} from "@/lib/profile/constants";

export type EditableProfile = {
  full_name: string | null;
  department: string | null;
  semester: number | null;
  gender: string | null;
  interests: string[];
  bio: string | null;
  avatar_url: string | null;
};

export function EditProfileForm({ profile }: { profile: EditableProfile }) {
  const router = useRouter();
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const initial = useMemo(
    () => ({
      fullName: profile.full_name ?? "",
      avatarUrl: profile.avatar_url,
      department: profile.department ?? "",
      semester: profile.semester,
      gender: profile.gender,
      interests: profile.interests ?? [],
      bio: profile.bio ?? "",
    }),
    [profile]
  );

  const [fullName, setFullName] = useState(initial.fullName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [department, setDepartment] = useState(initial.department);
  const [semester, setSemester] = useState<number | null>(initial.semester);
  const [gender, setGender] = useState<string | null>(initial.gender);
  const [interests, setInterests] = useState<string[]>(initial.interests);
  const [bio, setBio] = useState(initial.bio);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const dirty =
    fullName !== initial.fullName ||
    avatarUrl !== initial.avatarUrl ||
    department !== initial.department ||
    semester !== initial.semester ||
    gender !== initial.gender ||
    bio !== initial.bio ||
    interests.length !== initial.interests.length ||
    interests.some((t) => !initial.interests.includes(t));

  const valid =
    fullName.trim().length >= 2 &&
    Boolean(department) &&
    Boolean(semester) &&
    interests.length >= MIN_INTERESTS &&
    interests.length <= MAX_INTERESTS &&
    bio.length <= BIO_MAX;

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
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

  function cancel() {
    if (dirty && !window.confirm("Discard changes?")) return;
    router.push("/profile");
  }

  function save() {
    setError(null);
    startSaving(async () => {
      const res = await updateProfile({
        fullName,
        department,
        semester: semester!,
        gender,
        interests,
        bio,
        avatarUrl,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.push("/profile");
      router.refresh();
    });
  }

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
            className="w-full resize-none rounded-[20px] bg-transparent p-4 text-[15px] text-fg outline-none placeholder:text-fg-muted/70"
          />
        </GlassCard>
        <p className="text-right text-xs text-fg-muted">
          {bio.length}/{BIO_MAX}
        </p>
      </div>

      {/* Department */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Department</label>
        <div className="flex flex-wrap gap-2">
          {DEPARTMENTS.map((d) => (
            <Pill key={d} active={department === d} onClick={() => setDepartment(d)}>
              {d}
            </Pill>
          ))}
        </div>
      </div>

      {/* Semester */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Semester</label>
        <div className="flex flex-wrap gap-2">
          {SEMESTERS.map((s) => (
            <Pill key={s} active={semester === s} onClick={() => setSemester(s)}>
              {s}
            </Pill>
          ))}
        </div>
      </div>

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

      <div className="flex gap-3">
        <GlassButton variant="glass" size="lg" onClick={cancel} disabled={saving}>
          Cancel
        </GlassButton>
        <GlassButton
          size="lg"
          className="flex-1"
          onClick={save}
          disabled={!valid || !dirty || uploading || saving}
        >
          {saving ? "Saving…" : "Save changes"}
        </GlassButton>
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
          ? "bg-aura text-white shadow-[0_4px_16px_rgba(124,92,255,0.35)]"
          : "glass text-fg-muted hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}
