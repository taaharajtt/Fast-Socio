/** Leaderboard titles for the top 10 (UI Spec §5: elite, aspirational framing).
 *  Ranks 1–3 lead the podium; 4–10 get their own tinted title on the list. */
export const LEADERBOARD_TITLES: Record<number, { title: string; emoji: string; tint: string }> = {
  1: { title: "Main Character", emoji: "🥇", tint: "#FFD36E" },
  2: { title: "Campus Celebrity", emoji: "🥈", tint: "#D8DEE9" },
  3: { title: "Aura Farmer", emoji: "🥉", tint: "#E0A46B" },
  4: { title: "Vibe Curator", emoji: "✨", tint: "#C9A7EB" },
  5: { title: "Certified Legend", emoji: "🌟", tint: "#7CC4FF" },
  6: { title: "Social Butterfly", emoji: "🦋", tint: "#6EE7C7" },
  7: { title: "Trendsetter", emoji: "🔥", tint: "#FF9E7A" },
  8: { title: "Rising Star", emoji: "🚀", tint: "#F7A8C4" },
  9: { title: "Crowd Favorite", emoji: "💫", tint: "#B8C0FF" },
  10: { title: "Buzzworthy", emoji: "🐝", tint: "#FFD98E" },
};
