/**
 * FAST NUCES schools (UAT-008). Individual degrees were collapsed into the three
 * schools; `profiles.department` now stores one of these full names. The picker
 * asks for your school, not your programme.
 */
export const DEPARTMENTS = [
  "Fast School of Computing",
  "Fast School of Engineering",
  "Fast School of Management",
] as const;

/** UI noun for `profiles.department` after the schools change (UAT-008). */
export const SCHOOL_FIELD_LABEL = "School";

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
