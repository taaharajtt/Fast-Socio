import { describe, it, expect } from "vitest";

// image.ts reads its config at module scope, so the environment has to be in
// place before the import is evaluated.
const BASE = "https://eu2.contabostorage.com/tenant:fast-socio";
const IMGPROXY = "https://img.fastsocio.online";
process.env.NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL = BASE;
process.env.NEXT_PUBLIC_IMGPROXY_URL = IMGPROXY;

const { optimizedImage, optimizedAvatar } = await import("./image");

const publicUrl = `${BASE}/post-media/shared/x.jpg`;

describe("optimizedImage (P4-04)", () => {
  it("routes a storage URL through imgproxy at 1080px", () => {
    const out = optimizedImage(publicUrl)!;
    expect(out.startsWith(`${IMGPROXY}/insecure/`)).toBe(true);
    // rs:fit preserves aspect ratio; the trailing :0 forbids upscaling, which
    // is what resize=contain used to guarantee on the Supabase render endpoint.
    expect(out).toContain("/rs:fit:1080:1080:0/");
    expect(out).toContain(`/plain/${encodeURIComponent(publicUrl)}`);
  });

  it("honours a custom size", () => {
    expect(optimizedImage(publicUrl, 512)).toContain("/rs:fit:512:512:0/");
  });

  it("avatars default to 256px", () => {
    expect(optimizedAvatar(publicUrl)).toContain("/rs:fit:256:256:0/");
  });

  it("passes through foreign URLs and nullish input unchanged", () => {
    // imgproxy is locked to our own bucket, so anything else must not be
    // wrapped — doing so would turn it into an open image proxy.
    expect(optimizedImage("https://evil.com/x.png")).toBe("https://evil.com/x.png");
    expect(optimizedImage(null)).toBe(null);
    expect(optimizedImage(undefined)).toBe(null);
  });

  it("does not wrap a presigned (private) URL", () => {
    const presigned = `${BASE.replace("/tenant:fast-socio", "")}/other/chat-media/room/a.jpg?X-Amz-Signature=abc`;
    expect(optimizedImage(presigned)).toBe(presigned);
  });
});
