import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messageRequestError } from "@/lib/chat/message-request";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Code only — these files explain at length what they deliberately do NOT do,
 *  and an assertion that reads the prose passes on the explanation. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const MIGRATION = read("supabase/migrations/0196_disable_message_requests.sql");
/** The migration's STATEMENTS, without its prose. The header explains at length
 *  what the setting deliberately does not touch, naming those very functions —
 *  an assertion over the raw file would match the explanation. */
const MIGRATION_SQL = MIGRATION.replace(/^\s*--.*$/gm, "");
/** 0197 — the same rule at the TABLE, closing the direct-insert path. */
const POLICY_MIGRATION = read(
  "supabase/migrations/0197_message_request_insert_policy.sql"
);
const PROFILE = code("src/app/(student)/profile/[id]/page.tsx");
const PRIVACY_UI = code("src/components/settings/privacy-settings.tsx");
const PRIVACY_ACTIONS = code("src/app/(student)/settings/privacy-actions.ts");
const PRIVACY_PAGE = code("src/app/(student)/settings/privacy/page.tsx");

const COLUMN = "disable_message_requests";

/**
 * "Disable message requests", asserted on both sides of the boundary.
 *
 * vitest here runs pure logic with no DOM and no database (see
 * vitest.config.ts). The behavioural half — that the RPC actually refuses, that
 * only the owner can set it, that nothing else broke — is
 * `supabase/tests/disable_message_requests.sql`. What these cover is the pure
 * error mapping, and the wiring that a refactor would quietly get wrong.
 */
describe("the column defaults to OFF", () => {
  it("is added not-null with a false default, which backfills too", () => {
    expect(MIGRATION).toContain(
      `add column if not exists ${COLUMN} boolean not null default false`
    );
  });

  it("needs no separate backfill statement, and has none", () => {
    // `not null default false` rewrites every existing row as the column is
    // added. A separate UPDATE would be a second thing to get wrong.
    expect(MIGRATION).not.toMatch(/update public\.profiles\s+set disable_message_requests/i);
  });

  it("reads as OFF in the UI when the value is missing", () => {
    // Every neighbouring flag falls back to TRUE because they are positive
    // permissions; this one is inverted, so its fallback must be false or a
    // profile read before the migration would look opted-out.
    expect(PRIVACY_PAGE).toContain(`${COLUMN}: p?.${COLUMN} ?? false`);
  });

  it("fails OPEN on the profile, so a narrowed select cannot hide the button", () => {
    expect(PROFILE).toContain(`profile.${COLUMN} !== true`);
  });
});

describe("enforcement is in the database, not the button", () => {
  it("checks the setting inside send_message_request", () => {
    expect(MIGRATION).toContain(
      "create or replace function public.send_message_request"
    );
    expect(MIGRATION).toContain("if v_disabled then");
  });

  it("checks it AGAIN as a predicate on the insert, for the race", () => {
    // A read-then-write pair can be overtaken between its halves by the
    // recipient toggling the setting. The conditional insert cannot.
    expect(MIGRATION).toContain("insert into public.message_requests");
    expect(MIGRATION).toMatch(
      /where exists \(\s*select 1 from public\.profiles p\s*where p\.id = p_recipient\s*and p\.disable_message_requests = false/
    );
  });

  it("raises a recognisable, mappable error", () => {
    expect(MIGRATION).toContain("that person is not accepting message requests");
  });

  it("keeps every other rule, in the same order", () => {
    for (const rule of [
      "not authenticated",
      "you cannot send a request to yourself",
      "message must be 1-250 characters",
      "that account is not available",
      "public.is_blocked(uid, p_recipient)",
      "is_banned = false",
      "deactivated_at is null",
      "on conflict (sender_id, recipient_id) where status = 'pending'",
    ]) {
      expect(MIGRATION).toContain(rule);
    }
  });

  it("returns an EXISTING request before consulting the setting", () => {
    // A pending request is not a new one, so a recipient who closes their door
    // afterwards must not retroactively break the sender's retry.
    const body = MIGRATION.slice(
      MIGRATION.indexOf("create or replace function public.send_message_request")
    );
    const idempotent = body.indexOf("if v_id is not null then");
    const check = body.indexOf("if v_disabled then");
    expect(idempotent).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(idempotent);
  });

  it("adds no second policy on PROFILES to keep in step with the first", () => {
    // The existing `id = auth.uid()` UPDATE policy already scopes this column
    // to its owner; a second one would only be a second thing to drift.
    expect(MIGRATION_SQL).not.toMatch(/create policy .* on public\.profiles/i);
  });

  /**
   * THE BYPASS 0196 LEFT OPEN, closed by 0197.
   *
   * `message_requests` has carried a client INSERT policy since mig 0004, so
   * "the RPC is the only way a row gets in" was true of the app and false of
   * the database: an authenticated student could POST straight to PostgREST.
   * Found by reading the deployed policies rather than the call sites.
   */
  it("also enforces the setting at the table, not only in the function", () => {
    expect(POLICY_MIGRATION).toContain(
      "and public.accepts_message_requests(recipient_id)"
    );
    expect(POLICY_MIGRATION).toContain(
      'create policy "users send their own requests"'
    );
  });

  it("keeps the conjuncts the policy already had", () => {
    expect(POLICY_MIGRATION).toContain("sender_id = (select auth.uid())");
    expect(POLICY_MIGRATION).toContain(
      "not public.is_blocked(sender_id, recipient_id)"
    );
  });

  it("reads the flag through a definer helper, not a caller-scoped subquery", () => {
    // Inside a policy a plain subquery runs under the CALLER's RLS and returns
    // NULL for a profile they cannot read — and `not null` is null, which fails
    // the check for the wrong reason and blocks legitimate requests.
    expect(POLICY_MIGRATION).toContain("security definer");
    expect(POLICY_MIGRATION).toContain(
      "create or replace function public.accepts_message_requests"
    );
    expect(POLICY_MIGRATION).toContain("revoke all on function public.accepts_message_requests(uuid) from public, anon");
  });
});

describe("the profile button", () => {
  it("selects the column it decides on", () => {
    expect(PROFILE).toContain(COLUMN);
  });

  it("renders the button only when the target accepts requests", () => {
    expect(PROFILE).toContain("acceptsRequests ? (");
    expect(PROFILE).toContain("<RequestToChatButton");
  });

  it("renders NOTHING when they do not — no placeholder, no gap", () => {
    // A flex row with gap-2 only spaces children that exist, so returning null
    // leaves no hole. An empty <div/> or a disabled button would.
    expect(PROFILE).toContain(") : null}");
    expect(PROFILE).not.toContain("Requests disabled");
  });

  it("still shows nothing of the sort on your own profile", () => {
    // isSelf is tested FIRST in the chain, so the new branch cannot reach it.
    const chain = PROFILE.slice(PROFILE.indexOf("{isSelf ? ("));
    expect(chain.indexOf("isSelf")).toBeLessThan(chain.indexOf("acceptsRequests"));
  });

  it("leaves the matched and blocked branches exactly as they were", () => {
    expect(PROFILE).toContain("<OpenChatButton otherId={profile.id} />");
    expect(PROFILE).toContain("iBlocked ? (");
  });
});

describe("the stale-profile case", () => {
  it("maps the database's refusal onto the copy the brief asks for", () => {
    expect(
      messageRequestError("that person is not accepting message requests")
    ).toBe("This person isn’t accepting message requests.");
  });

  it("matches the sentence the migration actually raises", () => {
    const raised = MIGRATION.includes(
      "that person is not accepting message requests"
    );
    expect(raised).toBe(true);
    // ...and the mapper keys off that sentence, not off a code it never sees.
    expect(
      messageRequestError("ERROR: that person is not accepting message requests")
    ).toContain("isn’t accepting");
  });

  it("does not collapse into the deliberately-vague block message", () => {
    // A block and a ban share "that account is not available" so neither side
    // can probe the other's block list. This is a different thing and says so.
    expect(messageRequestError("that account is not available")).toBe(
      "That account is not available."
    );
    expect(
      messageRequestError("that person is not accepting message requests")
    ).not.toBe("That account is not available.");
  });

  it("leaves every other mapping alone", () => {
    expect(messageRequestError("message must be 1-250 characters")).toContain("250");
    expect(messageRequestError("you cannot send a request to yourself")).toContain(
      "yourself"
    );
    expect(messageRequestError("not authenticated")).toContain("Sign in");
    expect(messageRequestError(null)).toContain("try again");
  });
});

describe("the privacy toggle", () => {
  it("is allow-listed, so the action will actually write it", () => {
    expect(PRIVACY_ACTIONS).toContain(`"${COLUMN}"`);
  });

  it("rejects a key that is not on the list", () => {
    expect(PRIVACY_ACTIONS).toContain("Unknown privacy setting.");
  });

  it("writes only the caller's own row", () => {
    expect(PRIVACY_ACTIONS).toContain(".eq(\"id\", userId)");
    expect(PRIVACY_ACTIONS).not.toContain("targetId");
  });

  it("carries the exact label and supporting text", () => {
    expect(PRIVACY_UI).toContain('label: "Disable message requests"');
    expect(PRIVACY_UI).toContain(
      "Prevent people you haven’t matched with from requesting a chat."
    );
  });

  it("loads and saves the real database value", () => {
    expect(PRIVACY_PAGE).toContain(COLUMN);
    expect(PRIVACY_UI).toContain("setPrivacy(key, next)");
  });

  it("revalidates the profile so the button appears or disappears", () => {
    expect(PRIVACY_ACTIONS).toContain(`if (key === "${COLUMN}")`);
    expect(PRIVACY_ACTIONS).toContain("revalidatePath(`/profile/${userId}`)");
  });
});

describe("the toggle's optimistic write is reversible", () => {
  it("captures the previous value and restores it on failure", () => {
    expect(PRIVACY_UI).toContain("const previous = prefs[key]");
    expect(PRIVACY_UI).toContain("setPrefs((p) => ({ ...p, [key]: previous }))");
  });

  it("treats an action that returns an error as a failure, not a success", () => {
    expect(PRIVACY_UI).toContain("if (res?.error) throw new Error(res.error)");
  });

  it("says so, in place, rather than failing silently", () => {
    expect(PRIVACY_UI).toContain("Couldn&apos;t save that — try again.");
    expect(PRIVACY_UI).toContain('aria-live="polite"');
  });

  it("shows a saving state while the write is in flight", () => {
    expect(PRIVACY_UI).toContain("Saving…");
    expect(PRIVACY_UI).toContain("busy={Boolean(saving[it.key])}");
  });

  it("rolls the visibility picker back too", () => {
    expect(PRIVACY_UI).toContain("setVisibility(previous)");
  });
});

describe("accessibility is preserved", () => {
  it("keeps the switch role, state and name", () => {
    expect(PRIVACY_UI).toContain('role="switch"');
    expect(PRIVACY_UI).toContain("aria-checked={on}");
    expect(PRIVACY_UI).toContain("aria-label={label}");
  });

  it("is a real button, so it is keyboard-operable", () => {
    expect(PRIVACY_UI).toContain('type="button"');
    expect(PRIVACY_UI).toContain("focus-visible:ring");
  });

  it("announces the in-flight state instead of only spinning", () => {
    expect(PRIVACY_UI).toContain("aria-busy={busy}");
    expect(PRIVACY_UI).toContain("disabled={busy}");
  });
});

describe("the blast radius", () => {
  it("touches no other messaging surface", () => {
    for (const rel of [
      "src/components/communities/community-chat.tsx",
      "src/components/events/event-discussion.tsx",
      "src/components/chat/chat-thread.tsx",
    ]) {
      expect(code(rel)).not.toContain(COLUMN);
    }
  });

  it("does not touch conversation creation or message sending in SQL", () => {
    expect(MIGRATION_SQL).not.toContain("get_or_create_conversation");
    expect(MIGRATION_SQL).not.toContain("accept_message_request");
    expect(MIGRATION_SQL).not.toContain("community_chat_messages");
    expect(MIGRATION_SQL).not.toContain("event_messages");
  });

  it("only ever ADDS — no drop, no destructive rewrite", () => {
    expect(MIGRATION_SQL).toContain("alter table public.profiles");
    expect(MIGRATION_SQL).toContain("create or replace function");
    expect(MIGRATION_SQL).not.toMatch(/drop table/i);
    expect(MIGRATION_SQL).not.toMatch(/drop column/i);
    expect(MIGRATION_SQL).not.toMatch(/delete from/i);
  });
});
