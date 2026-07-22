import type {
  HelpCategory,
  HelpUrgency,
  HelpStatus,
  HelpOfferStatus,
} from "./logic";

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
};

/** A row from public.help_response_feed. */
export type HelpResponseRow = {
  id: string;
  request_id: string;
  body: string | null;
  kind: "offer" | "answer";
  is_selected: boolean;
  created_at: string;
  is_mine: boolean;
  author_id: string | null;
  author_is_op_anon: boolean;
  author_name: string | null;
  author_username: string | null;
  author_avatar_url: string | null;
  /** Offer-approval lifecycle (mig 0106). */
  status: HelpOfferStatus;
  accepted_at: string | null;
  /** True when the viewer is the request owner (i.e. can approve/decline). */
  viewer_owns_request: boolean;
};
