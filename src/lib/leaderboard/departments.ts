/**
 * Department display metadata for the Ranks screens (UISpec V3 Screens 6–8):
 * a short abbreviation ("Computer Science" → "CS") and a distinct icon emoji
 * per department. `profiles.department` stores the full name, so both the
 * student rows (dept shown abbreviated) and the Department Rankings tab derive
 * their labels from here. Unknown departments fall back to a derived initialism.
 */
type DeptMeta = { abbr: string; icon: string };

const DEPT_META: Record<string, DeptMeta> = {
  // Three schools (UAT-008).
  "Fast School of Computing": { abbr: "FSC", icon: "💻" },
  "Fast School of Engineering": { abbr: "FSE", icon: "⚙️" },
  "Fast School of Management": { abbr: "FSM", icon: "📊" },
  // Legacy degree names — kept so a profile not yet remapped still renders a
  // sensible badge until the 0048 backfill + user reconfirmation lands.
  "Computer Science": { abbr: "FSC", icon: "💻" },
  "Artificial Intelligence": { abbr: "FSC", icon: "💻" },
  "Software Engineering": { abbr: "FSC", icon: "💻" },
  "Data Science": { abbr: "FSC", icon: "💻" },
  "Cyber Security": { abbr: "FSC", icon: "💻" },
  "Computational Finance": { abbr: "FSC", icon: "💻" },
  Mathematics: { abbr: "FSC", icon: "💻" },
  "Electrical Engineering": { abbr: "FSE", icon: "⚙️" },
  "Civil Engineering": { abbr: "FSE", icon: "⚙️" },
  "Mechanical Engineering": { abbr: "FSE", icon: "⚙️" },
  "Business Administration": { abbr: "FSM", icon: "📊" },
  "Business Analytics": { abbr: "FSM", icon: "📊" },
  "Accounting & Finance": { abbr: "FSM", icon: "📊" },
};

/** Build an initialism from a full name ("Foo Bar Baz" → "FBB"), capped at 4. */
function initialism(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter((c) => c && /[A-Za-z]/.test(c))
    .join("")
    .toUpperCase();
  return letters.slice(0, 4) || name.slice(0, 2).toUpperCase();
}

export function deptMeta(department: string | null | undefined): DeptMeta {
  if (!department) return { abbr: "—", icon: "🎓" };
  return DEPT_META[department] ?? { abbr: initialism(department), icon: "🎓" };
}
