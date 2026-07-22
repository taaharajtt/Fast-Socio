import { describe, expect, it } from "vitest";
import {
  clampOffset,
  coverScale,
  exportSize,
  reconcileView,
  sourceRect,
  MAX_EXPORT_EDGE,
  MIN_ZOOM,
  type Offset,
  type Size,
} from "./crop";

const FRAME = { width: 400, height: 400 };

describe("coverScale", () => {
  it("scales the constraining axis so the frame is fully covered", () => {
    // A wide image must be scaled by its (smaller) height ratio to cover.
    expect(coverScale({ width: 2000, height: 1000 }, FRAME)).toBe(0.4);
    expect(coverScale({ width: 1000, height: 2000 }, FRAME)).toBe(0.4);
  });

  it("upscales an image smaller than the frame", () => {
    expect(coverScale({ width: 200, height: 200 }, FRAME)).toBe(2);
  });

  it("does not divide by zero on a degenerate image", () => {
    expect(coverScale({ width: 0, height: 0 }, FRAME)).toBe(1);
  });
});

describe("clampOffset", () => {
  const natural = { width: 1000, height: 500 };

  it("keeps the frame inside the scaled image", () => {
    // At scale 0.8 the image displays at 800x400 — 400px of slack on x, none on y.
    expect(clampOffset({ x: 50, y: 0 }, natural, FRAME, 0.8)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: -500, y: 0 }, natural, FRAME, 0.8)).toEqual({
      x: -400,
      y: 0,
    });
  });

  it("pins an axis whose scaled size exactly matches the frame", () => {
    expect(clampOffset({ x: -10, y: -10 }, natural, FRAME, 0.8).y).toBe(0);
  });

  // Regression: an image scaled fractionally under the frame used to invert the
  // clamp interval (min > max) and return NaN, blanking the crop.
  it("never returns NaN when the image is a hair smaller than the frame", () => {
    const result = clampOffset({ x: -5, y: -5 }, { width: 400, height: 400 }, FRAME, 0.9999);
    expect(Number.isNaN(result.x)).toBe(false);
    expect(Number.isNaN(result.y)).toBe(false);
  });
});

describe("sourceRect", () => {
  it("maps a pan offset back into image pixel space", () => {
    expect(sourceRect({ x: -200, y: -100 }, FRAME, 2)).toEqual({
      sx: 100,
      sy: 50,
      sw: 200,
      sh: 200,
    });
  });

  // -0 rather than 0, since sx = -offset.x. drawImage treats them identically.
  it("reads from the origin when the image is not panned", () => {
    const rect = sourceRect({ x: 0, y: 0 }, FRAME, 1);
    expect(rect.sx).toBeCloseTo(0);
    expect(rect.sy).toBeCloseTo(0);
    expect(rect.sw).toBe(400);
    expect(rect.sh).toBe(400);
  });
});

describe("exportSize", () => {
  it("passes through a crop already under the cap", () => {
    expect(exportSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("caps the largest edge and preserves aspect ratio", () => {
    const size = exportSize(4000, 2000);
    expect(size.width).toBe(MAX_EXPORT_EDGE);
    expect(size.height).toBe(MAX_EXPORT_EDGE / 2);
  });

  it("never rounds a thin crop down to zero", () => {
    expect(exportSize(4000, 0.4).height).toBe(1);
  });
});

describe("reconcileView", () => {
  const natural: Size = { width: 4000, height: 3000 };
  const frame: Size = { width: 420, height: 525 }; // 4:5 portrait post frame

  /** The view a freshly-opened cropper centres to. */
  function centred() {
    return reconcileView({
      imageKey: "blob:a",
      centeredKey: "",
      natural,
      frame,
      lastFrame: { width: 0, height: 0 },
      zoom: MIN_ZOOM,
      offset: { x: 0, y: 0 },
    })!;
  }

  it("centres once when the image first appears", () => {
    const r = centred();
    expect(r.zoom).toBe(MIN_ZOOM);
    expect(r.centeredKey).toBe("blob:a");
  });

  it("does nothing on a steady state (same image, same frame)", () => {
    const c = centred();
    const r = reconcileView({
      imageKey: "blob:a",
      centeredKey: "blob:a",
      natural,
      frame,
      lastFrame: c.lastFrame,
      zoom: 2.5,
      offset: c.offset,
    });
    expect(r).toBeNull(); // the user's zoom/pan is left untouched
  });

  // Regression: a mobile toolbar show/hide changes the frame height mid-gesture.
  // The old code re-centred (reset to MIN_ZOOM), so Done exported an uncropped
  // image. The view must keep the user's zoom across a frame change.
  it("preserves the user's zoom when the frame jitters mid-gesture", () => {
    const zoomed = 2.5;
    const jittered: Size = { width: 420, height: 500 };
    const r = reconcileView({
      imageKey: "blob:a",
      centeredKey: "blob:a",
      natural,
      frame: jittered,
      lastFrame: frame,
      zoom: zoomed,
      offset: { x: -300, y: -400 } as Offset,
    });
    expect(r).not.toBeNull();
    expect(r!.zoom).toBe(zoomed); // NOT reset to MIN_ZOOM
    expect(r!.lastFrame).toEqual(jittered);
  });

  it("re-centres when a different image is loaded", () => {
    const r = reconcileView({
      imageKey: "blob:b",
      centeredKey: "blob:a",
      natural,
      frame,
      lastFrame: frame,
      zoom: 3,
      offset: { x: -900, y: -900 },
    });
    expect(r).not.toBeNull();
    expect(r!.zoom).toBe(MIN_ZOOM);
    expect(r!.centeredKey).toBe("blob:b");
  });

  it("a zoomed crop frames strictly fewer source pixels than the centred one", () => {
    // Proves the symptom: the reset (centred) view exports the full 'cover'
    // region, while a real zoom exports a tighter sub-crop.
    const c = centred();
    const baseScale = coverScale(natural, frame);
    const centredSrc = sourceRect(c.offset, frame, baseScale * c.zoom);
    const zoomedSrc = sourceRect(c.offset, frame, baseScale * 2.5);
    expect(zoomedSrc.sw).toBeLessThan(centredSrc.sw);
    expect(zoomedSrc.sh).toBeLessThan(centredSrc.sh);
  });
});
