import type {
  HelpCategory,
  HelpUrgency,
  HelpStatus,
  HelpOfferStatus,
} from "./logic";

/**
 * Explicit column lists for the two feed views. We never `select("*")` on these
 * views — the column set is spelled out so a schema change is a compile-time
 * concern and no unexpected column ever reaches the client.
 */
export const HELP_REQUEST_COLUMNS =
  "id, title, body, category, urgency, department, semester, course_code, " +
  "is_anonymous, allow_dms, status, selected_response_id, response_count, " +
  "follower_count, created_at, updated_at, resolved_at, is_mine, is_following, " +
  "author_id, author_name, author_username, author_avatar_url, " +
  "author_school, author_semester";

export const HELP_RESPONSE_COLUMNS =
  "id, request_id, body, kind, is_selected, created_at, is_mine, is_anonymous, " +
  "author_is_anon, author_id, author_name, author_username, author_avatar_url, " +
  "author_school, author_semester, status, accepted_at, viewer_owns_request, " +
  "seeker_reply, seeker_reply_at";

/** A row from public.help_request_feed (author fields already anonymity-masked). */
export type HelpRequestRow = {
  id: string;
  title: string;
  body: string;
  category: HelpCategory;
  urgency: HelpUrgency;
  department: string | null;
  semester: number | null;
  course_code: string | null;
  is_anonymous: boolean;
  allow_dms: boolean;
  status: HelpStatus;
  selected_response_id: string | null;
  response_count: number;
  follower_count: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  is_mine: boolean;
  is_following: boolean;
  author_id: string | null;
  author_name: string | null;
  author_username: string | null;
  author_avatar_url: string | null;
  /** Seeker's school + derived semester (non-identifying; shown when anonymous). */
  author_school: string | null;
  author_semester: number | null;
};

/**
 * A row from public.help_response_feed (mig 0109). The view returns a row ONLY
 * to the request owner, the response author, or an admin — so a viewer never
 * receives any, and a helper receives only their own.
 */
export type HelpResponseRow = {
  id: string;
  request_id: string;
  body: string | null;
  kind: "offer" | "answer";
  is_selected: boolean;
  created_at: string;
  is_mine: boolean;
  /** The helper chose to respond anonymously. */
  is_anonymous: boolean;
  /** This row's helper identity is masked from the current viewer. */
  author_is_anon: boolean;
  author_id: string | null;
  author_name: string | null;
  author_username: string | null;
  author_avatar_url: string | null;
  /** Helper's school + derived semester (non-identifying; shown when anonymous). */
  author_school: string | null;
  author_semester: number | null;
  /** Offer-approval lifecycle (mig 0106). */
  status: HelpOfferStatus;
  accepted_at: string | null;
  /** True when the viewer is the request owner (i.e. can approve/decline/reply). */
  viewer_owns_request: boolean;
  /** The seeker's reply to this helper, visible only to the two parties + admin. */
  seeker_reply: string | null;
  seeker_reply_at: string | null;
};
