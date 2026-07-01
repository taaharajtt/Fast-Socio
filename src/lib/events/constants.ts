export const EVENT_CATEGORIES = [
  "Social",
  "Tech",
  "Academic",
  "Sports",
  "Music",
  "Arts",
  "Career",
  "Gaming",
  "Food",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
