"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, VenetianMask, X } from "lucide-react";
import { GlassButton, GlassCard } from "@/components/ui";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";
import { UploadProgressBar } from "@/components/ui/upload-progress";
import { uploadWithProgress, publicStorageUrl } from "@/lib/storage-upload";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { createPost } from "@/app/(student)/home/actions";

export function PostComposer({
  communityId,
  placeholder = "Share something with campus…",
  reviewNotice,
}: {
  communityId?: string;
  placeholder?: string;
  /** Shown after a successful post when submissions require approval. */
  reviewNotice?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setPendingFile(file);
  }

  /** Upload the cropped result (UAT-008); the original never leaves the device. */
  async function onCropped({ blob, extension, mimeType }: CropResult) {
    setPendingFile(null);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    // De-identified path (P3-01): never embed the author's uid in a post image
    // URL, otherwise anonymous posts leak their author. `shared/` is allowed by
    // the post-media INSERT policy; the object key is random.
    const path = `shared/${crypto.randomUUID()}.${extension}`;
    setUploading(true);
    setUploadPct(0);
    try {
      await uploadWithProgress("post-media", path, blob, {
        contentType: mimeType,
        onProgress: (p) => setUploadPct(p.percent),
      });
      setImageUrl(publicStorageUrl("post-media", path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await createPost({
        body,
        imageUrl,
        isAnonymous: anon,
        communityId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      setAnon(false);
      setImageUrl(null);
      if (reviewNotice) setNotice(reviewNotice);
      // UAT-007: pull the freshly-created post into the feed automatically.
      router.refresh();
    });
  }

  const disabled =
    pending || uploading || (body.trim().length === 0 && !imageUrl);

  return (
    <GlassCard className="relative overflow-hidden p-4">
      {/* UAT-007: posting animation — a glass overlay with a spinner while the
          server action runs, so the submit feels responsive and intentional. */}
      {pending && (
        <div className="glass-strong absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit]">
          <Loader2 className="h-7 w-7 animate-spin text-aura" aria-hidden />
          <p className="text-sm font-medium text-fg">Posting…</p>
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 2000))}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
      />

      {uploading && (
        <div className="mt-2 rounded-xl bg-bg-elevated px-4 py-3">
          <UploadProgressBar percent={uploadPct} label="Uploading image" />
        </div>
      )}

      {imageUrl && !uploading && (
        <div className="relative mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Selected"
            className="max-h-72 w-full rounded-xl object-cover"
            loading="lazy"
            decoding="async"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="glass-strong absolute bottom-2 right-2 rounded-full px-3 py-1.5 text-xs font-semibold"
          >
            Recrop
          </button>
          <button
            type="button"
            aria-label="Remove image"
            onClick={() => setImageUrl(null)}
            className="glass-strong absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {pendingFile && (
        <ImageCropper
          file={pendingFile}
          aspect={4 / 5}
          title="Crop photo"
          onCancel={() => setPendingFile(null)}
          onCropped={onCropped}
        />
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onPickImage}
        />
        <button
          type="button"
          aria-label="Add image"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted disabled:opacity-40"
        >
          <ImagePlus className="h-5 w-5" aria-hidden />
        </button>
        {/* UAT-005: anonymity moved out of the community Main panel — posts there
            are moderated and attributed. It lives in the community chat room
            instead. The main campus feed keeps it. */}
        {!communityId && (
          <button
            type="button"
            onClick={() => setAnon((a) => !a)}
            aria-pressed={anon}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-full px-3 text-sm transition-colors",
              anon ? "bg-aura text-white" : "glass text-fg-muted"
            )}
          >
            <VenetianMask className="h-4 w-4" aria-hidden />
            Anonymous
          </button>
        )}
        <GlassButton
          size="sm"
          className="ml-auto"
          onClick={submit}
          disabled={disabled}
        >
          {pending ? "Posting…" : uploading ? "Uploading…" : "Post"}
        </GlassButton>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm text-aura">
          {notice}
        </p>
      )}
    </GlassCard>
  );
}
