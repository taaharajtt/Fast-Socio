import { Zap } from "lucide-react";

/**
 * The face of a Discover team room: an app-icon mark rather than a
 * user-supplied image, because these rooms are minted by the app and never
 * get an avatar of their own.
 *
 * Renders the lightning-bolt glyph on a brand-purple circle — not the
 * "FAST SOCIO" wordmark (`/brand/logo.png`), which is illegible once
 * squashed into a 32-48px circle.
 */
export function DiscoverGroupAvatar({ sizes, priority }: {
  sizes: string;
  priority?: boolean;
}) {
  void sizes;
  void priority;
  return (
    <span className="gradient-brand absolute inset-0 flex items-center justify-center">
      <Zap className="h-1/2 w-1/2 fill-white text-white" aria-hidden="true" />
    </span>
  );
}
