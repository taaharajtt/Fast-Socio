import { ALUMNI_SEMESTER } from "./constants";

/**
 * Derive a student's current semester from their roll number (username), so the
 * value is always live and never needs a scheduled update ("compute on read").
 *
 * FAST roll numbers embed the batch as their first two digits — the calendar
 * year (20YY) the student enrolled, always in a Fall term. Both campus formats
 * are handled: `i240733` (email local-part style) and `24i5525` (printed
 * roll-number style) both yield batch 24. A degree is 8 semesters over 4 years,
 * two terms per year: Fall starts 1 August, Spring starts 1 January.
 *
 * We index terms on a single monotonic scale so consecutive terms differ by 1:
 *   Fall of year Y   → 2·Y
 *   Spring of year Y → 2·Y − 1   (the Spring that follows Fall of Y−1)
 * A batch begins at the Fall of its year (index 2·(20YY)), and each elapsed term
 * adds one semester: `semester = currentTermIndex − batchStartIndex + 1`.
 *
 * Returns 1–8 for an active student, {@link ALUMNI_SEMESTER} once semester 8 is
 * finished (this is how batches 2021 and earlier resolve to Alumni), or `null`
 * when the roll number can't be parsed or the batch hasn't enrolled yet.
 */
export function deriveSemester(
  username: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!username) return null;
  // Batch year = the two digits at the start of the roll, allowing one optional
  // leading letter: matches both `24i5525` and `i240733`, rejects non-rolls.
  const match = /^[^0-9]?(\d{2})/.exec(username);
  if (!match) return null;

  const batchStart = 2 * (2000 + Number(match[1])); // Fall of the enrolment year
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1–12
  const currentTerm = month >= 8 ? 2 * year : 2 * year - 1;

  const semester = currentTerm - batchStart + 1;
  if (semester < 1) return null; // batch hasn't started yet
  if (semester > 8) return ALUMNI_SEMESTER; // graduated
  return semester;
}
