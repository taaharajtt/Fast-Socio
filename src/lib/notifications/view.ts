/** Maps a notification (type + actor + data) to display text and a link. */
export function notificationView(
  type: string,
  actorName: string | null,
  data: Record<string, unknown>
): { text: string; href: string } {
  const who = actorName ?? "Someone";
  switch (type) {
    case "match":
      return { text: `You matched with ${who}!`, href: "/chat" };
    case "message_request":
      return { text: `${who} sent you a message request`, href: "/chat" };
    case "message":
      return {
        text: `${who} sent you a message`,
        href: data.conversation_id ? `/chat/${data.conversation_id}` : "/chat",
      };
    case "post_like":
      return {
        text: `${who} liked your post`,
        href: data.post_id ? `/post/${data.post_id}` : "/home",
      };
    case "comment":
      return {
        text: `${who} commented on your post`,
        href: data.post_id ? `/post/${data.post_id}` : "/home",
      };
    case "community_approved":
      return {
        text: "Your community was approved 🎉",
        href: data.community_id
          ? `/communities/${data.community_id}`
          : "/communities",
      };
    case "event_approved":
      return {
        text: "Your event was approved 🎉",
        href: data.event_id ? `/events/${data.event_id}` : "/events",
      };
    default:
      return { text: "New notification", href: "/home" };
  }
}
