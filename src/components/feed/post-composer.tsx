"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, VenetianMask, X } from "lucide-react";
import { GlassButton, GlassCard } from "@/components/ui";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
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
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("post-media")
      .upload(path, file, { contentType: file.type });
    if (upErr) {
      setUploading(false);
      setError(upErr.message);
      return;
    }
    setImageUrl(
      supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl
    );
    setUploading(false);
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
    });
  }

  const disabled =
    pending || uploading || (body.trim().length === 0 && !imageUrl);

  return (
    <GlassCard className="p-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 2000))}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted/70"
      />

      {imageUrl && (
        <div className="relative mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Selected"
            className="max-h-52 w-full rounded-xl object-cover"
            loading="lazy"
            decoding="async"
          />
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
        <GlassButton
          size="sm"
          className="ml-auto"
          onClick={submit}
          disabled={disabled}
        >
          {pending ? "Posting…" : uploading ? "Uploading…" : "Post"}
        </GlassButton>
      </div>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
      {notice && <p className="mt-2 text-sm text-aura">{notice}</p>}
    </GlassCard>
  );
}
