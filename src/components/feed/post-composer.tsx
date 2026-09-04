"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Crop,
  ImagePlus,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  Trash2,
  VenetianMask,
  X,
} from "lucide-react";
import {
  AnonymousToggle,
  ComposerAction,
  GlassButton,
  GlassCard,
} from "@/components/ui";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";
import { UploadProgressBar } from "@/components/ui/upload-progress";
import { uploadWithProgress, publicStorageUrl } from "@/lib/storage-upload";
import { useObjectUrl } from "@/lib/use-object-url";
import { cn } from "@/lib/utils";
import { createPost, discardPostMedia } from "@/app/(student)/home/actions";
import { MentionMenu } from "@/components/feed/mention-menu";
import { useMentionAutocomplete } from "@/components/feed/use-mention-autocomplete";
import {
  ASPECT_VALUE,
  DEFAULT_CAROUSEL_LAYOUT,
  MAX_POST_MEDIA,
  MEDIA_ASPECT_OPTIONS,
  nearestMediaAspect,
  slideFit,
  slideLabel,
  viewportAspect,
  type CarouselLayout,
  type PostMedia,
} from "@/lib/feed/media";
import {
  acceptFiles,
  aggregateProgress,
  canPublish,
  moveItem,
  removeAt,
  replaceAt,
  toMediaInput,
  uploadedUrls,
  type DraftMediaItem,
} from "@/lib/feed/draft-media";

/** One file waiting for the crop dialog. `replaceId` re-crops an existing slide. */
type CropJob = { file: File; replaceId: string | null };

export function PostComposer({
  communityId,
  placeholder = "Share something with campus…",
  reviewNotice,
  onPosted,
}: {
  communityId?: string;
  placeholder?: string;
  /** Shown after a successful post when submissions require approval. */
  reviewNotice?: string;
  /** Preferred over router.refresh(): lets the host pull just the new post. */
  onPosted?: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);

  // ORDERED DRAFT MEDIA (0180). The composer used to hold `imageUrl` +
  // `pendingFile`, which can only ever describe one image in one state — no
  // ordering, no per-item progress, no per-item error. A carousel needs all of
  // those, so the draft is a list and every item owns its own lifecycle.
  const [media, setMedia] = useState<DraftMediaItem[]>([]);
  const [layout, setLayout] = useState<CarouselLayout>(DEFAULT_CAROUSEL_LAYOUT);
  const [active, setActive] = useState(0);
  // Files still to be cropped, oldest first. The head of this queue IS the
  // cropper's current file — there is no second "which file is open" state to
  // fall out of step with it.
  const [cropQueue, setCropQueue] = useState<CropJob[]>([]);

  // Poll builder: when non-null, this post carries a poll and the textarea is
  // the question. Starts with two blank options; up to six.
  const [pollOptions, setPollOptions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Tag a match with "@" — the same picker the comment composer uses, so a
  // post, an image caption and a poll question all tag identically. Only
  // confirmed picks serialise into mention tokens at submit.
  const mention = useMentionAutocomplete(body, setBody, textareaRef);

  const uploading = media.some((m) => m.status === "uploading");
  const currentJob = cropQueue[0] ?? null;
  const activeItem = media[Math.min(active, Math.max(media.length - 1, 0))];

  /** Patch one draft item by id; every async upload callback goes through this
   *  so a reorder or a removal mid-upload can never write to the wrong slide. */
  function patchItem(id: string, patch: Partial<DraftMediaItem>) {
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith("image/")
    );
    // Clear the input immediately: the same file picked twice in a row must
    // still fire a change event, and this is also what stops a stray re-submit
    // of the previous selection.
    e.target.value = "";
    if (picked.length === 0) return;
    setError(null);
    setNotice(null);

    // Capacity counts what is already in the draft AND what is still queued for
    // cropping, so pressing the image action three times can't overshoot.
    const held = media.length + cropQueue.filter((j) => !j.replaceId).length;
    const { accepted, message } = acceptFiles(held, picked);
    if (message) setNotice(message);
    if (accepted.length === 0) return;
    setCropQueue((prev) => [
      ...prev,
      ...accepted.map((file) => ({ file, replaceId: null })),
    ]);
  }

  /** Re-crop an existing slide: jumps the queue so it opens immediately. */
  function recrop(item: DraftMediaItem) {
    setError(null);
    setCropQueue((prev) => [{ file: item.file, replaceId: item.id }, ...prev]);
  }

  function dropCurrentJob() {
    setCropQueue((prev) => prev.slice(1));
  }

  /**
   * A confirmed crop. The blob is held locally and uploaded straight away, so
   * pressing Post later is instant — but the upload starts only once the user
   * has CONFIRMED the crop, never merely because the picker changed.
   */
  function onCropped(job: CropJob, result: CropResult) {
    dropCurrentJob();
    setError(null);
    const { blob, extension, mimeType, width, height } = result;
    const id = job.replaceId ?? crypto.randomUUID();
    const item: DraftMediaItem = {
      id,
      file: job.file,
      blob,
      extension,
      mimeType,
      // The crop frame WAS one of the three ratios, so this snaps the exported
      // pixel size back onto the label it was cut to.
      aspect: nearestMediaAspect(width / height),
      width,
      height,
      status: "ready",
      progress: 0,
      url: null,
      error: null,
    };

    // Computed from the current render's state rather than inside the updater:
    // a state updater must stay pure, and React may run it twice.
    const index = job.replaceId
      ? media.findIndex((m) => m.id === job.replaceId)
      : -1;
    setMedia((prev) => {
      const i = job.replaceId ? prev.findIndex((m) => m.id === job.replaceId) : -1;
      return i === -1 ? [...prev, item] : replaceAt(prev, i, item);
    });
    setActive(index === -1 ? media.length : index);

    // The slide that was just replaced had already been stored; nothing points
    // at those bytes any more.
    const replacedUrl = index === -1 ? null : media[index].url;
    if (replacedUrl) void discardPostMedia([replacedUrl]);

    void upload(id, blob, extension, mimeType);
  }

  async function upload(
    id: string,
    blob: Blob,
    extension: string,
    mimeType: string
  ) {
    patchItem(id, { status: "uploading", progress: 0, error: null });
    // De-identified path (P3-01): never embed the author's uid in a post image
    // URL, otherwise anonymous posts leak their author. `shared/` is allowed by
    // the post-media upload policy; the object key is random.
    const path = `shared/${crypto.randomUUID()}.${extension}`;
    try {
      await uploadWithProgress("post-media", path, blob, {
        contentType: mimeType,
        onProgress: (p) => patchItem(id, { progress: p.percent }),
      });
      // The blob is dropped once the bytes are stored: the preview switches to
      // the stored URL, and a five-image draft stops pinning ~10MB of memory.
      patchItem(id, {
        status: "uploaded",
        progress: 100,
        url: publicStorageUrl("post-media", path),
        blob: null,
      });
    } catch (e) {
      patchItem(id, { status: "error", error: (e as Error).message });
    }
  }

  /** Retry a slide whose upload failed. The blob never left the device. */
  function retry(item: DraftMediaItem) {
    if (!item.blob) return;
    void upload(item.id, item.blob, item.extension, item.mimeType);
  }

  function removeSlide(index: number) {
    const gone = media[index];
    const next = removeAt(media, index);
    setMedia(next);
    setActive(Math.max(0, Math.min(active, next.length - 1)));
    if (gone?.url) void discardPostMedia([gone.url]);
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= media.length) return;
    setMedia((prev) => moveItem(prev, index, to));
    setActive(to);
  }

  /** Drop the whole draft's media and purge anything already stored. */
  function clearMedia() {
    const orphans = uploadedUrls(media);
    setMedia([]);
    setActive(0);
    setCropQueue([]);
    if (orphans.length > 0) void discardPostMedia(orphans);
  }

  // A poll and images are mutually exclusive, so toggling one clears the other.
  function togglePoll() {
    setError(null);
    setPollOptions((prev) => {
      if (prev) return null;
      clearMedia();
      return ["", ""];
    });
  }

  function setOption(i: number, value: string) {
    setPollOptions((prev) =>
      prev ? prev.map((o, idx) => (idx === i ? value.slice(0, 80) : o)) : prev
    );
  }
  function addOption() {
    setPollOptions((prev) => (prev && prev.length < 6 ? [...prev, ""] : prev));
  }
  function removeOption(i: number) {
    setPollOptions((prev) =>
      prev && prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev
    );
  }

  function submit() {
    setError(null);
    setNotice(null);
    const payload = toMediaInput(media);
    start(async () => {
      const res = await createPost({
        body: mention.serialize(body),
        isAnonymous: anon,
        communityId,
        pollOptions,
        media: payload,
        carouselLayout: layout,
      });
      if (!res.ok) {
        // The draft is KEPT so the user can fix and retry; nothing they cropped
        // is thrown away because the create failed.
        setError(res.error);
        return;
      }
      setBody("");
      mention.reset();
      setAnon(false);
      setMedia([]);
      setActive(0);
      setCropQueue([]);
      setLayout(DEFAULT_CAROUSEL_LAYOUT);
      setPollOptions(null);
      if (reviewNotice) setNotice(reviewNotice);
      // UAT-007: pull the freshly-created post into the feed automatically.
      if (onPosted) onPosted();
      else router.refresh();
    });
  }

  const publishable = canPublish({
    body,
    media,
    pollOptions,
    busy: pending || uploading || cropQueue.length > 0,
  });

  // The composer previews the EXACT viewport the feed will use, from the stored
  // ratios — not from the images' natural sizes.
  const previewMedia: PostMedia[] = media.map((m) => ({
    url: m.url ?? "",
    aspect: m.aspect,
    width: m.width,
    height: m.height,
  }));
  const previewAspect = viewportAspect(previewMedia, layout);
  const fit = slideFit(layout);

  // "Photo 2 of 4" while working through a multi-file pick.
  const cropSubtitle = (() => {
    if (!currentJob) return undefined;
    if (currentJob.replaceId) {
      const index = media.findIndex((m) => m.id === currentJob.replaceId);
      return index === -1 ? undefined : `Re-cropping ${slideLabel(index, media.length)}`;
    }
    const queued = cropQueue.filter((j) => !j.replaceId).length;
    const total = media.length + queued;
    return total > 1 ? `Photo ${media.length + 1} of ${total}` : undefined;
  })();

  return (
    <GlassCard className="relative overflow-hidden p-4">
      {/* UAT-007: posting animation — a glass overlay with a spinner while the
          server action runs, so the submit feels responsive and intentional. */}
      {pending && (
        <div className="glass-strong absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit]">
          <Loader2 className="h-7 w-7 animate-spin text-fg-muted" aria-hidden />
          <p className="text-sm font-medium text-fg">Posting…</p>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => {
          const next = e.target.value.slice(0, 2000);
          setBody(next);
          mention.syncCaret(next, e.target.selectionStart ?? next.length);
        }}
        onKeyDown={(e) => {
          mention.onKeyDown(e);
        }}
        placeholder={pollOptions ? "Ask a question…" : placeholder}
        rows={3}
        className="w-full resize-none bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
      />

      {mention.showMenu && (
        <MentionMenu
          roster={mention.roster}
          suggestions={mention.suggestions}
          activeIdx={mention.activeIdx}
          onPick={mention.pickMention}
          onHover={mention.setActiveIdx}
          className="mt-2 w-full"
        />
      )}

      {pollOptions && (
        <div className="mt-1 space-y-2">
          {pollOptions.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                className="glass min-w-0 flex-1 rounded-full bg-transparent px-3.5 py-2 text-sm text-fg outline-none placeholder:text-fg-muted"
              />
              {pollOptions.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => removeOption(i)}
                  className="shrink-0 p-1 text-fg-muted hover:text-fg"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < 6 && (
            <button
              type="button"
              onClick={addOption}
              className="pressable focus-ring flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-fg-muted hover:text-fg"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add option
            </button>
          )}
        </div>
      )}

      {media.length > 0 && activeItem && (
        <div className="mt-3">
          {/* PRIMARY PREVIEW — the real viewport, at the real ratio. Slide 1
              governs it in uniform mode, so reordering visibly changes the
              whole post's shape here before anything is published. */}
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-[14px]",
              layout === "mixed" ? "bg-bg" : "bg-bg-elevated"
            )}
            style={{ aspectRatio: previewAspect }}
          >
            <DraftPreview item={activeItem} fit={fit} />

            {/* Pinned to the TOP of the preview so it never sits under the
                format toggle in the bottom-left corner. */}
            {activeItem.status === "uploading" && (
              <div className="absolute inset-x-0 top-0 p-2">
                <UploadProgressBar
                  percent={activeItem.progress}
                  label={`Uploading ${slideLabel(active, media.length)}`}
                />
              </div>
            )}
            {activeItem.status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 px-4 text-center">
                <p className="text-sm font-medium text-white">
                  That photo didn&rsquo;t upload.
                </p>
                <button
                  type="button"
                  onClick={() => retry(activeItem)}
                  className="focus-ring flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Try again
                </button>
              </div>
            )}

            {/* FORMAT TOGGLE — bottom-left of the primary preview, and it
                governs the WHOLE post, not this slide. */}
            <button
              type="button"
              onClick={() =>
                setLayout((l) => (l === "uniform" ? "mixed" : "uniform"))
              }
              aria-pressed={layout === "mixed"}
              aria-label={
                layout === "mixed"
                  ? "Full image layout — every photo shown whole on a square canvas. Switch to uniform crop."
                  : "Uniform crop — every photo cropped to the first photo's shape. Switch to full image."
              }
              title={
                layout === "mixed"
                  ? "Every photo is shown whole on a square canvas"
                  : "Every photo is cropped to the first photo's shape"
              }
              className="focus-ring absolute bottom-2 left-2 flex h-9 items-center gap-1.5 rounded-full bg-black/45 px-3 text-xs font-semibold text-white backdrop-blur-sm"
            >
              {layout === "mixed" ? (
                <Maximize2 className="h-4 w-4" aria-hidden />
              ) : (
                <Crop className="h-4 w-4" aria-hidden />
              )}
              {layout === "mixed" ? "Full image" : "Uniform crop"}
            </button>

            {media.length > 1 && (
              <span className="absolute right-2 top-2 rounded-full bg-black/45 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                {active + 1}/{media.length}
              </span>
            )}
          </div>

          {/* FILMSTRIP — tap to make a slide active. Reordering is done with the
              explicit buttons below rather than HTML drag-and-drop, which does
              not exist on touch. */}
          {media.length > 1 && (
            <div
              role="listbox"
              aria-label="Photos in this post"
              aria-orientation="horizontal"
              className="no-scrollbar mt-2 flex gap-2 overflow-x-auto overscroll-x-contain pb-1"
            >
              {media.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  aria-label={slideLabel(index, media.length)}
                  onClick={() => setActive(index)}
                  className={cn(
                    "relative h-14 w-14 shrink-0 overflow-hidden rounded-[10px] bg-bg-elevated",
                    index === active
                      ? "ring-2 ring-accent"
                      : "opacity-70 ring-1 ring-glass-border"
                  )}
                >
                  <DraftPreview item={item} fit="cover" />
                  {item.status === "error" && (
                    <span className="absolute inset-0 bg-error/40" aria-hidden />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Per-slide controls, all keyboard- and touch-reachable. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {media.length > 1 && (
              <>
                <SlideControl
                  icon={ArrowLeft}
                  label="Move left"
                  disabled={active === 0}
                  onClick={() => move(active, -1)}
                />
                <SlideControl
                  icon={ArrowRight}
                  label="Move right"
                  disabled={active === media.length - 1}
                  onClick={() => move(active, 1)}
                />
              </>
            )}
            <SlideControl
              icon={Crop}
              label="Re-crop"
              onClick={() => recrop(activeItem)}
            />
            <SlideControl
              icon={Trash2}
              label="Remove"
              tone="danger"
              onClick={() => removeSlide(active)}
            />
            {media.length < MAX_POST_MEDIA && (
              <SlideControl
                icon={Plus}
                label="Add photos"
                onClick={() => fileRef.current?.click()}
              />
            )}
            <span className="type-caption ml-auto text-fg-muted">
              {media.length}/{MAX_POST_MEDIA}
            </span>
          </div>

          {uploading && (
            <div className="mt-2 rounded-xl bg-bg-elevated px-4 py-3">
              <UploadProgressBar
                percent={aggregateProgress(media)}
                label={
                  media.length > 1 ? "Uploading photos" : "Uploading photo"
                }
              />
            </div>
          )}
        </div>
      )}

      {currentJob && (
        <ImageCropper
          key={`${currentJob.replaceId ?? "new"}-${currentJob.file.name}-${currentJob.file.lastModified}`}
          file={currentJob.file}
          aspect={ASPECT_VALUE["1:1"]}
          aspectOptions
          ratios={MEDIA_ASPECT_OPTIONS}
          title="Crop photo"
          subtitle={cropSubtitle}
          onCancel={dropCurrentJob}
          onCropped={(result) => onCropped(currentJob, result)}
        />
      )}

      {/*
        Action row. These were three bordered pills competing with the Post CTA
        for attention; here they are labelled glyph buttons with no chrome at
        rest, so the only filled control in the composer is the one that
        actually publishes (apple.md §16 — hierarchy through contrast, and
        §12 — don't stack surfaces). Toggles show their ON state by turning
        a neutral raised fill — the same "selected" language the segmented
        controls and tabs use.
      */}
      <div className="mt-3 flex items-center justify-between">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // A post can hold up to five images, so the picker lets the user grab
          // them in one go; pressing the action again appends more.
          multiple
          hidden
          onChange={onPickImages}
        />
        {!pollOptions && (
          <ComposerAction
            icon={ImagePlus}
            label="Image"
            onClick={() => fileRef.current?.click()}
            disabled={media.length >= MAX_POST_MEDIA}
          />
        )}
        <ComposerAction
          icon={BarChart3}
          label="Poll"
          onClick={togglePoll}
          disabled={uploading}
          pressed={!!pollOptions}
        />
        {/* UAT-005: anonymity moved out of the community Main panel — posts there
            are moderated and attributed. It lives in the community chat room
            instead. The main campus feed keeps it. */}
        {!communityId && (
          <AnonymousToggle pressed={anon} onToggle={() => setAnon((a) => !a)} />
        )}
        {/* The one coloured control in the composer, and only once it can
            actually publish. Disabled it drops to an inert neutral fill (see
            the `brand` variant) rather than a dimmed purple, so "there is
            nothing to post yet" is legible at a glance instead of reading as
            the same button, slightly darker. */}
        <GlassButton
          size="sm"
          variant="brand"
          className="shrink-0"
          onClick={submit}
          disabled={!publishable}
        >
          {pending ? "Posting…" : uploading ? "Uploading…" : "Post"}
        </GlassButton>
      </div>
      {/* UAT-13: anonymity must never be a silent state.
          The toggle is a 24px icon in a row of four; once it is on, nothing else
          on screen says so, and the next post — after an error, or after the
          composer was reopened — goes out anonymous without the author noticing.
          This banner is the explicit confirmation, and it carries its own way
          back out, so turning anonymity off never requires finding the icon
          again. `role="status"` announces the state change to a screen reader
          rather than leaving it to the button's `aria-pressed` alone. */}
      {anon && !communityId && (
        <div
          role="status"
          className="mt-2 flex items-center gap-2 rounded-[10px] bg-fill px-3 py-2"
        >
          <VenetianMask className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="type-caption flex-1 text-fg-muted">
            Posting anonymously — your name and photo stay hidden.
          </span>
          <button
            type="button"
            onClick={() => setAnon(false)}
            className="focus-ring type-caption shrink-0 rounded-full px-2 py-1 font-semibold text-accent"
          >
            Undo
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="type-callout mt-2 text-success">
          {notice}
        </p>
      )}
    </GlassCard>
  );
}

/**
 * One draft slide's preview.
 *
 * Before the upload finishes the source is the local blob, afterwards the
 * stored URL — so the picture on screen is always the thing that will actually
 * be posted. The object URL comes from `useObjectUrl`, which binds its lifetime
 * to the blob inside a single effect and therefore survives Strict Mode's
 * double-invoke instead of leaving the preview pointed at a revoked blob.
 */
function DraftPreview({
  item,
  fit,
}: {
  item: DraftMediaItem;
  fit: "cover" | "contain";
}) {
  const localUrl = useObjectUrl(item.blob);
  const src = localUrl ?? item.url;
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a blob: preview has no remote loader to route through
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn(
        "absolute inset-0 h-full w-full",
        fit === "contain" ? "object-contain" : "object-cover"
      )}
      decoding="async"
    />
  );
}

/** A small labelled control in the slide toolbar. 36px tall, real hit area. */
function SlideControl({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "pressable focus-ring flex h-9 items-center gap-1.5 rounded-[10px] px-2.5",
        "type-caption font-medium disabled:opacity-40",
        tone === "danger" ? "text-error" : "text-fg-muted hover:text-fg"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
