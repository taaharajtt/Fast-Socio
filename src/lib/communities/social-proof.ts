import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolveAvatarUrl } from "@/lib/avatar";
import {
  batchOf,
  firstName,
  rankProof,
  type ProofCandidate,
  type Viewer,
} from "@/lib/communities/social-proof-rank";

export type SocialProofPerson = {
  id: string;
  name: string;
  avatar_url: string | null;
};

export type SocialProofVM = {
  /** The two or three most relevant faces, best first. */
  people: SocialProofPerson[];
  /** Everyone else, beyond the named faces and the viewer themselves. */
  others: number;
};

/**
 * Social proof for a space's cover: whose faces would actually move this
 * viewer. People join what their people are already in, so the ranking is
 * strictly by closeness to the viewer —
 *
 *   match  >  programme mate (same department + degree)
 *          >  batchmate (same enrolment year)
 *          >  department mate  >  anyone else
 *
 * with a face beating a blank avatar at equal rank, since the whole point is
 * recognition. The viewer is never shown their own face.
 *
 * `memberIds` is passed in because every caller has already loaded its own
 * roster (community_members, event_attendees, …); this only ranks them.
 */
export async function getSocialProof(
  memberIds: string[],
  total: number,
  me: string,
  limit = 3
): Promise<SocialProofVM> {
  const unique = [...new Set(memberIds)];
  // The viewer never counts as their own social proof — not as a face, and not
  // in the "and N others" tail.
  const withoutMe = total - (unique.includes(me) ? 1 : 0);
  const candidates = unique.filter((id) => id !== me).slice(0, 200);
  if (candidates.length === 0) return { people: [], others: Math.max(0, withoutMe) };

  const supabase = await createClient();
  const [{ data: matchRows }, { data: mine }, { data: profiles }] = await Promise.all([
    supabase
      .from("matches")
      .select("user_low, user_high")
      .or(`user_low.eq.${me},user_high.eq.${me}`),
    supabase
      .from("profiles")
      .select("department, degree, username")
      .eq("id", me)
      .single(),
    supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url, gender, department, degree")
      .in("id", candidates),
  ]);

  const viewer: Viewer = {
    matchedIds: new Set(
      ((matchRows ?? []) as { user_low: string; user_high: string }[]).map((m) =>
        m.user_low === me ? m.user_high : m.user_low
      )
    ),
    department: mine?.department ?? null,
    degree: mine?.degree ?? null,
    batch: batchOf(mine?.username ?? null),
  };

  const ranked = rankProof((profiles ?? []) as ProofCandidate[], viewer, limit).map(
    (p) => ({ id: p.id, name: firstName(p), avatar_url: resolveAvatarUrl(p.avatar_url, p.gender) })
  );

  return { people: ranked, others: Math.max(0, withoutMe - ranked.length) };
}
