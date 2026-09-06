import { cn } from "@lare/ui";
import { type ReactNode, useLayoutEffect, useRef } from "react";

export interface SegmentedTab<K extends string = string> {
  key: K;
  label: string;
  badge?: ReactNode;
}

/**
 * Sliding-pill segmented control (transitions.dev tabs). Measures the active tab and
 * writes left/width onto the pill so the highlight travels instead of popping.
 */
export function SegmentedTabs<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: Array<SegmentedTab<K>>;
  value: K;
  onChange: (key: K) => void;
  label: string;
  className?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const pill = pillRef.current;
    if (!bar || !pill) return;

    const moveTo = (tab: HTMLElement, animate: boolean) => {
      if (!animate) {
        const prev = pill.style.transition;
        pill.style.transition = "none";
        pill.style.transform = `translateX(${tab.offsetLeft}px)`;
        pill.style.width = `${tab.offsetWidth}px`;
        void pill.offsetWidth;
        pill.style.transition = prev;
      } else {
        pill.style.transform = `translateX(${tab.offsetLeft}px)`;
        pill.style.width = `${tab.offsetWidth}px`;
      }
    };

    const findTab = () =>
      bar.querySelector<HTMLElement>(`[data-tab="${value}"]`) ??
      bar.querySelector<HTMLElement>("[data-tab]");
    const active = findTab();
    if (active) moveTo(active, true);

    const onResize = () => {
      const next = findTab();
      if (next) moveTo(next, false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [value]);

  return (
    <div ref={barRef} className={cn("t-tabs", className)} role="tablist" aria-label={label}>
      <span ref={pillRef} className="t-tabs-pill" aria-hidden />
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            data-tab={item.key}
            aria-selected={selected}
            className={cn("t-tab inline-flex items-center gap-1.5", selected && "font-medium")}
            onClick={() => onChange(item.key)}
          >
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
