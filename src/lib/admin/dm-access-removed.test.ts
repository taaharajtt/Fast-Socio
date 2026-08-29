import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards against the unrestricted DM access paths coming back.
 *
 * These are source-level assertions, not behavioural ones — vitest here runs
 * pure logic with no database (see vitest.config.ts). They cannot prove the
 * live database refuses a call; supabase/tests/dm_reporting_verification.sql
 * does that. What they *can* do is fail the build the moment someone reintroduces
 * a transcript viewer, a DM tab, or a call to a dropped RPC, which is the
 * regression this work most needs to be protected from: every path removed here
 * was originally added in good faith by someone who needed to see a message.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Every .ts/.tsx file under src/, excluding this test itself. */
const SOURCES = walk("src").filter((f) => !f.endsWith("dm-access-removed.test.ts"));

describe("the dropped DM RPCs have no callers", () => {
  for (const rpc of ["admin_dm_conversations", "admin_dm_messages"]) {
    it(`nothing calls ${rpc}`, () => {
      const callers = SOURCES.filter((f) => read(f).includes(rpc));
      expect(callers).toEqual([]);
    });
  }
});

describe("the admin transcript surface is gone", () => {
  it("has no DM transcript route", () => {
    expect(existsSync(join(ROOT, "src/app/admin/content/dm"))).toBe(false);
  });

  it("has no transcript message row component", () => {
    expect(existsSync(join(ROOT, "src/components/admin/dm-message-row.tsx"))).toBe(
      false,
    );
  });

  it("the content browser offers neither a DMs nor a Messages tab", () => {
    const page = read("src/app/admin/content/page.tsx");
    // The tab list is the thing under test; match the literal tab entries
    // rather than the words, which appear in the explanatory comment.
    expect(page).not.toMatch(/key:\s*"dm"/);
    expect(page).not.toMatch(/key:\s*"message"/);
    expect(page).toMatch(/key:\s*"post"/);
    expect(page).toMatch(/key:\s*"community"/);
  });

  it("the content ContentType union excludes one-to-one messages", () => {
    const actions = read("src/app/admin/content/actions.ts");
    expect(actions).toMatch(
      /export type ContentType =\s*"post"\s*\|\s*"comment"\s*\|\s*"community";/,
    );
  });

  it("the content actions no longer expose a DM delete", () => {
    const actions = read("src/app/admin/content/actions.ts");
    expect(actions).not.toContain("export async function deleteMessage");
  });
});

describe("the database browser reads through the guard", () => {
  it("the table page calls admin_browser_table_rows, not admin_table_rows", () => {
    const page = read("src/app/admin/database/[table]/page.tsx");
    expect(page).toContain('rpc("admin_browser_table_rows"');
    expect(page).not.toContain('rpc("admin_table_rows"');
  });

  it("nothing in the app calls the raw reader", () => {
    // The wrapper is only a control if the thing it wraps is unreachable.
    // Migration 0162 revokes the grant; this asserts no caller reappears.
    const callers = SOURCES.filter((f) =>
      /rpc\(\s*["']admin_table_rows["']/.test(read(f)),
    );
    expect(callers).toEqual([]);
  });
});

/**
 * Migration 0162 — the P0 found in review, and its two siblings.
 *
 * 0160 guarded the /admin/database wrapper but left public.admin_table_rows
 * granted to `authenticated`, so the unrestricted DM browser survived one
 * PostgREST call away. Auditing that turned up the same shape in
 * admin_update_row (it RETURNS the row it writes, so a no-op update is a read)
 * and admin_delete_row (it snapshots the row into the audit log).
 */
describe("migration 0162 closes the generic row RPC bypasses", () => {
  const sql = read(
    "supabase/migrations/0162_revoke_generic_row_rpcs_on_dm_tables.sql",
  );

  it("revokes the raw reader from public, anon AND authenticated", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.admin_table_rows\(text, int, int, text, text, text\)\s+from public, anon, authenticated;/,
    );
  });

  it("does not revoke the mutators, which dedicated admin actions still call", () => {
    // users/communities/events/matching call these directly and audibly.
    // Revoking them would break working features; the floor is the fix.
    for (const fn of ["admin_update_row", "admin_insert_row", "admin_delete_row"]) {
      expect(sql).not.toMatch(
        new RegExp(`revoke execute on function public\\.${fn}\\(`),
      );
    }
  });

  it("installs the write floor in all three mutators", () => {
    for (const fn of ["admin_update_row", "admin_insert_row", "admin_delete_row"]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}(`));
      const floorAt = body.indexOf("_dm_write_floor");
      const guardAt = body.indexOf("_admin_guard_super");
      expect(floorAt).toBeGreaterThan(-1);
      // The floor must run before the work, not after it.
      expect(guardAt).toBeLessThan(floorAt);
      expect(floorAt).toBeLessThan(body.indexOf("execute format("));
    }
  });

  it("protects every DM content and evidence table", () => {
    const set = sql.slice(
      sql.indexOf("function public._dm_protected_tables()"),
      sql.indexOf("revoke execute on function public._dm_protected_tables"),
    );
    for (const t of [
      "messages",
      "conversations",
      "message_reactions",
      "message_requests",
      "dm_report_cases",
      "dm_report_messages",
    ]) {
      expect(set).toContain(`'${t}'`);
    }
  });

  it("carved message_requests out of the floor — SUPERSEDED by 0163", () => {
    // 0162 exempted message_requests so /admin/matching kept working. That
    // left admin_delete_row snapshotting the opening message into the audit
    // log, so 0163 removed the carve-out and replaced the feature with
    // admin_delete_message_request. This asserts 0162's own text is unchanged;
    // the CURRENT behaviour is asserted by the 0163 suite above.
    const floor = sql.slice(sql.indexOf("function public._dm_write_floor("));
    expect(floor).toMatch(/if p_table = 'message_requests' then\s+return;/);
  });

  it("routes all three guards through the one protected set", () => {
    for (const guard of [
      "_admin_browser_read_denied_tables",
      "_admin_browser_read_guard",
      "_admin_browser_denied_tables",
      "_dm_write_floor",
    ]) {
      const body = sql.slice(sql.indexOf(`function public.${guard}(`));
      expect(body.slice(0, 900)).toContain("_dm_protected_tables()");
    }
  });
});

describe("migration 0160 revokes and removes what it claims to", () => {
  const sql = read(
    "supabase/migrations/0160_remove_unrestricted_admin_dm_access.sql",
  );

  it("drops both DM RPCs", () => {
    expect(sql).toContain("drop function if exists public.admin_dm_conversations");
    expect(sql).toContain("drop function if exists public.admin_dm_messages");
  });

  it("revokes execute before dropping", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.admin_dm_conversations[\s\S]*from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.admin_dm_messages[\s\S]*from public, anon, authenticated/,
    );
  });

  it("makes the content feed refuse the message type", () => {
    expect(sql).toMatch(
      /if p_type = 'message' then\s*\n\s*raise exception 'one-to-one DM content is not browsable'/,
    );
  });

  it("denies the row browser every DM and evidence table", () => {
    for (const t of [
      "messages",
      "conversations",
      "dm_report_cases",
      "dm_report_messages",
    ]) {
      expect(sql).toContain(`'${t}'`);
    }
  });
});

describe("migration 0161 seals the evidence tables", () => {
  const sql = read("supabase/migrations/0161_dm_selective_reporting.sql");

  it("enables RLS on both new tables", () => {
    expect(sql).toContain(
      "alter table public.dm_report_cases enable row level security",
    );
    expect(sql).toContain(
      "alter table public.dm_report_messages enable row level security",
    );
  });

  it("gives dm_report_messages no select policy at all", () => {
    expect(sql).not.toMatch(/create policy[^;]*on public\.dm_report_messages/);
  });

  it("gives dm_report_cases a reporter-only policy and no admin policy", () => {
    const policies = sql.match(
      /create policy[\s\S]*?on public\.dm_report_cases[\s\S]*?;/g,
    );
    expect(policies).toHaveLength(1);
    expect(policies![0]).toContain("reporter_id = (select auth.uid())");
    expect(policies![0]).not.toContain("is_admin");
  });

  it("makes evidence immutable with a trigger, not just a missing policy", () => {
    expect(sql).toContain("before update or delete on public.dm_report_messages");
  });

  it("audits before returning evidence", () => {
    const detail = sql.slice(sql.indexOf("admin_dm_report_detail"));
    const auditAt = detail.indexOf("dm_report.view_evidence");
    const evidenceAt = detail.indexOf("from public.dm_report_messages e");
    expect(auditAt).toBeGreaterThan(-1);
    expect(evidenceAt).toBeGreaterThan(-1);
    expect(auditAt).toBeLessThan(evidenceAt);
  });

  it("derives the reported user rather than accepting it", () => {
    expect(sql).not.toMatch(/submit_dm_report\([^)]*p_reported_user/);
    expect(sql).toContain("v_other := case when v_low = me then v_high else v_low end");
  });

  it("copies sender and timestamp from the messages table", () => {
    const insert = sql.slice(sql.indexOf("insert into public.dm_report_messages"));
    expect(insert).toContain("m.sender_id");
    expect(insert).toContain("m.created_at");
    expect(insert).toContain("from public.messages m");
    expect(insert).toContain("and m.conversation_id = p_conversation_id");
  });

  it("scopes the tombstone action to evidence in the same report", () => {
    const fn = sql.slice(sql.indexOf("admin_dm_report_hide_message"));
    expect(fn).toContain("where report_id = p_report_id and source_message_id = p_message_id");
    expect(fn).toContain("that message is not evidence in this report");
  });
});

/**
 * Migrations 0163 / 0164 — the message_requests gap and the audit-log residue.
 *
 * message_requests.message is the opening line of a DM. It was rendered on the
 * admin Matching page and snapshotted into moderation_audit_log.before_data on
 * every deletion — the same unrestricted-DM-content exposure Phase 2 removed
 * everywhere else.
 */
describe("the message request body is not an admin-visible surface", () => {
  it("the Matching page does not select the message column", () => {
    const page = read("src/app/admin/matching/page.tsx");
    // The row query, not the head/count query above it (which selects "id").
    expect(page).toMatch(
      /\.from\("message_requests"\)\s*\n\s*\.select\("id, sender_id, recipient_id, status, created_at"\)/,
    );
    // No select on this page may name the body column.
    expect(page).not.toMatch(/\.select\([^)]*\bmessage\b[^)]*\)/);
  });

  it("the RequestRow prop type has no message field", () => {
    const rows = read("src/components/admin/matching-rows.tsx");
    const props = rows.slice(rows.indexOf("export function RequestRow"), rows.length);
    expect(props.slice(0, 600)).not.toMatch(/\bmessage\s*:\s*string/);
  });

  it("no admin component renders request.message", () => {
    const offenders = SOURCES.filter(
      (f) =>
        f.startsWith("src/app/admin/") || f.startsWith("src/components/admin/"),
    ).filter((f) => /\brequest\.message\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("deleteRequest uses the narrow RPC, not the generic row delete", () => {
    const actions = read("src/app/admin/matching/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function deleteRequest"));
    expect(fn).toContain('rpc("admin_delete_message_request"');
    expect(fn).not.toContain('rpc("admin_delete_row"');
    // unmatch legitimately still uses the generic RPC, on `matches`.
    expect(actions).toContain('p_table: "matches"');
    expect(actions).not.toContain('p_table: "message_requests"');
  });
});

describe("migration 0163 seals message_requests", () => {
  const sql = read("supabase/migrations/0163_narrow_message_request_delete.sql");

  it("removes the write-floor carve-out", () => {
    const floor = sql.slice(sql.indexOf("function public._dm_write_floor("));
    expect(floor).not.toMatch(/if p_table = 'message_requests' then/);
  });

  it("adds a super_admin-gated SECURITY DEFINER delete RPC", () => {
    expect(sql).toContain("function public.admin_delete_message_request(p_id uuid)");
    const fn = sql.slice(sql.indexOf("function public.admin_delete_message_request"));
    expect(fn).toContain("security definer");
    expect(fn).toContain("_admin_guard_super()");
  });

  it("never reads, returns, or logs the message body", () => {
    const raw = sql.slice(
      sql.indexOf("function public.admin_delete_message_request"),
      sql.indexOf("revoke execute on function public.admin_delete_message_request"),
    );
    // Strip comments first. The function body explains *why* it avoids
    // to_jsonb and select *, so matching the raw text would flag its own
    // documentation.
    const fn = raw
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(fn).not.toContain("to_jsonb");
    expect(fn).not.toMatch(/select\s+\*/);
    expect(fn).not.toMatch(/\bmr\.message\b/);
    // The audit payload is an explicit allowlist of safe metadata.
    const audit = fn.slice(fn.indexOf("log_admin_action"));
    for (const k of ["request_id", "sender_id", "recipient_id", "status"]) {
      expect(audit).toContain(k);
    }
    expect(audit).not.toContain("'message'");
  });
});

describe("migration 0164 contains the audit-log residue", () => {
  const sql = read(
    "supabase/migrations/0164_audit_log_dm_residue_containment.sql",
  );

  it("revokes client write access to the audit trail", () => {
    expect(sql).toMatch(
      /revoke insert, update, delete on public\.moderation_audit_log from authenticated, anon;/,
    );
  });

  it("withholds the row-snapshot columns from the SELECT allowlist", () => {
    // The end marker must be searched FROM the grant, not from 0 — the
    // rollback note in the file header contains the same phrase and would make
    // this slice run backwards and come out empty (silently passing the
    // not.toContain assertions below while failing the positive ones).
    const from = sql.indexOf("grant select (");
    expect(from).toBeGreaterThan(-1);
    const grant = sql.slice(
      from,
      sql.indexOf("on public.moderation_audit_log to authenticated", from),
    );
    // Parse the parenthesised column list into exact names, so "id" is tested
    // as a column and not as a substring of "actor_id".
    const granted = grant
      .slice(grant.indexOf("(") + 1)
      .replace(/\)[\s\S]*$/, "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    for (const c of ["before_data", "after_data", "ip"]) {
      expect(granted).not.toContain(c);
    }
    // ...while keeping everything /admin/audit and /admin/broadcast read.
    for (const c of [
      "id",
      "actor_id",
      "action",
      "target_type",
      "target_id",
      "reason",
      "metadata",
      "created_at",
    ]) {
      expect(granted).toContain(c);
    }
  });

  it("denies the database browser, which bypasses column grants", () => {
    const guard = sql.slice(
      sql.indexOf("function public._admin_browser_read_denied_tables()"),
    );
    expect(guard).toContain("'moderation_audit_log'");
  });

  it("deletes no data", () => {
    // Retention is an owner decision. Every destructive statement in this file
    // must be commented documentation, never an executed statement.
    const live = sql
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(live).not.toMatch(/\bdelete\s+from\b/i);
    expect(live).not.toMatch(/\bupdate\s+public\.moderation_audit_log\b/i);
    expect(live).not.toMatch(/\btruncate\b/i);
  });
});

describe("no admin surface reads the audit row snapshots", () => {
  it("the audit page selects neither before_data nor after_data", () => {
    const page = read("src/app/admin/audit/page.tsx");
    expect(page).not.toContain("before_data");
    expect(page).not.toContain("after_data");
  });
});

describe("the reporting UI does not reintroduce a transcript", () => {
  it("the moderator case page has no link to a conversation", () => {
    const page = read("src/app/admin/dm-reports/[id]/page.tsx");
    expect(page).not.toMatch(/href=\{`\/chat\//);
    expect(page).not.toContain("admin_content_feed");
  });

  it("the report action forwards no sender, body, or timestamp", () => {
    const action = read("src/app/(student)/chat/report-actions.ts");
    const call = action.slice(action.indexOf('rpc("submit_dm_report"'));
    expect(call).not.toMatch(/p_sender|p_body|p_created_at|p_reported_user/);
  });
});
