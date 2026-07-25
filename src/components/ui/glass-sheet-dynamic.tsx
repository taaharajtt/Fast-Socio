"use client";

import dynamic from "next/dynamic";

type GlassSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  label?: string;
};

export const GlassSheet = dynamic<GlassSheetProps>(
  () => import("./glass-sheet").then((mod) => mod.GlassSheet),
  { ssr: false }
);
