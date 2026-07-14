const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const BG = { r: 10, g: 11, b: 16, alpha: 1 }; // #0A0B10 — brand background
const SRC = "public/icons/icon-512.png";
const OUT = "public/splash";
fs.mkdirSync(OUT, { recursive: true });

// Portrait iOS devices: [cssW, cssH, dpr]. Manifest orientation is portrait,
// so we only need portrait splash images.
const devices = [
  [320, 568, 2], // iPhone SE (1st)
  [375, 667, 2], // iPhone 8 / SE 2/3
  [414, 736, 3], // iPhone 8 Plus
  [375, 812, 3], // iPhone X/XS/11 Pro/12 mini/13 mini
  [414, 896, 2], // iPhone XR / 11
  [414, 896, 3], // iPhone XS Max / 11 Pro Max
  [390, 844, 3], // iPhone 12/13/14
  [428, 926, 3], // iPhone 12/13 Pro Max, 14 Plus
  [393, 852, 3], // iPhone 14 Pro / 15 / 16
  [430, 932, 3], // iPhone 14 Pro Max / 15 Plus / 16 Plus
  [402, 874, 3], // iPhone 16 Pro
  [440, 956, 3], // iPhone 16 Pro Max
  [768, 1024, 2], // iPad mini / Air (legacy)
  [810, 1080, 2], // iPad 10.2"
  [820, 1180, 2], // iPad Air 10.9"
  [834, 1112, 2], // iPad Pro 10.5"
  [834, 1194, 2], // iPad Pro 11"
  [1024, 1366, 2], // iPad Pro 12.9"
];

(async () => {
  const links = [];
  for (const [cw, ch, dpr] of devices) {
    const w = cw * dpr;
    const h = ch * dpr;
    // Bolt sized to ~38% of the shorter side, centered.
    const glyph = Math.round(Math.min(w, h) * 0.38);
    const icon = await sharp(SRC)
      .resize(glyph, glyph, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    const file = `apple-splash-${w}-${h}.png`;
    await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
      .composite([{ input: icon, gravity: "center" }])
      .png()
      .toFile(path.join(OUT, file));
    links.push(
      `  { media: "(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)", href: "/splash/${file}" },`
    );
  }
  console.log(`Generated ${devices.length} splash images in ${OUT}`);
  console.log("---LINKS---");
  console.log(links.join("\n"));
})();
