import { describe, expect, it } from "vitest";
import { MAX_POST_MEDIA, type MediaAspect } from "./media";
import {
  acceptFiles,
  aggregateProgress,
  allUploaded,
  canPublish,
  moveItem,
  remainingCapacity,
  removeAt,
  replaceAt,
  toMediaInput,
  uploadedUrls,
  type DraftMediaItem,
  type DraftMediaStatus,
} from "./draft-media";

/** A draft item with only the fields these rules actually read. */
function item(
  id: string,
  status: DraftMediaStatus = "uploaded",
  aspect: MediaAspect = "1:1"
): DraftMediaItem {
  return {
    id,
    file: { name: `${id}.jpg` } as unknown as File,
    blob: status === "uploaded" ? null : ({} as Blob),
    extension: "jpg",
    mimeType: "image/jpeg",
    aspect,
    width: 1080,
    height: 1080,
    status,
    progress: status === "uploaded" ? 100 : 0,
    url: status === "uploaded" ? `https://cdn.test/${id}.jpg` : null,
    error: null,
  };
}

describe("capacity", () => {
  it("counts down to the ceiling", () => {
    expect(remainingCapacity(0)).toBe(MAX_POST_MEDIA);
    expect(remainingCapacity(3)).toBe(2);
    expect(remainingCapacity(MAX_POST_MEDIA)).toBe(0);
  });

  it("never goes negative if the draft somehow overflowed", () => {
    expect(remainingCapacity(9)).toBe(0);
  });
});

describe("accepting a pick", () => {
  it("takes everything when it fits", () => {
    const result = acceptFiles(0, ["a", "b", "c"]);
    expect(result.accepted).toEqual(["a", "b", "c"]);
    expect(result.rejected).toBe(0);
    expect(result.message).toBeNull();
  });

  it("appends up to the ceiling across repeated picks", () => {
    const first = acceptFiles(0, ["a", "b", "c"]);
    const second = acceptFiles(first.accepted.length, ["d", "e"]);
    expect(second.accepted).toEqual(["d", "e"]);
    expect(first.accepted.length + second.accepted.length).toBe(MAX_POST_MEDIA);
  });

  it("keeps only what fits and says so", () => {
    const result = acceptFiles(3, ["d", "e", "f", "g"]);
    expect(result.accepted).toEqual(["d", "e"]);
    expect(result.rejected).toBe(2);
    expect(result.message).toContain("5");
  });

  it("accepts nothing once the draft is full, and explains why", () => {
    const result = acceptFiles(MAX_POST_MEDIA, ["x"]);
    expect(result.accepted).toEqual([]);
    expect(result.message).not.toBeNull();
  });
});

describe("ordering", () => {
  const items = ["a", "b", "c", "d"];

  it("moves a slide and keeps everything else in order", () => {
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(items, 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("is a no-op for a move that goes nowhere or off the ends", () => {
    expect(moveItem(items, 1, 1)).toEqual(items);
    expect(moveItem(items, 0, -1)).toEqual(items);
    expect(moveItem(items, 0, 4)).toEqual(items);
  });

  it("never mutates the array it was given", () => {
    const source = [...items];
    moveItem(source, 0, 3);
    removeAt(source, 1);
    replaceAt(source, 1, "z");
    expect(source).toEqual(items);
  });

  it("removes and replaces by index, ignoring out-of-range ones", () => {
    expect(removeAt(items, 1)).toEqual(["a", "c", "d"]);
    expect(removeAt(items, 9)).toEqual(items);
    expect(replaceAt(items, 2, "z")).toEqual(["a", "b", "z", "d"]);
    expect(replaceAt(items, -1, "z")).toEqual(items);
  });
});

describe("upload readiness", () => {
  it("is ready only when every slide is stored", () => {
    expect(allUploaded([item("a"), item("b")])).toBe(true);
    expect(allUploaded([item("a"), item("b", "uploading")])).toBe(false);
    expect(allUploaded([item("a"), item("b", "error")])).toBe(false);
    expect(allUploaded([item("a"), item("b", "ready")])).toBe(false);
  });

  it("averages progress across the draft", () => {
    expect(aggregateProgress([])).toBe(0);
    expect(aggregateProgress([item("a"), item("b")])).toBe(100);
    const half = { ...item("b", "uploading"), progress: 50 };
    expect(aggregateProgress([item("a"), half])).toBe(75);
  });
});

describe("publishing", () => {
  const ready = [item("a"), item("b")];

  it("allows text alone", () => {
    expect(
      canPublish({ body: "hello", media: [], pollOptions: null, busy: false })
    ).toBe(true);
  });

  it("allows images with no caption", () => {
    expect(
      canPublish({ body: "  ", media: ready, pollOptions: null, busy: false })
    ).toBe(true);
  });

  it("refuses an empty post", () => {
    expect(
      canPublish({ body: "   ", media: [], pollOptions: null, busy: false })
    ).toBe(false);
  });

  it("refuses while any slide is unprocessed, uploading or failed", () => {
    for (const status of ["ready", "uploading", "error"] as const) {
      expect(
        canPublish({
          body: "hi",
          media: [item("a"), item("b", status)],
          pollOptions: null,
          busy: false,
        })
      ).toBe(false);
    }
  });

  it("refuses while the composer is busy (cropping, uploading, posting)", () => {
    expect(
      canPublish({ body: "hi", media: ready, pollOptions: null, busy: true })
    ).toBe(false);
  });

  it("refuses a poll that also carries media", () => {
    expect(
      canPublish({
        body: "Question?",
        media: ready,
        pollOptions: ["a", "b"],
        busy: false,
      })
    ).toBe(false);
  });

  it("needs a question and two filled options for a poll", () => {
    expect(
      canPublish({ body: "Q?", media: [], pollOptions: ["a", "b"], busy: false })
    ).toBe(true);
    expect(
      canPublish({ body: "Q?", media: [], pollOptions: ["a", " "], busy: false })
    ).toBe(false);
    expect(
      canPublish({ body: "  ", media: [], pollOptions: ["a", "b"], busy: false })
    ).toBe(false);
  });

  it("refuses a draft that somehow exceeded the ceiling", () => {
    const tooMany = Array.from({ length: 6 }, (_, i) => item(`m${i}`));
    expect(
      canPublish({ body: "hi", media: tooMany, pollOptions: null, busy: false })
    ).toBe(false);
  });
});

describe("the submitted payload", () => {
  it("is the draft order, one entry per stored slide", () => {
    const items = [item("a", "uploaded", "16:9"), item("b", "uploaded", "9:16")];
    expect(toMediaInput(items)).toEqual([
      { url: items[0].url, aspect: "16:9", width: 1080, height: 1080 },
      { url: items[1].url, aspect: "9:16", width: 1080, height: 1080 },
    ]);
  });

  it("follows a reorder", () => {
    const items = [item("a"), item("b"), item("c")];
    const moved = moveItem(items, 2, 0);
    expect(toMediaInput(moved).map((m) => m.url)).toEqual([
      items[2].url,
      items[0].url,
      items[1].url,
    ]);
  });

  it("omits slides that have no stored URL", () => {
    expect(toMediaInput([item("a"), item("b", "ready")])).toHaveLength(1);
  });
});

describe("orphan tracking", () => {
  it("lists exactly the slides that reached storage", () => {
    const items = [item("a"), item("b", "uploading"), item("c")];
    expect(uploadedUrls(items)).toEqual([items[0].url, items[2].url]);
  });

  it("has nothing to purge for a draft that never uploaded", () => {
    expect(uploadedUrls([item("a", "ready")])).toEqual([]);
  });
});

describe("composer reset", () => {
  // The reset itself lives in the component; what a reset must PRODUCE is this:
  // no media, nothing left to purge, the default layout, and a composer that
  // cannot publish an empty post.
  it("leaves a draft that is empty, purge-free and unpublishable", () => {
    const cleared: DraftMediaItem[] = [];
    expect(cleared).toHaveLength(0);
    expect(uploadedUrls(cleared)).toEqual([]);
    expect(toMediaInput(cleared)).toEqual([]);
    expect(
      canPublish({ body: "", media: cleared, pollOptions: null, busy: false })
    ).toBe(false);
  });
});
