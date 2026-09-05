import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AURA_REASON_LABELS, auraReasonLabel } from "./labels";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * The Aura breakdown on /profile/aura groups the ledger by `reason` and renders
 * `auraReasonLabel(reason)`. An unlabelled reason falls through to the raw enum
 * value, so a student would be shown "signup_bonus" — which is why this asserts
 * coverage of every reason the database can actually emit, not just the new one.
 */

describe("the welcome bonus label", () => {
  it("reads as a gift", () => {
    expect(auraReasonLabel("signup_bonus")).toBe("Welcome bonus");
  });

  it("does not describe it as something earned", () => {
    const label = auraReasonLabel("signup_bonus").toLowerCase();
    for (const word of ["earned", "achievement", "reward", "bonus points"]) {
      if (word === "bonus points") continue;
      expect(label).not.toContain(word);
    }
  });
});

describe("every reason the database can emit has a label", () => {
  // Parsed from migration 0001's enum plus every later `add value`, so a reason
  // added in SQL without a label here fails the test run rather than shipping a
  // raw enum string to a student.
  function enumReasons(): string[] {
    const found = new Set<string>();
    const init = read("supabase/migrations/0001_init_foundation.sql");
    const block = init
      .split("create type public.aura_reason as enum (")[1]
      .split(");")[0];
    for (const m of block.matchAll(/'([a-z_]+)'/g)) found.add(m[1]);

    for (const file of [
      "supabase/migrations/0020_comment_aura_realtime.sql",
      "supabase/migrations/0055_xp_achievements.sql",
      "supabase/migrations/0102_help_network.sql",
      "supabase/migrations/0190_aura_reason_signup_bonus.sql",
    ]) {
      for (const m of read(file).matchAll(
        /aura_reason\s+add value if not exists '([a-z_]+)'/g
      ))
        found.add(m[1]);
    }
    return [...found];
  }

  it("covers the full enum", () => {
    const missing = enumReasons().filter((r) => !(r in AURA_REASON_LABELS));
    expect(missing).toEqual([]);
  });

  it("includes signup_bonus in the enum in the first place", () => {
    expect(enumReasons()).toContain("signup_bonus");
  });

  it("never renders a raw enum value for a known reason", () => {
    for (const reason of enumReasons()) {
      expect(auraReasonLabel(reason)).not.toBe(reason);
    }
  });

  it("still falls back safely for an unknown reason", () => {
    expect(auraReasonLabel("something_new")).toBe("something_new");
  });
});

describe("the migration's promises, asserted at the source", () => {
  const M191 = read("supabase/migrations/0191_signup_welcome_bonus.sql");
  const M190 = read("supabase/migrations/0190_aura_reason_signup_bonus.sql");

  it("adds the enum value in its own migration", () => {
    // Postgres refuses to USE a new enum value in the transaction that adds it.
    expect(M190).toContain("add value if not exists 'signup_bonus'");
    expect(M190).not.toContain("aura_transactions");
  });

  it("awards exactly 100, once, with a non-identifying payload", () => {
    expect(M191).toContain("values (new.id, 100, 'signup_bonus',");
    expect(M191).toContain("jsonb_build_object('source', 'welcome_invitation')");
    expect(M191).toContain(
      "on conflict (user_id) where reason = 'signup_bonus' do nothing"
    );
    // No email or name may reach the ledger metadata.
    const insert = M191.split("insert into public.aura_transactions")[1].split(";")[0];
    expect(insert).not.toContain("email");
    expect(insert).not.toContain("full_name");
  });

  it("enforces one per user with a database index, not a SELECT EXISTS", () => {
    expect(M191).toContain(
      "create unique index if not exists aura_transactions_signup_bonus_uidx"
    );
    expect(M191).toContain("where reason = 'signup_bonus'");
  });

  it("never writes profiles.aura_score directly", () => {
    expect(M191).not.toMatch(/update public\.profiles[\s\S]{0,120}aura_score/);
  });

  it("creates no grant, so it cannot become XP", () => {
    // Since 0186 XP is the sum of ACTIVE GRANTS; a grant-less ledger row earns
    // no XP by construction, which is the whole exclusion mechanism.
    //
    // Asserted on CODE, not prose: the migration's header explains the grant
    // model at length, so a substring search over the whole file would match
    // the explanation rather than a write.
    const code = M191.replace(/^\s*--.*$/gm, "");
    expect(code).not.toContain("aura_award(");
    expect(code).not.toContain("aura_grants");
  });

  it("excludes itself from every weekly ranking function", () => {
    for (const fn of [
      "get_weekly_leaderboard",
      "get_scoped_leaderboard",
      "get_department_rivalry",
      "snapshot_leaderboard",
      "snapshot_department_rivalry",
    ]) {
      expect(M191).toContain(fn);
    }
    // One added predicate per ranking function, plus the streak metric.
    const guards = M191.match(/and a\.reason <> 'signup_bonus'/g) ?? [];
    expect(guards).toHaveLength(5);
    expect(M191).toContain("and reason <> 'signup_bonus'");
  });

  it("does not backfill anybody", () => {
    expect(M191).not.toMatch(/insert into public\.aura_transactions[\s\S]{0,200}select/);
  });

  it("keeps the award out of client reach", () => {
    expect(M191).toContain(
      "revoke all on function public.handle_new_user() from public, anon, authenticated;"
    );
  });
});
