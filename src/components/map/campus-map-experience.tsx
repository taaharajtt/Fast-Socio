"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { SegmentedPills, type PillOption } from "@/components/ui/segmented-pills";
import { CampusMapViewer } from "@/components/map/campus-map-viewer";
import {
  CAMPUS_MAP_PLACES,
  PLACE_TYPE_META,
  searchPlaces,
  type CampusPlace,
  type PlaceType,
} from "@/lib/map/places";

type Filter = "all" | PlaceType;

// Filter order chosen to match the product brief (All · Buildings · Cafes · …).
const FILTER_ORDER: PlaceType[] = [
  "building",
  "cafe",
  "sports",
  "gate",
  "parking",
  "library",
  "prayer",
  "hangout",
];

const FILTER_OPTIONS: PillOption[] = [
  { value: "all", label: "All" },
  ...FILTER_ORDER.map((t) => ({ value: t, label: PLACE_TYPE_META[t].label })),
];

/** Height (px) the detail card occupies — lifts the viewer's zoom controls. */
const DETAIL_INSET = 120;

/**
 * Campus Map v2 experience: the search box, type filters, the pin/zoom viewer,
 * the search-results list, and the place detail card — all client-side. The map
 * itself is a static PNG with an absolutely-positioned pin overlay; no map/GIS
 * library is involved.
 *
 * Selecting a place (from a pin tap or a search result) centers + zooms to it
 * and opens the detail card. Filters narrow both the visible pins and the
 * search results. Zoom-to-fit, pan and the zoom controls are unchanged.
 */
export function CampusMapExperience() {
  const [query, setQuery] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);

  // Type filter feeds both the pins on the map and the search corpus.
  const filteredPlaces = useMemo(
    () =>
      filter === "all"
        ? CAMPUS_MAP_PLACES
        : CAMPUS_MAP_PLACES.filter((p) => p.type === filter),
    [filter]
  );

  const results = useMemo(
    () => searchPlaces(query, filteredPlaces),
    [query, filteredPlaces]
  );

  const selectedPlace = useMemo(
    () => CAMPUS_MAP_PLACES.find((p) => p.id === selectedId) ?? null,
    [selectedId]
  );

  const selectPlace = (id: string) => {
    setSelectedId(id);
    setFocusSignal((n) => n + 1); // re-center even if the id is unchanged
    setResultsOpen(false);
  };

  const clearSearch = () => {
    setQuery("");
    setResultsOpen(false);
  };

  const showResults = resultsOpen && query.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search (functional) + results dropdown. */}
      <div className="relative z-20 shrink-0">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-disabled"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            aria-label="Search places, offices, labs"
            placeholder="Search places, offices, labs…"
            onChange={(e) => {
              setQuery(e.target.value);
              setResultsOpen(true);
            }}
            onFocus={() => setResultsOpen(true)}
            onKeyDown={(e) => e.key === "Escape" && clearSearch()}
            className="glass h-11 w-full rounded-xl pl-9 pr-9 text-[15px] text-fg placeholder:text-fg-disabled outline-none focus:ring-2 focus:ring-accent/30"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-fg-muted hover:bg-white/10 hover:text-fg"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {showResults && (
          <div className="absolute left-0 right-0 top-full mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-card/95 p-1 shadow-xl backdrop-blur">
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-fg-muted">
                No places found
              </p>
            ) : (
              <ul>
                {results.map((place) => (
                  <li key={place.id}>
                    <ResultRow place={place} onSelect={selectPlace} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Type filters. */}
      <SegmentedPills
        className="mt-3 shrink-0"
        options={FILTER_OPTIONS}
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        scrollable
      />

      {/* Map + pins + detail card. */}
      <div className="relative mt-3 min-h-0 flex-1">
        <CampusMapViewer
          className="absolute inset-0"
          places={filteredPlaces}
          selectedId={selectedId}
          onSelectPlace={selectPlace}
          focusSignal={focusSignal}
          controlsBottomInset={selectedPlace ? DETAIL_INSET : 0}
        />
        {selectedPlace && (
          <PlaceDetailCard
            place={selectedPlace}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

function ResultRow({
  place,
  onSelect,
}: {
  place: CampusPlace;
  onSelect: (id: string) => void;
}) {
  const meta = PLACE_TYPE_META[place.type];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      aria-label={`Go to ${place.name}`}
      onClick={() => onSelect(place.id)}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-white/10"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: meta.color }}
      >
        <Icon className="h-4 w-4 text-white" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">
          {place.name}
        </span>
        <span className="block truncate text-xs text-fg-muted">
          {meta.label}
        </span>
      </span>
    </button>
  );
}

function PlaceDetailCard({
  place,
  onClose,
}: {
  place: CampusPlace;
  onClose: () => void;
}) {
  const meta = PLACE_TYPE_META[place.type];
  const Icon = meta.icon;
  return (
    <div
      role="dialog"
      aria-label={`${place.name} details`}
      className="absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-white/10 bg-card/95 p-4 shadow-2xl backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: meta.color }}
        >
          <Icon className="h-5 w-5 text-white" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-fg">{place.name}</h2>
          <p className="text-xs font-medium text-fg-muted">{meta.label}</p>
        </div>
        <button
          type="button"
          aria-label="Close place details"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-white/10 hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{place.description}</p>
    </div>
  );
}
