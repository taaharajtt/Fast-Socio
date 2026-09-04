import { describe, expect, it } from "vitest";
import {
  ASPECT_VALUE,
  CAROUSEL_LAYOUTS,
  MAX_POST_MEDIA,
  MEDIA_ASPECTS,
  clampSlideIndex,
  coverMedia,
  isCarousel,
  isCarouselLayout,
  isMediaAspect,
  isStandardSourceRatio,
  nearestMediaAspect,
  normalizePostMedia,
  slideFit,
  slideLabel,
  validatePostMedia,
  viewportAspect,
  type MediaAspect,
  type PostMedia,
} from "./media";

const HOST = "https://cdn.example.test";
const isOurs = (url: string) => url.startsWith(`${HOST}/`);

function media(aspect: MediaAspect, n = 0): PostMedia {
  const size = { "1:1": [1080, 1080], "16:9": [1080, 608], "9:16": [608, 1080] }[
    aspect
  ];
  return {
    url: `${HOST}/post-media/shared/${n}.jpg`,
    aspect,
    width: size[0],
    height: size[1],
  };
}

describe("the five-image ceiling", () => {
  it("is five, everywhere", () => {
    expect(MAX_POST_MEDIA).toBe(5);
  });

  it("accepts exactly five images", () => {
    const result = validatePostMedia({
      media: [0, 1, 2, 3, 4].map((n) => media("1:1", n)),
      layout: "uniform",
      hasPoll: false,
      isAllowedUrl: isOurs,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a sixth", () => {
    const result = validatePostMedia({
      media: [0, 1, 2, 3, 4, 5].map((n) => media("1:1", n)),
      layout: "uniform",
      hasPoll: false,
      isAllowedUrl: isOurs,
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("what counts as a carousel", () => {
  it("does not treat one image as a carousel", () => {
    expect(isCarousel([media("1:1")])).toBe(false);
  });

  it("treats two through five as carousels", () => {
    for (let n = 2; n <= MAX_POST_MEDIA; n++) {
      const items = Array.from({ length: n }, (_, i) => media("1:1", i));
      expect(isCarousel(items)).toBe(true);
    }
  });

  it("is not a carousel with no media at all", () => {
    expect(isCarousel([])).toBe(false);
  });
});

describe("ratio normalization", () => {
  it("recognises each supported ratio exactly", () => {
    expect(nearestMediaAspect(1)).toBe("1:1");
    expect(nearestMediaAspect(16 / 9)).toBe("16:9");
    expect(nearestMediaAspect(9 / 16)).toBe("9:16");
  });

  it("snaps every supported ratio to itself via its stored pixel size", () => {
    for (const aspect of MEDIA_ASPECTS) {
      const item = media(aspect);
      expect(nearestMediaAspect(item.width / item.height)).toBe(aspect);
    }
  });

  it("resolves non-standard sources into an allowed ratio", () => {
    // 4:3 is the exact geometric midpoint between 1:1 and 16:9 (4/3 squared is
    // 16/9), so the tie resolves to the first listed ratio — deterministically
    // square. 3:2 is past that midpoint and lands on landscape.
    expect(nearestMediaAspect(4 / 3)).toBe("1:1");
    expect(nearestMediaAspect(3 / 2)).toBe("16:9");
    expect(nearestMediaAspect(21 / 9)).toBe("16:9");
    expect(nearestMediaAspect(1170 / 2532)).toBe("9:16");
    expect(MEDIA_ASPECTS).toContain(nearestMediaAspect(4 / 3));
  });

  it("flags non-standard sources as needing a crop decision", () => {
    expect(isStandardSourceRatio(1)).toBe(true);
    expect(isStandardSourceRatio(16 / 9)).toBe(true);
    expect(isStandardSourceRatio(9 / 16)).toBe(true);
    expect(isStandardSourceRatio(4 / 3)).toBe(false);
    expect(isStandardSourceRatio(21 / 9)).toBe(false);
  });

  it("never returns garbage for a degenerate ratio", () => {
    expect(nearestMediaAspect(0)).toBe("1:1");
    expect(nearestMediaAspect(Number.NaN)).toBe("1:1");
    expect(isStandardSourceRatio(0)).toBe(false);
  });
});

describe("uniform layout", () => {
  it("takes its viewport ratio from slide 1", () => {
    const items = [media("16:9", 0), media("9:16", 1), media("1:1", 2)];
    expect(viewportAspect(items, "uniform")).toBeCloseTo(ASPECT_VALUE["16:9"]);
  });

  it("keeps the same viewport whatever the later slides are", () => {
    const first = media("9:16", 0);
    expect(viewportAspect([first, media("16:9", 1)], "uniform")).toBeCloseTo(
      viewportAspect([first, media("1:1", 1)], "uniform")
    );
  });

  it("centre-crops every slide", () => {
    expect(slideFit("uniform")).toBe("cover");
  });

  it("re-orders with slide 1, so a new first slide is a new viewport", () => {
    const items = [media("16:9", 0), media("9:16", 1)];
    const reordered = [items[1], items[0]];
    expect(viewportAspect(items, "uniform")).toBeCloseTo(ASPECT_VALUE["16:9"]);
    expect(viewportAspect(reordered, "uniform")).toBeCloseTo(ASPECT_VALUE["9:16"]);
  });
});

describe("mixed layout", () => {
  it("is always square, whatever slide 1 is", () => {
    for (const aspect of MEDIA_ASPECTS) {
      expect(viewportAspect([media(aspect)], "mixed")).toBe(1);
    }
  });

  it("contains every slide rather than cropping it", () => {
    expect(slideFit("mixed")).toBe("contain");
  });

  it("falls back to a square viewport with no media", () => {
    expect(viewportAspect([], "mixed")).toBe(1);
    expect(viewportAspect([], "uniform")).toBe(1);
  });
});

describe("the cover is always slide 1", () => {
  it("uses slide 1 and never a later slide", () => {
    const items = [media("9:16", 0), media("16:9", 1)];
    expect(coverMedia(items)).toBe(items[0].url);
  });

  it("still uses slide 1 after a reorder", () => {
    const items = [media("9:16", 0), media("16:9", 1)];
    expect(coverMedia([items[1], items[0]])).toBe(items[1].url);
  });

  it("falls back to a legacy image_url when there is no media", () => {
    expect(coverMedia([], `${HOST}/post-media/shared/legacy.jpg`)).toBe(
      `${HOST}/post-media/shared/legacy.jpg`
    );
  });

  it("is null for a post with neither", () => {
    expect(coverMedia([], null)).toBeNull();
    expect(coverMedia([])).toBeNull();
  });
});

describe("feed mapping of ordered media", () => {
  it("keeps the order the view returned", () => {
    const rows = [media("16:9", 0), media("1:1", 1), media("9:16", 2)];
    expect(normalizePostMedia(rows).map((m) => m.url)).toEqual(
      rows.map((m) => m.url)
    );
  });

  it("returns nothing for a text, poll or legacy post", () => {
    expect(normalizePostMedia([])).toEqual([]);
    expect(normalizePostMedia(null)).toEqual([]);
    expect(normalizePostMedia(undefined)).toEqual([]);
  });

  it("drops rows that would produce a wrong container size", () => {
    const rows = [
      media("1:1", 0),
      { url: `${HOST}/a.jpg`, aspect: "4:3", width: 100, height: 75 },
      { url: `${HOST}/b.jpg`, aspect: "1:1", width: 0, height: 100 },
      { url: "", aspect: "1:1", width: 10, height: 10 },
    ];
    expect(normalizePostMedia(rows)).toEqual([media("1:1", 0)]);
  });

  it("never returns more than the ceiling, whatever the view sends", () => {
    const rows = Array.from({ length: 12 }, (_, i) => media("1:1", i));
    expect(normalizePostMedia(rows)).toHaveLength(MAX_POST_MEDIA);
  });
});

describe("server-side validation", () => {
  const base = { layout: "uniform", hasPoll: false, isAllowedUrl: isOurs };

  it("accepts a well-formed single image", () => {
    expect(validatePostMedia({ ...base, media: [media("1:1")] })).toMatchObject({
      ok: true,
      layout: "uniform",
    });
  });

  it("accepts an empty payload — a text post is still a post", () => {
    expect(validatePostMedia({ ...base, media: [] })).toMatchObject({ ok: true });
    expect(validatePostMedia({ ...base, media: null })).toMatchObject({ ok: true });
  });

  it("rejects an unsupported ratio string", () => {
    expect(
      validatePostMedia({
        ...base,
        media: [{ ...media("1:1"), aspect: "4:3" }],
      })
    ).toMatchObject({ ok: false });
  });

  it("rejects non-positive and non-integer dimensions", () => {
    for (const size of [
      { width: 0, height: 100 },
      { width: 100, height: -1 },
      { width: 100.5, height: 100 },
    ]) {
      expect(
        validatePostMedia({ ...base, media: [{ ...media("1:1"), ...size }] })
      ).toMatchObject({ ok: false });
    }
  });

  it("rejects a URL that is not ours", () => {
    expect(
      validatePostMedia({
        ...base,
        media: [{ ...media("1:1"), url: "https://evil.example/x.jpg" }],
      })
    ).toMatchObject({ ok: false });
  });

  it("rejects a duplicate slide", () => {
    const item = media("1:1");
    expect(validatePostMedia({ ...base, media: [item, item] })).toMatchObject({
      ok: false,
    });
  });

  it("refuses media on a poll", () => {
    expect(
      validatePostMedia({ ...base, media: [media("1:1")], hasPoll: true })
    ).toMatchObject({ ok: false });
  });

  it("still allows a poll with no media", () => {
    expect(validatePostMedia({ ...base, media: [], hasPoll: true })).toMatchObject(
      { ok: true }
    );
  });

  it("rejects a malformed layout mode", () => {
    for (const layout of ["grid", "", 1, {}]) {
      expect(
        validatePostMedia({ ...base, layout, media: [media("1:1")] })
      ).toMatchObject({ ok: false });
    }
  });

  it("accepts both real layout modes and defaults a missing one", () => {
    for (const layout of CAROUSEL_LAYOUTS) {
      expect(
        validatePostMedia({ ...base, layout, media: [media("1:1")] })
      ).toMatchObject({ ok: true, layout });
    }
    expect(
      validatePostMedia({ ...base, layout: undefined, media: [media("1:1")] })
    ).toMatchObject({ ok: true, layout: "uniform" });
  });

  it("rejects a non-array payload rather than coercing it", () => {
    expect(
      validatePostMedia({ ...base, media: { url: `${HOST}/x.jpg` } })
    ).toMatchObject({ ok: false });
  });

  it("preserves slide order in what it returns", () => {
    const rows = [media("16:9", 0), media("9:16", 1), media("1:1", 2)];
    const result = validatePostMedia({ ...base, media: rows });
    expect(result.ok && result.media.map((m) => m.url)).toEqual(
      rows.map((m) => m.url)
    );
  });
});

describe("type guards", () => {
  it("only admits the three ratios and the two layouts", () => {
    expect(isMediaAspect("1:1")).toBe(true);
    expect(isMediaAspect("4:3")).toBe(false);
    expect(isMediaAspect(null)).toBe(false);
    expect(isCarouselLayout("mixed")).toBe(true);
    expect(isCarouselLayout("grid")).toBe(false);
  });
});

describe("slide labelling and index clamping", () => {
  it("labels slides one-based", () => {
    expect(slideLabel(0, 5)).toBe("Image 1 of 5");
    expect(slideLabel(4, 5)).toBe("Image 5 of 5");
  });

  it("clamps navigation to the ends", () => {
    expect(clampSlideIndex(-3, 5)).toBe(0);
    expect(clampSlideIndex(9, 5)).toBe(4);
    expect(clampSlideIndex(2, 5)).toBe(2);
    expect(clampSlideIndex(1, 0)).toBe(0);
  });
});
