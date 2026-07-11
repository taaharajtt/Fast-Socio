/**
 * Client-only appearance preferences (Refactor Phase 8). Stored in localStorage
 * and applied to <html> — font size as an html font-size (rem scales with it),
 * density + motion as data-attributes consumed by globals.css. Kept out of the
 * DB by design: these are per-device presentation choices.
 */
export const FONT_SIZES = { small: "15px", normal: "16px", large: "18px" } as const;
export type FontSize = keyof typeof FONT_SIZES;

export const APPEARANCE_KEYS = {
  font: "fs-appearance-font",
  density: "fs-appearance-density",
  motion: "fs-appearance-motion",
} as const;

/** Apply saved appearance to <html>. Safe to call on the client only. */
export function applyAppearance(): void {
  const root = document.documentElement;
  const font = (localStorage.getItem(APPEARANCE_KEYS.font) as FontSize) || "normal";
  root.style.fontSize = FONT_SIZES[font] ?? FONT_SIZES.normal;

  const density = localStorage.getItem(APPEARANCE_KEYS.density);
  if (density === "compact") root.dataset.density = "compact";
  else delete root.dataset.density;

  const motion = localStorage.getItem(APPEARANCE_KEYS.motion);
  if (motion === "reduced") root.dataset.motion = "reduced";
  else delete root.dataset.motion;
}

/**
 * Minified inline script (string) that applies appearance before first paint to
 * avoid a flash. Injected in the root layout <head>.
 */
export const APPEARANCE_INIT_SCRIPT = `
(function(){try{
var r=document.documentElement,
f={small:'15px',normal:'16px',large:'18px'},
fs=localStorage.getItem('${APPEARANCE_KEYS.font}')||'normal';
r.style.fontSize=f[fs]||f.normal;
if(localStorage.getItem('${APPEARANCE_KEYS.density}')==='compact')r.dataset.density='compact';
if(localStorage.getItem('${APPEARANCE_KEYS.motion}')==='reduced')r.dataset.motion='reduced';
}catch(e){}})();
`;
