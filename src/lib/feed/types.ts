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
};
