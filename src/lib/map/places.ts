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
  | "hangout";

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
