/**
 * Department display metadata for the Ranks screens (UISpec V3 Screens 6–8):
 * a short abbreviation ("Computer Science" → "CS") and a distinct icon emoji
 * per department. `profiles.department` stores the full name, so both the
 * student rows (dept shown abbreviated) and the Department Rankings tab derive
 * their labels from here. Unknown departments fall back to a derived initialism.
 */
type DeptMeta = { abbr: string; icon: string };

const DEPT_META: Record<string, DeptMeta> = {
  "Computer Science": { abbr: "CS", icon: "💻" },
  "Artificial Intelligence": { abbr: "AI", icon: "🤖" },
  "Software Engineering": { abbr: "SE", icon: "⚙️" },
  "Electrical Engineering": { abbr: "EE", icon: "⚡" },
  "Business Administration": { abbr: "BBA", icon: "📊" },
  "Accounting & Finance": { abbr: "A&F", icon: "💰" },
  "Data Science": { abbr: "DS", icon: "📈" },
  "Civil Engineering": { abbr: "CE", icon: "🏗️" },
  "Mechanical Engineering": { abbr: "ME", icon: "🔧" },
  "Computer Engineering": { abbr: "CE", icon: "🖥️" },
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
