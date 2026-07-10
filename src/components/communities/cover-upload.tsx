"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";

/**
 * 16:9 cover picker (UAT-019/020). The chosen file goes through the cropper
 * first (UAT-008) so the user frames the banner themselves rather than trusting
 * an object-cover centre crop; only the cropped result is uploaded, to the
 * public `post-media` bucket under the owner's folder.
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setPendingFile(file);
  }

  async function onCropped({ blob, extension, mimeType }: CropResult) {
    setPendingFile(null);
    setUploading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      setError("You are not signed in.");
      return;
    }
    const path = `${user.id}/${prefix}-${crypto.randomUUID()}.${extension}`;
    const { error: upErr } = await supabase.storage
      .from("post-media")
      .upload(path, blob, { contentType: mimeType });
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
            aria-label="Change cover"
            onClick={() => fileRef.current?.click()}
            className="glass-strong absolute bottom-2 right-2 rounded-full px-3 py-1.5 text-xs font-semibold"
          >
            Change
          </button>
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

      {pendingFile && (
        <ImageCropper
          file={pendingFile}
          aspect={16 / 9}
          title="Crop cover"
          onCancel={() => setPendingFile(null)}
          onCropped={onCropped}
        />
      )}
    </div>
  );
}
