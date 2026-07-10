"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** Static bar heights (%). A real waveform would need to decode the audio; this
 *  reads as one and costs nothing. Deterministic so a bubble never re-shuffles. */
const BARS = [
  38, 62, 45, 80, 55, 95, 70, 48, 86, 60, 40, 72, 92, 52, 66, 44, 78, 58, 88, 46,
  68, 54, 82, 42,
];

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Voice-note player for a chat bubble (UAT-002).
 *
 * The native `<audio controls>` element renders at a fixed ~300px with its own
 * chrome, which is why the bubbles were visibly wider than their contents. This
 * is a compact play/scrub row that sizes to the bubble instead, and the real
 * <audio> element is kept hidden purely as the transport.
 */
export function VoiceNote({ src, mine }: { src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setElapsed(audio.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setElapsed(0);
    };
    // MediaRecorder webm blobs often report duration = Infinity until seeked.
    const onMeta = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  }

  function seekTo(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = fraction * duration;
    setElapsed(audio.currentTime);
  }

  const progress = duration > 0 ? elapsed / duration : 0;

  return (
    <div className="flex w-[180px] items-center gap-2.5">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          mine ? "bg-white/25 text-white" : "bg-accent text-white"
        )}
      >
        {playing ? (
          <Pause className="h-3.5 w-3.5 fill-current" aria-hidden />
        ) : (
          <Play className="ml-0.5 h-3.5 w-3.5 fill-current" aria-hidden />
        )}
      </button>

      {/* Bars double as a scrubber: each is a click target for its own position. */}
      <div className="flex h-7 flex-1 items-center gap-[2px]">
        {BARS.map((height, i) => {
          const played = i / BARS.length < progress;
          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => seekTo((i + 0.5) / BARS.length)}
              style={{ height: `${height}%` }}
              className={cn(
                "w-[2px] shrink-0 rounded-full transition-colors",
                mine
                  ? played
                    ? "bg-white"
                    : "bg-white/35"
                  : played
                    ? "bg-accent"
                    : "bg-fg/20"
              )}
            />
          );
        })}
      </div>

      <span
        className={cn(
          "shrink-0 text-[11px] tabular-nums",
          mine ? "text-white/75" : "text-fg-muted"
        )}
      >
        {formatClock(playing || elapsed > 0 ? elapsed : duration)}
      </span>
    </div>
  );
}
