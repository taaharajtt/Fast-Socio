import { describe, expect, it } from "vitest";
import { pickHelpPreview, type HelpPreviewable } from "./preview";

const row = (
  id: string,
  urgency: HelpPreviewable["urgency"],
  created_at: string,
  is_mine = false
): HelpPreviewable & { id: string } => ({ id, urgency, created_at, is_mine });

describe("pickHelpPreview (Home Campus Help strip)", () => {
  it("puts urgent asks first, then newest", () => {
    const rows = [
      row("old-normal", "normal", "2026-07-01T00:00:00Z"),
      row("new-normal", "normal", "2026-07-20T00:00:00Z"),
      row("old-urgent", "urgent", "2026-07-02T00:00:00Z"),
      row("new-urgent", "urgent", "2026-07-19T00:00:00Z"),
    ];
    const picked = pickHelpPreview(rows, 10).map((r) => r.id);
    // Urgent block first (newest urgent before older urgent), then normals.
    expect(picked).toEqual([
      "new-urgent",
      "old-urgent",
      "new-normal",
      "old-normal",
    ]);
  });

  it("never includes your own asks (privacy: the strip is discovery, not ME)", () => {
    const rows = [
      row("mine", "urgent", "2026-07-20T00:00:00Z", true),
      row("theirs", "normal", "2026-07-01T00:00:00Z", false),
    ];
    const picked = pickHelpPreview(rows, 10).map((r) => r.id);
    expect(picked).toEqual(["theirs"]);
  });

  it("caps the preview to the requested limit (default 3)", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(`r${i}`, "normal", `2026-07-${10 + i}T00:00:00Z`)
    );
    expect(pickHelpPreview(rows)).toHaveLength(3);
    expect(pickHelpPreview(rows, 2)).toHaveLength(2);
  });

  it("returns an empty array when there is nothing to show", () => {
    expect(pickHelpPreview([])).toEqual([]);
    // Only your own asks → nothing for others to discover.
    expect(
      pickHelpPreview([row("mine", "urgent", "2026-07-20T00:00:00Z", true)])
    ).toEqual([]);
  });
});
