import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionSeed,
  ensureSessionSeed,
  getSessionSeed,
  newSessionSeed,
  readSeedCookie,
  SEED_COOKIE,
} from "@/lib/discover/session-seed";

/** A minimal in-memory Storage, so no browser or global mock is needed. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

/** A Storage that throws on every access — Safari with site data blocked. */
function hostileStorage(): Storage {
  const boom = () => {
    throw new Error("SecurityError: storage is not available");
  };
  return {
    get length(): number {
      return boom();
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  } as unknown as Storage;
}

describe("session seed lifetime", () => {
  let store: Storage;
  beforeEach(() => {
    store = memoryStorage();
  });

  it("is stable within a session, so pagination cannot duplicate or skip", () => {
    // THE core property. A seed that changed between pages would draw page two
    // from a different permutation than page one — which is exactly why the
    // deck cannot use `order by random()`.
    const first = getSessionSeed(store);
    expect(getSessionSeed(store)).toBe(first);
    expect(getSessionSeed(store)).toBe(first);
  });

  it("differs once the session is gone", () => {
    const first = getSessionSeed(store);
    clearSessionSeed(store);
    expect(getSessionSeed(store)).not.toBe(first);
  });

  it("mints distinct seeds", () => {
    const seeds = new Set(Array.from({ length: 50 }, () => newSessionSeed()));
    expect(seeds.size).toBe(50);
  });

  it("still returns a usable seed when storage throws", () => {
    // Degrades to "reshuffles more often than intended", never to a crash on
    // the Discover route.
    expect(getSessionSeed(hostileStorage())).toBeTruthy();
    expect(ensureSessionSeed("from-cookie", hostileStorage())).toBe("from-cookie");
  });
});

describe("adopting the server's seed", () => {
  it("uses the cookie the server ordered page one with", () => {
    // Page one is server-rendered from the cookie; the client must continue the
    // SAME permutation, or the first refill would re-order candidates the
    // viewer has already seen.
    const store = memoryStorage();
    expect(ensureSessionSeed("server-seed", store)).toBe("server-seed");
  });

  it("keeps that seed for the rest of the session", () => {
    const store = memoryStorage();
    ensureSessionSeed("server-seed", store);
    // Even if a later render somehow supplies the rotated cookie value, the
    // session's own seed wins.
    expect(ensureSessionSeed("a-different-cookie", store)).toBe("server-seed");
  });

  it("mints one when there is no cookie (a first-ever visit)", () => {
    const store = memoryStorage();
    const seed = ensureSessionSeed(null, store);
    expect(seed).toBeTruthy();
    expect(ensureSessionSeed(null, store)).toBe(seed);
  });
});

describe("reading the seed cookie", () => {
  it("finds the seed among other cookies", () => {
    expect(
      readSeedCookie(`theme=dark; ${SEED_COOKIE}=abc123; sb-access-token=xyz`)
    ).toBe("abc123");
  });

  it("decodes an encoded value", () => {
    expect(readSeedCookie(`${SEED_COOKIE}=a%2Fb`)).toBe("a/b");
  });

  it("returns null when absent, empty, or the header is missing", () => {
    expect(readSeedCookie("theme=dark")).toBeNull();
    expect(readSeedCookie(`${SEED_COOKIE}=`)).toBeNull();
    expect(readSeedCookie("")).toBeNull();
    expect(readSeedCookie(null)).toBeNull();
  });

  it("does not match a cookie whose name merely ends with the seed name", () => {
    expect(readSeedCookie(`not_${SEED_COOKIE}=nope`)).toBeNull();
  });
});
