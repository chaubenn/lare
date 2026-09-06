"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  key: string;
  label: string;
  href: string;
  badge?: number;
}

/**
 * Sliding-pill tab bar. Links stay shareable; the pill measures the active tab
 * and tweens to it (transitions.dev tabs).
 */
export function TabNav({
  items,
  active,
  label,
}: {
  items: TabItem[];
  active: string;
  label: string;
}) {
  const barRef = useRef<HTMLElement>(null);
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
      bar.querySelector<HTMLElement>(`[data-tab="${active}"]`) ??
      bar.querySelector<HTMLElement>("[data-tab]");
    const current = findTab();
    if (current) moveTo(current, true);

    const onResize = () => {
      const next = findTab();
      if (next) moveTo(next, false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  return (
    <nav ref={barRef} aria-label={label} className="t-tabs">
      <span ref={pillRef} className="t-tabs-pill" aria-hidden />
      {items.map((item) => {
        const current = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            data-tab={item.key}
            aria-current={current ? "page" : undefined}
            className={cn(
              "t-tab inline-flex items-center gap-1.5 no-underline",
              current && "font-medium",
            )}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={cn(
                  "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                  current
                    ? "bg-zinc-950 text-zinc-100"
                    : "lare-badge-pop bg-zinc-100 text-zinc-950",
                )}
              >
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
