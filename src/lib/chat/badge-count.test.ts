import { describe, expect, it } from "vitest";
import { fetchChatBadge } from "./badge-count";

/**
 * The product rule under test: Chat badge = unread CONVERSATIONS + pending
 * message requests, never unread messages. Three lines in one thread is one
 * place to go.
 *
 * Both paths are exercised, because the two must agree. The RPC path is what
 * runs against a migrated database; the fallback path is what runs when the
 * RPC is missing or pre-0169, and a badge that changed meaning depending on
 * which path answered would be worse than either meaning.
 */

const ME = "me";

type UnreadRow = { conversation_id: string | null };

/** Minimal PostgREST double: enough of the builder chain for this helper. */
function makeClient(opts: {
  rpc?: () => { data: unknown; error: unknown };
  unread?: UnreadRow[];
  requests?: number;
  throwOnQuery?: boolean;
}) {
  return {
    rpc: async () =>
      opts.rpc ? opts.rpc() : { data: null, error: { message: "missing" } },
    from(table: string) {
      if (opts.throwOnQuery) throw new Error("network");
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of ["select", "neq", "is", "eq", "limit"]) {
        builder[method] = chain;
      }
      // Awaiting the builder resolves it, which is how postgrest-js behaves.
      builder.then = (resolve: (v: unknown) => void) =>
        resolve(
          table === "messages"
            ? { data: opts.unread ?? [], error: null }
            : { count: opts.requests ?? 0, error: null }
        );
      return builder;
    },
  } as never;
}

describe("fetchChatBadge — RPC path", () => {
  it("counts conversations, not messages", async () => {
    // Three unread messages in ONE conversation.
    const badge = await fetchChatBadge(
      makeClient({
        rpc: () => ({
          data: { conversations: 1, unread: 1, requests: 0 },
          error: null,
        }),
      }),
      ME
    );
    expect(badge.conversations).toBe(1);
    expect(badge.total).toBe(1);
  });

  it("counts three separate conversations as three", async () => {
    const badge = await fetchChatBadge(
      makeClient({
        rpc: () => ({
          data: { conversations: 3, unread: 3, requests: 0 },
          error: null,
        }),
      }),
      ME
    );
    expect(badge.total).toBe(3);
  });

  it("adds pending message requests to the conversation count", async () => {
    const badge = await fetchChatBadge(
      makeClient({
        rpc: () => ({ data: { conversations: 2, requests: 3 }, error: null }),
      }),
      ME
    );
    expect(badge).toMatchObject({ conversations: 2, requests: 3, total: 5 });
  });

  it("refuses a pre-0169 result and recomputes instead of trusting `unread`", async () => {
    // 0166 answered with a MESSAGE count and no `conversations` key. Trusting
    // it would render 7 for what is really two threads.
    const badge = await fetchChatBadge(
      makeClient({
        rpc: () => ({ data: { unread: 7, requests: 0 }, error: null }),
        unread: [{ conversation_id: "a" }, { conversation_id: "b" }],
        requests: 0,
      }),
      ME
    );
    expect(badge.total).toBe(2);
  });
});

describe("fetchChatBadge — fallback path", () => {
  it("collapses many unread messages in one thread to one", async () => {
    const badge = await fetchChatBadge(
      makeClient({
        unread: [
          { conversation_id: "c1" },
          { conversation_id: "c1" },
          { conversation_id: "c1" },
        ],
        requests: 0,
      }),
      ME
    );
    expect(badge.conversations).toBe(1);
    expect(badge.total).toBe(1);
  });

  it("counts one unread message in each of three threads as three", async () => {
    const badge = await fetchChatBadge(
      makeClient({
        unread: [
          { conversation_id: "c1" },
          { conversation_id: "c2" },
          { conversation_id: "c3" },
        ],
        requests: 0,
      }),
      ME
    );
    expect(badge.total).toBe(3);
  });

  it("agrees with the RPC path on the same underlying state", async () => {
    const rows = [
      { conversation_id: "c1" },
      { conversation_id: "c1" },
      { conversation_id: "c2" },
    ];
    const viaRpc = await fetchChatBadge(
      makeClient({
        rpc: () => ({ data: { conversations: 2, requests: 1 }, error: null }),
      }),
      ME
    );
    const viaFallback = await fetchChatBadge(
      makeClient({ unread: rows, requests: 1 }),
      ME
    );
    expect(viaFallback.total).toBe(viaRpc.total);
  });

  it("still adds pending requests", async () => {
    const badge = await fetchChatBadge(
      makeClient({ unread: [{ conversation_id: "c1" }], requests: 2 }),
      ME
    );
    expect(badge.total).toBe(3);
  });

  it("ignores rows with no conversation id", async () => {
    const badge = await fetchChatBadge(
      makeClient({ unread: [{ conversation_id: null }], requests: 0 }),
      ME
    );
    expect(badge.total).toBe(0);
  });

  it("fails to zero rather than throwing — a badge must not break the shell", async () => {
    const badge = await fetchChatBadge(makeClient({ throwOnQuery: true }), ME);
    expect(badge).toEqual({ conversations: 0, requests: 0, total: 0 });
  });
});
