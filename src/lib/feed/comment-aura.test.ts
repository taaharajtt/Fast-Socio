import { describe, it, expect } from "vitest";
import { createCommentAuraLedger } from "./comment-aura";

// Mirrors migration 0181. AUTHOR owns the post; ALICE and BOB comment on it.
const AUTHOR = "author";
const ALICE = "alice";
const BOB = "bob";
const POST = "post-1";
const OTHER_POST = "post-2";

const authors = { [POST]: AUTHOR, [OTHER_POST]: AUTHOR };

const comment = (id: string, commenterId: string, postId = POST) => ({
  id,
  postId,
  commenterId,
});

describe("comment Aura — awarding", () => {
  it("pays the post author +2 for a commenter's first comment", () => {
    const ledger = createCommentAuraLedger(authors);
    const entries = ledger.addComment(comment("c1", ALICE));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: AUTHOR, delta: 2 });
    expect(ledger.balance(AUTHOR)).toBe(2);
  });

  it("pays nothing extra for further comments from the same person", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));
    ledger.addComment(comment("c2", ALICE));
    ledger.addComment(comment("c3", ALICE));

    expect(ledger.balance(AUTHOR)).toBe(2);
    expect(ledger.entries()).toHaveLength(1);
  });

  it("pays another +2 for a second, distinct commenter", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));
    ledger.addComment(comment("c2", BOB));

    expect(ledger.balance(AUTHOR)).toBe(4);
  });

  it("pays per post, so the same commenter earns once on each post", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE, POST));
    ledger.addComment(comment("c2", ALICE, OTHER_POST));

    expect(ledger.balance(AUTHOR)).toBe(4);
  });

  it("never pays for commenting on your own post", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", AUTHOR));

    expect(ledger.balance(AUTHOR)).toBe(0);
    expect(ledger.grantCount()).toBe(0);
  });

  it("a spam run of 50 comments is still worth exactly 2", () => {
    const ledger = createCommentAuraLedger(authors);
    for (let i = 0; i < 50; i++) ledger.addComment(comment(`c${i}`, ALICE));

    expect(ledger.balance(AUTHOR)).toBe(2);
  });
});

describe("comment Aura — reconciliation on delete", () => {
  it("reverses 2 when the commenter's last comment is deleted", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));

    const entries = ledger.deleteComment("c1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: AUTHOR, delta: -2, reversal: true });
    expect(ledger.balance(AUTHOR)).toBe(0);
    expect(ledger.grantCount()).toBe(0);
  });

  it("does not reverse while another comment from that person remains", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));
    ledger.addComment(comment("c2", ALICE));

    expect(ledger.deleteComment("c1")).toEqual([]);
    expect(ledger.balance(AUTHOR)).toBe(2);

    // ...and reverses once the final one goes.
    ledger.deleteComment("c2");
    expect(ledger.balance(AUTHOR)).toBe(0);
  });

  it("spam-then-delete nets to zero, never negative", () => {
    const ledger = createCommentAuraLedger(authors);
    const ids = Array.from({ length: 30 }, (_, i) => `c${i}`);
    ids.forEach((id) => ledger.addComment(comment(id, ALICE)));
    ids.forEach((id) => ledger.deleteComment(id));

    expect(ledger.balance(AUTHOR)).toBe(0);
  });

  it("only reverses the deleted commenter's grant", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));
    ledger.addComment(comment("c2", BOB));

    ledger.deleteComment("c1");
    expect(ledger.balance(AUTHOR)).toBe(2);
  });

  it("a repeated / retried delete of the same comment debits once", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));

    ledger.deleteComment("c1");
    expect(ledger.deleteComment("c1")).toEqual([]);
    expect(ledger.deleteComment("c1")).toEqual([]);
    expect(ledger.balance(AUTHOR)).toBe(0);
  });

  it("re-commenting after a full reversal earns again, exactly once", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));
    ledger.deleteComment("c1");
    ledger.addComment(comment("c2", ALICE));
    ledger.addComment(comment("c3", ALICE));

    expect(ledger.balance(AUTHOR)).toBe(2);
  });

  it("deleting the post reverses every active comment reward", () => {
    // This asserted the OPPOSITE until migration 0187. 0181 deliberately did
    // nothing when the post was already gone, so an author could collect Aura
    // from a well-commented post and then delete it, keeping the Aura for
    // comments that no longer existed. The reversal now happens BEFORE the
    // comments disappear, which is the only point at which the pairs to debit
    // are still readable.
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));
    ledger.addComment(comment("c2", BOB));
    expect(ledger.balance(AUTHOR)).toBe(4);

    const reversals = ledger.deletePost(POST);
    expect(reversals).toHaveLength(2);
    expect(reversals.every((e) => e.delta === -2 && e.reversal)).toBe(true);
    expect(ledger.balance(AUTHOR)).toBe(0);
    expect(ledger.grantCount()).toBe(0);
  });

  it("the cascaded comment deletes that follow debit nothing further", () => {
    // aura_reverse is a no-op on an already-reversed source, so the comment
    // cascade arriving after the post trigger cannot debit a second time.
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));
    ledger.addComment(comment("c2", BOB));
    ledger.deletePost(POST);
    const after = ledger.balance(AUTHOR);

    ledger.deleteComment("c1");
    ledger.deleteComment("c2");
    expect(ledger.balance(AUTHOR)).toBe(after);
    expect(ledger.balance(AUTHOR)).toBe(0);
  });

  it("a create/comment/delete loop nets to zero however many times it runs", () => {
    const ledger = createCommentAuraLedger(authors);
    for (let i = 0; i < 5; i++) {
      ledger.addComment(comment(`a${i}`, ALICE));
      ledger.addComment(comment(`b${i}`, BOB));
      ledger.deletePost(POST);
    }
    expect(ledger.balance(AUTHOR)).toBe(0);
    expect(ledger.grantCount()).toBe(0);
  });
});

describe("comment Aura — concurrency", () => {
  it("concurrent first comments from one person credit only once", () => {
    const ledger = createCommentAuraLedger(authors);
    // Two requests that both believe they are the first: the PK conflict in
    // `award_comment_aura()` lets exactly one of them pay.
    const a = ledger.addComment(comment("c1", ALICE));
    const b = ledger.addComment(comment("c2", ALICE));

    expect(a.length + b.length).toBe(1);
    expect(ledger.balance(AUTHOR)).toBe(2);
  });

  it("interleaved deletes of the last two comments debit only once", () => {
    const ledger = createCommentAuraLedger(authors);
    ledger.addComment(comment("c1", ALICE));
    ledger.addComment(comment("c2", ALICE));

    const a = ledger.deleteComment("c1");
    const b = ledger.deleteComment("c2");

    expect(a.length + b.length).toBe(1);
    expect(ledger.balance(AUTHOR)).toBe(0);
  });
});
