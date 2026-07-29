import {
  Building2,
  Coffee,
  Trophy,
  DoorOpen,
  CircleParking,
  BookOpen,
  Moon,
  Trees,
  MapPin,
  BedDouble,
  Store,
  type LucideIcon,
} from "lucide-react";

/**
 * Campus Map places (v2). Coordinates are **percentages of the source
 * `public/map.png`**: x=0 left → x=100 right, y=0 top → y=100 bottom. Pins are
 * rendered inside the transformed image layer using these percentages, so they
 * stay anchored to the map through any zoom/pan.
 *
 * FUTURE (intentionally not built yet): indoor rooms, teacher offices, linking
 * an event's location to a place, "navigate from event to map", and an admin
 * pin editor. The shape below is deliberately flat and serialisable so any of
 * those can extend it (e.g. add `rooms`, `officeOf`, `eventId`) without a
 * migration.
 */
export type PlaceType =
  | "building"
  | "cafe"
  | "sports"
  | "gate"
  | "parking"
  | "library"
  | "prayer"
  | "hangout"
  | "hostel"
  | "service";

export type CampusPlace = {
  id: string;
  name: string;
  shortLabel: string;
  type: PlaceType;
  /** Percentage of image width from the left edge (0–100). */
  x: number;
  /** Percentage of image height from the top edge (0–100). */
  y: number;
  description: string;
  aliases: string[];
};

/** Display metadata per type: plural filter label, marker icon, accent color. */
export const PLACE_TYPE_META: Record<
  PlaceType,
  { label: string; icon: LucideIcon; /** Tailwind text/border/bg base, e.g. "sky". */ color: string }
> = {
  building: { label: "Buildings", icon: Building2, color: "#7c5cff" },
  cafe: { label: "Cafes", icon: Coffee, color: "#e0983c" },
  sports: { label: "Sports", icon: Trophy, color: "#3ecf8e" },
  gate: { label: "Gates", icon: DoorOpen, color: "#64b5ff" },
  parking: { label: "Parking", icon: CircleParking, color: "#9aa0aa" },
  library: { label: "Library", icon: BookOpen, color: "#c850c0" },
  prayer: { label: "Prayer", icon: Moon, color: "#4fd1c5" },
  hangout: { label: "Hangout", icon: Trees, color: "#7bc86c" },
  hostel: { label: "Hostels", icon: BedDouble, color: "#f472b6" },
  service: { label: "Services", icon: Store, color: "#ffb020" },
};

/** Fallback icon when a type is somehow unknown. */
export const DEFAULT_PLACE_ICON: LucideIcon = MapPin;

export const CAMPUS_MAP_PLACES: CampusPlace[] = [
  {
    id: "student-bike-parking",
    name: "Bike Parking for Students",
    shortLabel: "Bike Parking",
    type: "parking",
    x: 10,
    y: 13,
    description: "Student bike parking area near Gate 3.",
    aliases: ["bike parking", "student parking", "motorcycle parking", "parking"],
  },
  {
    id: "d-block",
    name: "D Block",
    shortLabel: "D Block",
    type: "building",
    x: 36,
    y: 10,
    description: "D Block academic building.",
    aliases: ["d block", "block d", "academic block d"],
  },
  {
    id: "c-block",
    name: "C Block",
    shortLabel: "C Block",
    type: "building",
    x: 59,
    y: 10,
    description: "C Block academic building.",
    aliases: ["c block", "block c", "academic block c"],
  },
  {
    id: "b-block",
    name: "B Block",
    shortLabel: "B Block",
    type: "building",
    x: 86,
    y: 11,
    description: "B Block academic building.",
    aliases: ["b block", "block b", "academic block b"],
  },
  {
    id: "a-block",
    name: "A Block",
    shortLabel: "A Block",
    type: "building",
    x: 88,
    y: 57,
    description: "A Block academic building.",
    aliases: ["a block", "block a", "academic block a"],
  },
  {
    id: "gate-1",
    name: "Gate 1",
    shortLabel: "Gate 1",
    type: "gate",
    x: 73,
    y: 97,
    description: "Gate 1 campus entrance.",
    aliases: ["gate 1", "main gate", "entrance 1"],
  },
  {
    id: "gate-2",
    name: "Gate 2",
    shortLabel: "Gate 2",
    type: "gate",
    x: 49,
    y: 97,
    description: "Gate 2 campus entrance.",
    aliases: ["gate 2", "entrance 2"],
  },
  {
    id: "gate-3",
    name: "Gate 3",
    shortLabel: "Gate 3",
    type: "gate",
    x: 1,
    y: 27,
    description: "Gate 3 campus entrance near student bike parking.",
    aliases: ["gate 3", "entrance 3"],
  },
  {
    id: "gate-4",
    name: "Gate 4",
    shortLabel: "Gate 4",
    type: "gate",
    x: 49,
    y: 2,
    description: "Gate 4 campus entrance near C and D blocks.",
    aliases: ["gate 4", "entrance 4"],
  },
  {
    id: "cricket-ground",
    name: "Cricket Ground",
    shortLabel: "Cricket",
    type: "sports",
    x: 20,
    y: 53,
    description: "Main cricket ground.",
    aliases: ["cricket", "cricket ground", "ground", "sports ground"],
  },
  {
    id: "futsal-ground",
    name: "Futsal Ground",
    shortLabel: "Futsal",
    type: "sports",
    x: 11,
    y: 89,
    description: "Futsal ground.",
    aliases: ["futsal", "football", "football ground", "sports"],
  },
  {
    id: "masjid",
    name: "Masjid",
    shortLabel: "Masjid",
    type: "prayer",
    x: 39,
    y: 79,
    description: "Campus masjid/prayer area.",
    aliases: ["masjid", "mosque", "prayer", "prayer area", "namaz"],
  },
  {
    id: "basketball-court",
    name: "Basketball Court",
    shortLabel: "Basketball",
    type: "sports",
    x: 43,
    y: 67,
    description: "Basketball court near the tennis court and masjid.",
    aliases: ["basketball", "basketball court", "court"],
  },
  {
    id: "tennis-court",
    name: "Tennis Court",
    shortLabel: "Tennis",
    type: "sports",
    x: 37,
    y: 67,
    description: "Tennis court near the basketball court and masjid.",
    aliases: ["tennis", "tennis court", "court"],
  },
  {
    id: "c-block-lrc",
    name: "C Block LRC",
    shortLabel: "LRC",
    type: "library",
    x: 63,
    y: 19,
    description: "Learning Resource Center near C Block.",
    aliases: ["lrc", "learning resource center", "library", "c block lrc"],
  },
  {
    id: "c-block-basement-cafe",
    name: "Cafe in Basement",
    shortLabel: "Basement Cafe",
    type: "cafe",
    x: 60,
    y: 14,
    description: "Cafe located in the C Block basement.",
    aliases: ["cafe", "basement cafe", "c block cafe", "food", "chai"],
  },
  {
    id: "faculty-parking-west",
    name: "Faculty Parking",
    shortLabel: "Faculty Parking",
    type: "parking",
    x: 61,
    y: 81,
    description: "Faculty parking area near the central road.",
    aliases: ["faculty parking", "parking", "staff parking"],
  },
  {
    id: "faculty-parking-east",
    name: "Faculty Parking",
    shortLabel: "Faculty Parking",
    type: "parking",
    x: 84,
    y: 82,
    description: "Faculty parking area near A Block.",
    aliases: ["faculty parking", "parking", "staff parking", "a block parking"],
  },
  {
    id: "faculty-parking-south",
    name: "Faculty Parking",
    shortLabel: "Faculty Parking",
    type: "parking",
    x: 63,
    y: 92,
    description: "Faculty parking area near Gate 2 and Gate 1.",
    aliases: ["faculty parking", "parking", "staff parking", "gate parking"],
  },
  {
    id: "faculty-parking-south-east",
    name: "Faculty Parking",
    shortLabel: "Faculty Parking",
    type: "parking",
    x: 84,
    y: 92,
    description: "Faculty parking area near Gate 1.",
    aliases: ["faculty parking", "parking", "staff parking", "gate 1 parking"],
  },
  {
    id: "wisdom-tree",
    name: "Wisdom Tree",
    shortLabel: "Wisdom Tree",
    type: "hangout",
    x: 67,
    y: 42,
    description: "Popular campus sitting/hangout spot.",
    aliases: ["wisdom tree", "tree", "hangout", "sitting spot"],
  },

  // ── Cafeterias ────────────────────────────────────────────────────────────
  {
    id: "d-block-cafeteria",
    name: "D Block Cafeteria",
    shortLabel: "D Cafeteria",
    type: "cafe",
    x: 34,
    y: 15, // TODO: verify position
    description: "Cafeteria near D Block.",
    aliases: ["d block cafeteria", "cafeteria", "d cafe", "food"],
  },
  {
    id: "b-block-cafeteria",
    name: "B Block Cafeteria",
    shortLabel: "B Cafeteria",
    type: "cafe",
    x: 84,
    y: 16, // TODO: verify position
    description: "Cafeteria near B Block.",
    aliases: ["b block cafeteria", "cafeteria", "b cafe", "food"],
  },
  {
    id: "a-block-cafeteria",
    name: "A Block Cafeteria",
    shortLabel: "A Cafeteria",
    type: "cafe",
    x: 86,
    y: 62, // TODO: verify position
    description: "Cafeteria near A Block.",
    aliases: ["a block cafeteria", "cafeteria", "a cafe", "food"],
  },

  // ── Labs ──────────────────────────────────────────────────────────────────
  {
    id: "d-block-computer-labs",
    name: "D Block Computer Labs",
    shortLabel: "CS Labs",
    type: "building",
    x: 38,
    y: 13, // TODO: verify position
    description: "Computer labs in D Block.",
    aliases: ["computer lab", "cs lab", "d block lab", "labs"],
  },
  {
    id: "c-block-networking-lab",
    name: "C Block Networking Lab",
    shortLabel: "Networking Lab",
    type: "building",
    x: 61,
    y: 13, // TODO: verify position
    description: "Networking lab in C Block.",
    aliases: ["networking lab", "c block lab", "labs"],
  },
  {
    id: "b-block-electronics-lab",
    name: "B Block Electronics Lab",
    shortLabel: "Electronics Lab",
    type: "building",
    x: 84,
    y: 14, // TODO: verify position
    description: "Electronics/hardware lab in B Block.",
    aliases: ["electronics lab", "hardware lab", "b block lab", "labs"],
  },
  {
    id: "a-block-software-labs",
    name: "A Block Software Labs",
    shortLabel: "Software Labs",
    type: "building",
    x: 90,
    y: 60, // TODO: verify position
    description: "Software engineering labs in A Block.",
    aliases: ["software lab", "a block lab", "labs"],
  },

  // ── Department offices ───────────────────────────────────────────────────
  {
    id: "cs-department-office",
    name: "CS Department Office",
    shortLabel: "CS Dept",
    type: "building",
    x: 57,
    y: 8, // TODO: verify position
    description: "Computer Science department office, near C Block.",
    aliases: ["cs department", "computer science department", "department office"],
  },
  {
    id: "ee-department-office",
    name: "EE Department Office",
    shortLabel: "EE Dept",
    type: "building",
    x: 83,
    y: 8, // TODO: verify position
    description: "Electrical Engineering department office, near B Block.",
    aliases: ["ee department", "electrical engineering department", "department office"],
  },
  {
    id: "ms-department-office",
    name: "Management Sciences Department Office",
    shortLabel: "MS Dept",
    type: "building",
    x: 34,
    y: 8, // TODO: verify position
    description: "Management Sciences department office, near D Block.",
    aliases: ["management sciences department", "ms department", "department office"],
  },
  {
    id: "ss-department-office",
    name: "Social Sciences Department Office",
    shortLabel: "SS Dept",
    type: "building",
    x: 85,
    y: 54, // TODO: verify position
    description: "Social Sciences department office, near A Block.",
    aliases: ["social sciences department", "ss department", "department office"],
  },

  // ── Auditoriums ───────────────────────────────────────────────────────────
  {
    id: "main-auditorium",
    name: "Main Auditorium",
    shortLabel: "Auditorium",
    type: "building",
    x: 70,
    y: 45, // TODO: verify position
    description: "Main campus auditorium, used for large events and ceremonies.",
    aliases: ["auditorium", "main auditorium", "hall"],
  },
  {
    id: "c-block-seminar-hall",
    name: "C Block Seminar Hall",
    shortLabel: "Seminar Hall",
    type: "building",
    x: 65,
    y: 18, // TODO: verify position
    description: "Seminar hall near C Block LRC.",
    aliases: ["seminar hall", "c block auditorium", "auditorium"],
  },

  // ── Sports facilities ─────────────────────────────────────────────────────
  {
    id: "gymnasium",
    name: "Gymnasium",
    shortLabel: "Gym",
    type: "sports",
    x: 23,
    y: 58, // TODO: verify position
    description: "Campus gymnasium near the cricket ground.",
    aliases: ["gym", "gymnasium", "fitness"],
  },
  {
    id: "squash-courts",
    name: "Squash Courts",
    shortLabel: "Squash",
    type: "sports",
    x: 40,
    y: 64, // TODO: verify position
    description: "Squash courts near the basketball and tennis courts.",
    aliases: ["squash", "squash court"],
  },
  {
    id: "volleyball-court",
    name: "Volleyball Court",
    shortLabel: "Volleyball",
    type: "sports",
    x: 14,
    y: 85, // TODO: verify position
    description: "Volleyball court near the futsal ground.",
    aliases: ["volleyball", "volleyball court"],
  },

  // ── Parking ───────────────────────────────────────────────────────────────
  {
    id: "visitor-parking",
    name: "Visitor Parking",
    shortLabel: "Visitor Parking",
    type: "parking",
    x: 75,
    y: 93, // TODO: verify position
    description: "Visitor parking area near Gate 1.",
    aliases: ["visitor parking", "guest parking", "parking"],
  },
  {
    id: "student-car-parking",
    name: "Student Car Parking",
    shortLabel: "Student Parking",
    type: "parking",
    x: 5,
    y: 30, // TODO: verify position
    description: "Student car parking near Gate 3.",
    aliases: ["student car parking", "student parking", "parking"],
  },

  // ── Mosque / prayer ───────────────────────────────────────────────────────
  {
    id: "ladies-prayer-area",
    name: "Ladies Prayer Area",
    shortLabel: "Ladies Prayer",
    type: "prayer",
    x: 37,
    y: 76, // TODO: verify position
    description: "Ladies prayer area next to the main masjid.",
    aliases: ["ladies prayer area", "ladies masjid", "prayer", "namaz"],
  },

  // ── Medical, bank/ATM, photocopy — grouped under the new "service" type ──
  {
    id: "medical-center",
    name: "Medical Center",
    shortLabel: "Medical",
    type: "service",
    x: 38,
    y: 16, // TODO: verify position
    description: "Campus medical/first-aid room near D Block.",
    aliases: ["medical center", "medical room", "clinic", "first aid", "nurse"],
  },
  {
    id: "bank-atm",
    name: "Bank & ATM",
    shortLabel: "Bank/ATM",
    type: "service",
    x: 58,
    y: 17, // TODO: verify position
    description: "Bank branch and ATM near the C Block basement cafe.",
    aliases: ["bank", "atm", "cash machine"],
  },
  {
    id: "photocopy-stationery",
    name: "Photocopy & Stationery Shop",
    shortLabel: "Photocopy",
    type: "service",
    x: 65,
    y: 21, // TODO: verify position
    description: "Photocopy and stationery shop near the C Block LRC.",
    aliases: ["photocopy", "stationery", "print shop", "xerox"],
  },

  // ── Hostels ───────────────────────────────────────────────────────────────
  {
    id: "boys-hostel-1",
    name: "Boys Hostel 1",
    shortLabel: "Boys Hostel 1",
    type: "hostel",
    x: 8,
    y: 60, // TODO: verify position
    description: "Boys hostel block 1.",
    aliases: ["boys hostel 1", "boys hostel", "hostel"],
  },
  {
    id: "boys-hostel-2",
    name: "Boys Hostel 2",
    shortLabel: "Boys Hostel 2",
    type: "hostel",
    x: 8,
    y: 68, // TODO: verify position
    description: "Boys hostel block 2.",
    aliases: ["boys hostel 2", "boys hostel", "hostel"],
  },
  {
    id: "girls-hostel",
    name: "Girls Hostel",
    shortLabel: "Girls Hostel",
    type: "hostel",
    x: 14,
    y: 60, // TODO: verify position
    description: "Girls hostel block.",
    aliases: ["girls hostel", "hostel"],
  },

  // ── Gates ─────────────────────────────────────────────────────────────────
  {
    id: "gate-5",
    name: "Gate 5",
    shortLabel: "Gate 5",
    type: "gate",
    x: 95,
    y: 50, // TODO: verify position
    description: "Gate 5 campus entrance near A Block.",
    aliases: ["gate 5", "entrance 5"],
  },
];

/**
 * Rank a place against a lowercased query. Higher = better; 0 = no match.
 * Matches name, shortLabel, type + type label, description, and aliases, with
 * a prefix/exact bias so "gate 1" ranks Gate 1 above other gates.
 */
function scorePlace(place: CampusPlace, q: string): number {
  const haystacks: Array<[string, number]> = [
    [place.name.toLowerCase(), 5],
    [place.shortLabel.toLowerCase(), 4],
    [place.type, 2],
    [PLACE_TYPE_META[place.type].label.toLowerCase(), 2],
    [place.description.toLowerCase(), 1],
    ...place.aliases.map((a): [string, number] => [a.toLowerCase(), 3]),
  ];
  let best = 0;
  for (const [text, weight] of haystacks) {
    if (text === q) best = Math.max(best, weight + 10);
    else if (text.startsWith(q)) best = Math.max(best, weight + 4);
    else if (text.includes(q)) best = Math.max(best, weight);
  }
  return best;
}

/**
 * Filter + rank places by a free-text query. Empty/whitespace query returns
 * the full list in source order. Used by the search box and the results list.
 */
export function searchPlaces(
  query: string,
  places: CampusPlace[] = CAMPUS_MAP_PLACES
): CampusPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return places;
  return places
    .map((p) => ({ p, score: scorePlace(p, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.p);
}

/**
 * Resolve a place ID, exact name, or alias to its `CampusPlace` — used both to
 * turn a Sports post's free-text `place` into a map deep link (Discover →
 * Map) and to read that link back (`?place=` → the matching pin). Returns
 * null rather than falling back to a fuzzy search: an unrecognized custom
 * spot name should have no map link, not a misleading nearest match.
 */
export function resolvePlace(query: string | null | undefined): CampusPlace | null {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return null;
  return (
    CAMPUS_MAP_PLACES.find((p) => p.id === q) ??
    CAMPUS_MAP_PLACES.find((p) => p.name.toLowerCase() === q) ??
    CAMPUS_MAP_PLACES.find((p) => p.aliases.some((a) => a.toLowerCase() === q)) ??
    null
  );
}
