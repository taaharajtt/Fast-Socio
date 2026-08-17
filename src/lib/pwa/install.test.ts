import { afterEach, describe, expect, it, vi } from "vitest";
import {
  androidBrowserHandoffUrl,
  getIOSBrowser,
  isAndroid,
  isIOS,
  isIOSInAppBrowser,
  isInAppBrowser,
  isStandalone,
  noPromptBrowser,
} from "./install";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPADOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const INSTAGRAM_IOS = `${IPHONE} Instagram 300.0.0.0`;
// Instagram's ANDROID webview. This is the string that matters most: it is how
// the majority of new users arrive, and nothing in the app used to detect it.
const INSTAGRAM_ANDROID = `${ANDROID} Instagram 300.0.0.0 Android (34/14; 440dpi; 1080x2210)`;
const FACEBOOK_ANDROID = `${ANDROID} [FB_IAB/FB4A;FBAV/440.0.0.0;]`;

/**
 * Stub the UA + touch points the detectors read. `window` must be stubbed too:
 * vitest runs in the Node environment, and every detector short-circuits to
 * false when `window` is undefined (the SSR guard).
 */
function stubDevice(ua: string, maxTouchPoints = 0) {
  vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

describe("isInAppBrowser", () => {
  // The whole point of generalising this: an Android Instagram arrival can
  // neither fire beforeinstallprompt nor add to the home screen, and it used to
  // be invisible to the app because the only webview check sat behind isIOS().
  it("detects the Instagram webview on Android", () => {
    stubDevice(INSTAGRAM_ANDROID, 5);
    expect(isInAppBrowser()).toBe(true);
  });

  it("detects the Instagram webview on iOS", () => {
    stubDevice(INSTAGRAM_IOS, 5);
    expect(isInAppBrowser()).toBe(true);
  });

  it("detects the Facebook webview", () => {
    stubDevice(FACEBOOK_ANDROID, 5);
    expect(isInAppBrowser()).toBe(true);
  });

  it("leaves real Chrome on Android alone", () => {
    stubDevice(ANDROID, 5);
    expect(isInAppBrowser()).toBe(false);
  });

  it("leaves real Safari alone", () => {
    stubDevice(IPHONE, 5);
    expect(isInAppBrowser()).toBe(false);
  });
});

describe("isAndroid", () => {
  it("detects Android", () => {
    stubDevice(ANDROID, 5);
    expect(isAndroid()).toBe(true);
  });

  it("is false on iOS", () => {
    stubDevice(IPHONE, 5);
    expect(isAndroid()).toBe(false);
  });
});

describe("androidBrowserHandoffUrl", () => {
  // The intent URL must never be steerable by anything a link author controls,
  // or it becomes a way to launch an arbitrary site out of the webview. It is
  // built from the build-time origin and always targets the root.
  it("targets the configured origin root and nothing else", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://fastsocio.online");
    stubDevice(ANDROID, 5);
    const url = androidBrowserHandoffUrl();
    expect(url).toBe(
      "intent://fastsocio.online/#Intent;scheme=https;package=com.android.chrome;" +
        "S.browser_fallback_url=https%3A%2F%2Ffastsocio.online%2F;end"
    );
  });

  it("refuses a non-https origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    stubDevice(ANDROID, 5);
    expect(androidBrowserHandoffUrl()).toBeNull();
  });

  it("returns null when no origin is configured, so the UI falls back to steps", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    stubDevice(ANDROID, 5);
    expect(androidBrowserHandoffUrl()).toBeNull();
  });
});

describe("getIOSBrowser", () => {
  // The instructions branch on this. Getting it wrong means telling a Chrome
  // user to look in a Safari toolbar that isn't there — the exact bug this
  // replaced.
  const CHROME_IOS = `${IPHONE.replace("Version/17.0", "CriOS/120.0.0.0")}`;
  const EDGE_IOS = `${IPHONE.replace("Version/17.0", "EdgiOS/120.0.0.0")}`;
  const FIREFOX_IOS = `${IPHONE.replace("Version/17.0", "FxiOS/120.0")}`;

  it("detects Safari", () => {
    stubDevice(IPHONE, 5);
    expect(getIOSBrowser()).toBe("safari");
  });

  it("detects Chrome, which also carries Safari in its UA", () => {
    stubDevice(CHROME_IOS, 5);
    expect(getIOSBrowser()).toBe("chrome");
  });

  it("detects Edge", () => {
    stubDevice(EDGE_IOS, 5);
    expect(getIOSBrowser()).toBe("edge");
  });

  it("detects Firefox", () => {
    stubDevice(FIREFOX_IOS, 5);
    expect(getIOSBrowser()).toBe("firefox");
  });
});

describe("noPromptBrowser", () => {
  const FIREFOX_ANDROID =
    "Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0";
  const SAFARI_MAC = MAC.replace(
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
  );

  it("names Firefox on Android, which never fires the event", () => {
    stubDevice(FIREFOX_ANDROID, 5);
    expect(noPromptBrowser()).toBe("firefox-android");
  });

  it("names desktop Safari", () => {
    stubDevice(SAFARI_MAC, 0);
    expect(noPromptBrowser()).toBe("safari-desktop");
  });

  // The critical negatives. Answering for these would replace a working
  // one-tap Install button with instructions about menus, and would show
  // "install me" to someone who already installed the app (Chromium does not
  // re-fire the event once installed).
  it("stays silent for Chrome on Android — the event may still be coming", () => {
    stubDevice(ANDROID, 5);
    expect(noPromptBrowser()).toBeNull();
  });

  it("stays silent for Chrome on macOS despite Safari in the UA", () => {
    stubDevice(MAC, 0);
    expect(noPromptBrowser()).toBeNull();
  });

  it("stays silent on iOS, which has its own richer path", () => {
    stubDevice(IPHONE, 5);
    expect(noPromptBrowser()).toBeNull();
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
