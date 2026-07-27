/** Page size for the campus feed (kept out of the "use server" action module,
 *  which may only export async functions). */
export const FEED_PAGE_SIZE = 20;

/** A row from the feed_posts view. Author fields are null for anonymous posts
 *  when the viewer is neither the author nor an admin. */
export type FeedPost = {
  id: string;
  body: string | null;
  image_url: string | null;
  is_anonymous: boolean;
  like_count: number;
  comment_count: number;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  liked_by_me: boolean;
  /** Poll attached to this post, if any (post_polls.id). The post body is the
   *  poll question; options/tallies load from post_poll_results. */
  poll_id?: string | null;
  /** Author's department (e.g. "CS") — present once the feed_posts view exposes
   *  it (migration feed_posts_add_author_department). Optional/back-compatible. */
  author_department?: string | null;
  /** Whether the author is a verified account (UISpec V3 §2.7). Masked to false
   *  for anonymous posts by the view. Optional/back-compatible. */
  author_verified?: boolean | null;
};

/**
 * The exact columns a FeedPost needs, as a PostgREST select list.
 *
 * The hot reads (campus feed, a profile's posts, a single post) used to
 * `select("*")` on the feed_posts view. That view is wide and joins author +
 * like/comment aggregates, so every extra column was serialised, shipped over
 * the wire from the database and then re-serialised into the RSC payload —
 * for fields no renderer touches. Naming them keeps the payload to what
 * PostCard actually reads, and makes it obvious what breaks if the view
 * changes shape.
 */
// Kept as one literal (rather than a joined array) so PostgREST's types can
// still infer the row shape from it at each call site.
// prettier-ignore
export const FEED_COLUMNS = "id, body, image_url, is_anonymous, like_count, comment_count, created_at, author_id, author_name, author_avatar, author_department, author_verified, liked_by_me, poll_id" as const;
