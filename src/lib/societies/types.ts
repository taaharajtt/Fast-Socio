import type { SocietyCategory, SocietyRole } from "@/lib/societies/logic";

/** A society row as read from `communities` (is_society = true). */
export type SocietyRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null; // logo
  cover_url: string | null; // banner
  member_count: number; // == follower count
  society_category: SocietyCategory | null;
  is_official: boolean;
  recruitment_open: boolean;
  contact_email: string | null;
  instagram_url: string | null;
  website_url: string | null;
  owner_id: string;
  status: string;
};

/** Directory card view-model (adds derived, viewer-scoped fields). */
export type SocietyCardVM = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
  category: SocietyCategory | null;
  isOfficial: boolean;
  isRecruiting: boolean;
  isFollowing: boolean;
  upcomingEvents: number;
};

/** An officer overlay row joined with the person's safe profile fields. */
export type OfficerVM = {
  user_id: string;
  role: SocietyRole;
  title: string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

/** A row from the society_announcement_feed definer view. */
export type AnnouncementRow = {
  id: string;
  society_id: string;
  title: string;
  body: string;
  pinned: boolean;
  visibility: "public" | "members";
  created_at: string;
  updated_at: string;
  author_id: string;
  author_name: string | null;
  author_username: string | null;
  author_avatar: string | null;
  is_mine: boolean;
};
