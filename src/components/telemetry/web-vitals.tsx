"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { reportMetric, currentRoute } from "@/lib/telemetry/report";

/**
 * Core Web Vitals + long tasks, tagged by route template.
 *
 * WHAT THIS ANSWERS that server logs cannot. Caddy's access log measures how
 * long the SERVER took; it says nothing about what the student experienced.
 * The audit's targets are written in terms of the second one — "immediate
 * visual response on every primary-tab interaction", "p95 navigation below
 * 750ms" — and until now nothing measured it. A route can answer in 60ms and
 * still feel broken if hydration then blocks the main thread for 400ms.
 *
 * INP is the one that matters most here. It is the direct measure of "I tapped
 * and nothing happened", which is the complaint this whole engagement exists to
 * fix, and it is the number that will show whether moving the chat draft out of
 * the 2,211-line thread component (Phase 5) actually helped.
 *
 * Long tasks are collected alongside because they are the usual CAUSE of a bad
 * INP: a single 300ms script block will ruin every interaction that lands
 * inside it, and knowing the route it happened on is most of the diagnosis.
 *
 * Everything is sampled and route-templated by `lib/telemetry/report.ts`; see
 * that file for the privacy rules. Nothing from the page itself is attached.
 */
export function WebVitals() {
  useReportWebVitals((metric) => {
    // CLS is a unitless ratio; the rest are milliseconds. Scaling CLS keeps a
    // single integer field meaningful across metrics instead of rounding every
    // real layout shift to zero.
    const value = metric.name === "CLS" ? metric.value * 1000 : metric.value;
    reportMetric(metric.name.toLowerCase(), value, {
      metric_rating: metric.rating ?? "unknown",
      // "web-vital" vs Next's own custom timings (hydration, route-change), so
      // the two can be separated in a chart rather than averaged together.
      metric_kind: metric.label ?? "unknown",
    });
  });

  useEffect(() => {
    // `longtask` is not supported everywhere (notably Safari), and an
    // unsupported entry type makes observe() throw rather than no-op.
    if (typeof PerformanceObserver === "undefined") return;
    const supported = PerformanceObserver.supportedEntryTypes;
    if (!supported?.includes("longtask")) return;

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // 50ms is the spec's definition of a long task, but at that threshold
          // a busy page reports constantly and the signal drowns. 200ms is the
          // point where a person notices the tap did not land.
          if (entry.duration < 200) continue;
          reportMetric("long_task", entry.duration, {
            // The route AT THE TIME OF THE TASK — a long task during a
            // navigation belongs to the page that caused it.
            task_route: currentRoute(),
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Telemetry must never break the page it measures.
      observer = null;
    }
    return () => observer?.disconnect();
  }, []);

  return null;
}
