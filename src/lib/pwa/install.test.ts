import { afterEach, describe, expect, it, vi } from "vitest";
import { isIOS, isIOSInAppBrowser, isStandalone } from "./install";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPADOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const INSTAGRAM_IOS = `${IPHONE} Instagram 300.0.0.0`;

/**
 * Stub the UA + touch points the detectors read. `window` must be stubbed too:
 * vitest runs in the Node environment, and every detector short-circuits to
 * false when `window` is undefined (the SSR guard).
 */
function stubDevice(ua: string, maxTouchPoints = 0) {
  vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
}

afterEach(() => vi.unstubAllGlobals());

describe("isIOS", () => {
  it("detects iPhone", () => {
    stubDevice(IPHONE, 5);
    expect(isIOS()).toBe(true);
  });

  // iPadOS 13+ sends a desktop Macintosh UA; touch points are the only tell.
  it("detects iPadOS masquerading as a Mac", () => {
    stubDevice(IPADOS, 5);
    expect(isIOS()).toBe(true);
  });

  it("does not mistake a real Mac for iOS", () => {
    stubDevice(MAC, 0);
    expect(isIOS()).toBe(false);
  });

  it("does not fire on Android", () => {
    stubDevice(ANDROID, 5);
    expect(isIOS()).toBe(false);
  });
});

describe("isIOSInAppBrowser", () => {
  // These webviews cannot Add to Home Screen — showing the steps there would
  // walk the user into a dead end.
  it("detects the Instagram webview", () => {
    stubDevice(INSTAGRAM_IOS, 5);
    expect(isIOSInAppBrowser()).toBe(true);
  });

  it("leaves real Safari alone", () => {
    stubDevice(IPHONE, 5);
    expect(isIOSInAppBrowser()).toBe(false);
  });
});

describe("isStandalone", () => {
  it("is true for an installed iOS app (legacy navigator.standalone)", () => {
    vi.stubGlobal("navigator", { userAgent: IPHONE, standalone: true });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(isStandalone()).toBe(true);
  });

  it("is true for an installed app via display-mode", () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(isStandalone()).toBe(true);
  });

  it("is false in a plain browser tab", () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(isStandalone()).toBe(false);
  });
});
