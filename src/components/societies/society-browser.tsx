import { SocietyCard } from "@/components/societies/society-card";
import type { SocietyCardVM } from "@/lib/societies/types";

export function SocietyBrowser({ societies }: { societies: SocietyCardVM[] }) {
  return (
    <div className="mt-4 space-y-2.5">
      {societies.map((s) => (
        <SocietyCard key={s.id} s={s} />
      ))}
    </div>
  );
}
