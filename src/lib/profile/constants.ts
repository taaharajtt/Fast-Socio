/**
 * FAST NUCES academic constants for the profile wizard. Department list covers
 * the common FAST programs; adjust as the canonical list is confirmed.
 */
export const DEPARTMENTS = [
  "Computer Science",
  "Software Engineering",
  "Artificial Intelligence",
  "Data Science",
  "Cyber Security",
  "Electrical Engineering",
  "Business Analytics",
  "Business Administration",
  "Accounting & Finance",
  "Computational Finance",
  "Mathematics",
] as const;

/** Semesters 1–8 cover a standard four-year program. */
export const SEMESTERS = Array.from({ length: 8 }, (_, i) => i + 1);

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

/** Interest tags shown as selectable glass pills (pick a handful). */
export const INTERESTS = [
  "Coding",
  "Gaming",
  "Music",
  "Sports",
  "Gym",
  "Art",
  "Photography",
  "Reading",
  "Movies",
  "Anime",
  "Startups",
  "Hackathons",
  "Robotics",
  "AI/ML",
  "Design",
  "Volunteering",
  "Travel",
  "Food",
  "Debating",
  "Cricket",
  "Football",
  "Cooking",
] as const;

export const MIN_INTERESTS = 3;
export const MAX_INTERESTS = 8;
export const BIO_MAX = 300;
