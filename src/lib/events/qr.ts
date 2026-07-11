import "server-only";
import QRCode from "qrcode";

/**
 * Render a check-in code as a QR PNG data URL (Refactor Phase 6). Generated on
 * the server so the qrcode lib never ships to the client; the data: URI is
 * allowed by our img-src CSP. Returns null if encoding fails so the ticket can
 * fall back to the plain code.
 */
export async function checkInQrDataUrl(code: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(code, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0b10", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}
