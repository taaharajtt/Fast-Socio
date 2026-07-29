import Image from "next/image";

/**
 * Small brand-mark badge for section titles (fix-046). Copies the Campus
 * Help header's box treatment (gradient-brand square, rounded-[14px],
 * h-10 w-10, gap-2.5 to the title) but swaps the lucide icon for the actual
 * FAST SOCIO logo — the same asset the Home header renders — per the
 * explicit instruction to match the navbar/brand asset rather than an icon.
 * Each page that wants the badge imports and renders it explicitly next to
 * its own <h1>; this file is not itself a shared header component.
 */
export function SectionLogo() {
  return (
    <span
      className="gradient-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] shadow-[0_8px_24px_rgba(124,92,255,0.35)]"
      aria-hidden
    >
      <Image
        src="/brand/logo.png"
        alt=""
        width={512}
        height={256}
        className="h-6 w-auto"
      />
    </span>
  );
}
