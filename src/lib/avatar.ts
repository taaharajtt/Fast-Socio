/**
 * Default profile pictures shown when a user hasn't uploaded one. Only
 * `male`/`female` genders get a stylized default; other/unset genders keep
 * whatever fallback the caller already renders (initials, blank, etc.).
 */
const DEFAULT_AVATARS: Record<string, string> = {
  male: "/brand/boy.jpg",
  female: "/brand/girl.jpg",
};

export function resolveAvatarUrl(
  avatarUrl: string | null | undefined,
  gender: string | null | undefined
): string | null {
  if (avatarUrl) return avatarUrl;
  if (gender && DEFAULT_AVATARS[gender]) return DEFAULT_AVATARS[gender];
  return null;
}
