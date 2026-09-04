import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_POST_MEDIA, MEDIA_ASPECTS, CAROUSEL_LAYOUTS } from "./media";

/**
 * The database contract for carousel media, asserted at the source level.
 *
 * Vitest here runs pure logic with no database (see vitest.config.ts), so these
 * cannot prove the live schema refuses a call — supabase/tests/*.sql does that
 * when Supabase access is available. What they CAN do is fail the build the
 * moment the migration is edited in a way that quietly drops one of the
 * guarantees the feature depends on: the five-image ceiling, the ratio
 * vocabulary, the cascade, the anonymity masking, or the fact that no client
 * role can write `post_media` directly.
 *
 * They also keep the TypeScript constants and the SQL from drifting apart,
 * which is the failure mode that would let a "6th photo" pass one layer and be
 * rejected by the other.
 */

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/0180_post_media_carousel.sql"),
  "utf8"
);

describe("post_media enforces its shape in the database", () => {
  it("caps positions so a sixth row is impossible", () => {
    // position < 5 plus unique(post_id, position) is what makes the ceiling
    // structural rather than advisory.
    expect(SQL).toMatch(/"position"\s*>=\s*0\s+and\s+"position"\s*<\s*5/);
    expect(SQL).toMatch(/unique\s*\(post_id,\s*"position"\)/);
  });

  it("agrees with MAX_POST_MEDIA", () => {
    expect(MAX_POST_MEDIA).toBe(5);
    expect(SQL).toContain("at most 5 photos");
  });

  it("allows only the three supported ratios", () => {
    const list = MEDIA_ASPECTS.map((a) => `'${a}'`).join(", ");
    expect(SQL).toContain(`aspect in (${list})`);
  });

  it("allows only the two layout modes", () => {
    const list = CAROUSEL_LAYOUTS.map((l) => `'${l}'`).join(", ");
    expect(SQL).toContain(`carousel_layout in (${list})`);
  });

  it("requires positive dimensions", () => {
    expect(SQL).toMatch(/check\s*\(width\s*>\s*0\s+and\s+height\s*>\s*0\)/);
  });

  it("cascades media away with its post", () => {
    expect(SQL).toMatch(
      /post_id\s+uuid not null references public\.posts \(id\) on delete cascade/
    );
  });

  it("indexes the ordered read the feed does", () => {
    expect(SQL).toContain("on public.post_media (post_id, position)");
  });
});

describe("clients cannot write media directly", () => {
  it("keeps RLS on and revokes every client privilege on post_media", () => {
    expect(SQL).toContain("alter table public.post_media enable row level security");
    expect(SQL).toContain("revoke all on public.post_media from anon, authenticated");
  });

  it("has no policy granting a client insert on post_media", () => {
    expect(SQL).not.toMatch(/create policy[\s\S]*on public\.post_media/i);
  });
});

describe("the definer functions are locked down", () => {
  const functions = [
    "create_post_with_media",
    "my_post_media_urls",
    "unreferenced_post_media",
    "delete_post",
  ];

  for (const fn of functions) {
    it(`${fn} pins search_path`, () => {
      const body = SQL.slice(SQL.indexOf(`function public.${fn}(`));
      expect(body.slice(0, 800)).toContain("set search_path = public");
    });

    it(`${fn} is revoked from public and anon, and granted only to authenticated`, () => {
      expect(SQL).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*from public, anon`)
      );
      expect(SQL).toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*to authenticated`)
      );
    });
  }

  it("derives the author from auth.uid() and never from an argument", () => {
    const fn = SQL.slice(
      SQL.indexOf("function public.create_post_with_media("),
      SQL.indexOf("function public.my_post_media_urls(")
    );
    expect(fn).toContain("me       uuid := auth.uid()");
    expect(fn).toContain("insert into public.posts (");
    // The inserted author is the local `me`, not a p_* parameter.
    expect(fn).not.toMatch(/p_author/);
  });

  it("re-checks community membership that SECURITY DEFINER would bypass", () => {
    const fn = SQL.slice(
      SQL.indexOf("function public.create_post_with_media("),
      SQL.indexOf("function public.my_post_media_urls(")
    );
    expect(fn).toContain("from public.community_members m");
    expect(fn).toContain("not a member of that community");
  });

  it("refuses media on a poll server-side too", () => {
    expect(SQL).toContain("a poll cannot carry photos");
  });

  it("only ever offers unreferenced objects for purging", () => {
    const fn = SQL.slice(SQL.indexOf("function public.unreferenced_post_media("));
    expect(fn).toContain("not exists (select 1 from public.posts p where p.image_url = u.url)");
    expect(fn).toContain(
      "not exists (select 1 from public.post_media m where m.media_url = u.url)"
    );
  });
});

describe("the feed view keeps every protection it had", () => {
  const view = SQL.slice(SQL.indexOf("create view public.feed_posts as"));

  it("still masks an anonymous post's author from everyone but its author and admins", () => {
    for (const column of [
      "author_id",
      "author_name",
      "author_avatar",
      "author_gender",
      "author_department",
      "author_verified",
    ]) {
      expect(view).toContain(`as ${column}`);
    }
    // Six masked columns, each behind the same predicate.
    const masks = view.match(
      /p\.is_anonymous and p\.author_id <> auth\.uid\(\) and not is_admin\(auth\.uid\(\)\)/g
    );
    expect(masks?.length).toBe(6);
  });

  it("still filters blocks, mutes, shadow bans, hidden and unapproved posts", () => {
    expect(view).toContain("from blocked_users b");
    expect(view).toContain("from muted_users mu");
    expect(view).toContain("pr.shadow_banned");
    expect(view).toContain("p.hidden = false");
    expect(view).toContain("p.moderation_status = 'approved'::post_moderation");
  });

  it("aggregates media inline rather than exposing post_media to clients", () => {
    expect(view).toContain("order by m.position");
    expect(view).toContain("as media");
    expect(SQL).toContain("grant select on public.feed_posts to authenticated");
    expect(SQL).not.toContain("grant select on public.post_media");
  });
});

describe("the migration is safe to re-run", () => {
  it("guards every object it creates", () => {
    expect(SQL).toContain("add column if not exists carousel_layout");
    expect(SQL).toContain("create table if not exists public.post_media");
    expect(SQL).toContain("create index if not exists post_media_post_position_idx");
    // The layout CHECK is added inside a DO block that swallows duplicate_object.
    expect(SQL).toContain("when duplicate_object then null");
  });

  it("does not drop or rewrite existing post data", () => {
    expect(SQL).not.toMatch(/drop table (if exists )?public\.posts/i);
    expect(SQL).not.toMatch(/alter table public\.posts\s+drop column/i);
    expect(SQL).not.toMatch(/truncate\s+(table\s+)?public\./i);
    // No backfill and no bulk rewrite of existing rows: legacy posts are left
    // exactly as they are (see the migration's header for why).
    expect(SQL).not.toMatch(/update public\.posts/i);
    expect(SQL).not.toMatch(/insert into public\.post_media[\s\S]{0,200}from public\.posts/i);
    // image_url is preserved for backward compatibility, not removed.
    expect(SQL).toContain("posts.image_url` IS NOT DEPRECATED");
  });
});
