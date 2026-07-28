/**
 * Default profile pictures shown when a user hasn't uploaded one. Only
 * `male`/`female` genders get a stylized default; other/unset genders keep
 * whatever fallback the caller already renders (initials, blank, etc.).
 *
 * WebP, not the original JPEGs: these are flat silhouette illustrations, which
 * WebP encodes at 6 KB against the JPEGs' 270 KB for the identical 885px image
 * (44x, pixel-indistinguishable). That size matters more here than anywhere
 * else in the app — `supabaseLoader` cannot transform a local path, so whatever
 * is on disk is exactly what a 28px avatar downloads, and a single feed can
 * mount twenty of them. Being two fixed URLs shared by every user of a gender,
 * they resolve to one cache entry that is warm after the first screen.
 */
const DEFAULT_AVATARS: Record<string, string> = {
  male: "/brand/boy.webp",
  female: "/brand/girl.webp",
};

export function resolveAvatarUrl(
  avatarUrl: string | null | undefined,
  gender: string | null | undefined
): string | null {
  if (avatarUrl) return avatarUrl;
  if (gender && DEFAULT_AVATARS[gender]) return DEFAULT_AVATARS[gender];
  return null;
}
