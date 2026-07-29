"use client";

import { useMemo, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import { GlassButton, GlassInput } from "@/components/ui";
import { GlassSheet } from "@/components/ui/glass-sheet";
import { CampusMapViewer } from "@/components/map/campus-map-viewer";
import { resolvePlace, searchPlaces } from "@/lib/map/places";
import { cn } from "@/lib/utils";

/** What LocationPicker hands back — a known campus place's id, label, and pin. */
export type PickedPlace = { placeId: string; label: string; x: number; y: number };

/**
 * Reusable "pin a location on the map" field. Selection is restricted to the
 * ~21 known campus places in `lib/map/places.ts` — there is no free-form pin
 * drop, so the label saved is always a real place name and the coordinates
 * always resolve back to a pin on `/map`.
 */
export function LocationPicker({
  value,
  onChange,
  placeholder,
}: {
  value: PickedPlace | null;
  onChange: (next: PickedPlace | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(value?.placeId ?? null);
  const [focusSignal, setFocusSignal] = useState(0);

  const filtered = useMemo(() => searchPlaces(query), [query]);

  function openSheet() {
    setSelectedId(value?.placeId ?? null);
    setQuery("");
    setOpen(true);
  }

  function selectPlace(id: string) {
    setSelectedId(id);
    setFocusSignal((n) => n + 1);
  }

  function confirm() {
    const place = resolvePlace(selectedId);
    if (!place) return;
    onChange({ placeId: place.id, label: place.name, x: place.x, y: place.y });
    setOpen(false);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openSheet}
          className="glass flex h-[52px] w-full items-center gap-2.5 rounded-xl px-4 text-left text-[15px] text-fg outline-none transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-accent/50 focus:ring-2 focus:ring-accent/30"
        >
          <MapPin
            className={cn("h-4 w-4 shrink-0", value ? "text-aura" : "text-fg-disabled")}
            aria-hidden
          />
          <span className={cn("truncate", !value && "text-fg-disabled")}>
            {value?.label ?? placeholder ?? "Pin a location on the map"}
          </span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Clear location"
            className="glass flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl text-fg-muted hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <GlassSheet open={open} onClose={() => setOpen(false)} label="Pin a location">
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Pin a location</h2>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-disabled"
              aria-hidden
            />
            <GlassInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search campus places…"
              className="pl-11"
              data-no-drag
            />
          </div>

          <CampusMapViewer
            className="h-[320px] w-full"
            places={filtered}
            selectedId={selectedId}
            onSelectPlace={selectPlace}
            focusSignal={focusSignal}
          />

          <GlassButton
            type="button"
            size="lg"
            className="w-full"
            disabled={!selectedId}
            onClick={confirm}
          >
            {selectedId ? `Pin ${resolvePlace(selectedId)?.name ?? ""}` : "Select a place"}
          </GlassButton>
        </div>
      </GlassSheet>
    </>
  );
}
