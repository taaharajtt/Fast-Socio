/** Deterministic emoji icon for a community, inferred from its name (UISpec V3
 *  Screens 11–12 show each community with a distinct icon). */
export function communityIcon(name: string): string {
  const n = name.toLowerCase();
  if (/(food|foodie|dining|eat|chai|café|cafe)/.test(n)) return "🍕";
  if (/(code|coding|cs|dev|tech|vibe|hack)/.test(n)) return "💻";
  if (/(study|squad|notes|exam|academ)/.test(n)) return "📚";
  if (/meme/.test(n)) return "😄";
  if (/(game|gaming|esport)/.test(n)) return "🎮";
  if (/music|band|beat/.test(n)) return "🎵";
  if (/art|design|photo/.test(n)) return "🎨";
  if (/sport|football|cricket|gym/.test(n)) return "⚽";
  return "👥";
}
