import { AppImage } from "@/components/ui/app-image";

/**
 * The face of a Discover team room: the FAST SOCIO mark rather than a
 * user-supplied image, because these rooms are minted by the app and never get
 * an avatar of their own.
 *
 * Theme-aware the same way the home header is (UAT-006) — logo.png on dark,
 * logo1.png on light, swapped with CSS alone so there is no hydration flash.
 * The mark is wide, so it's contained-and-padded inside the circle instead of
 * cover-cropped to a sliver.
 */
export function DiscoverGroupAvatar({ sizes, priority }: {
  sizes: string;
  priority?: boolean;
}) {
  return (
    <>
      <span className="absolute inset-0 hidden dark:block">
        <AppImage
          src="/brand/logo.png"
          alt=""
          sizes={sizes}
          priority={priority}
          className="object-contain p-1"
        />
      </span>
      <span className="absolute inset-0 block dark:hidden">
        <AppImage
          src="/brand/logo1.png"
          alt=""
          sizes={sizes}
          priority={priority}
          className="object-contain p-1"
        />
      </span>
    </>
  );
}
