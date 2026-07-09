"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * 16:9 community cover picker (UAT-019/020). Uploads to the public `post-media`
 * bucket under the owner's folder and reports the public URL up. The preview box
 * is locked to 16:9 and the image is scaled to fill (object-cover), so covers of
 * any ratio fill the banner cleanly.
 */
export function CoverUpload({
  value,
  onChange,
  label = "Cover photo (16:9)",
  prefix = "community",
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Field label above the picker. */
  label?: string;
  /** Filename prefix under the owner's folder (e.g. "community", "cover"). */
  prefix?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      return;
    }
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/${prefix}-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("post-media")
      .upload(path, file, { contentType: file.type });
    if (upErr) {
      setUploading(false);
      setError(upErr.message);
      return;
    }
    onChange(supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl);
    setUploading(false);
  }

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
      {value ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-md)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Cover preview"
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            aria-label="Remove cover"
            onClick={() => onChange(null)}
            className="glass-strong absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="glass flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] text-fg-muted disabled:opacity-50"
        >
          <ImagePlus className="h-6 w-6" aria-hidden />
          <span className="text-sm">{uploading ? "Uploading…" : "Add a cover"}</span>
        </button>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
