import type { SocietyCategory, SocietyRole } from "@/lib/societies/logic";

/** A society row as read from `communities` (is_society = true). */
export type SocietyRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null; // logo
  cover_url: string | null; // banner
  member_count: number; // students who JOINED (may chat)
  follower_count: number; // students who FOLLOW (spectate broadcasts)
  society_category: SocietyCategory | null;
  is_official: boolean;
  recruitment_open: boolean;
  contact_email: string | null;
  instagram_url: string | null;
  website_url: string | null;
  owner_id: string;
  status: string;
};

/** An officer overlay row joined with the person's safe profile fields. */
export type OfficerVM = {
  user_id: string;
  role: SocietyRole;
  title: string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  gender: string | null;
};

/** A row from the society_announcement_feed definer view. */
export type AnnouncementRow = {
  id: string;
  /**
   * Null for anything posted from the chat-style composer (fix-049, mig 0147).
   * Older titled announcements keep theirs and still render it.
   */
  title: string | null;
  society_id: string;
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
  /** Reuses the community poll tables — a society IS a community. */
  poll_id: string | null;
  /** Raw `chat-media` storage path, signed at display time. */
  attachment_url: string | null;
  attachment_type: string | null;
};
