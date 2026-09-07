"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";

/** Apple's exponential-decay endpoint projection (not v²/2a). */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive edge resistance. `overshoot` and `dimension` in the same unit. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (1 - 1 / ((overshoot * constant) / dimension + 1)) * dimension;
}

const SAMPLE_WINDOW_MS = 100;
const DIRECTION_LOCK_PX = 10;

interface Sample {
  t: number;
  x: number;
  y: number;
}

function velocityFrom(samples: Sample[], axis: "x" | "y"): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const firstSample = samples[0];
  if (!last || !firstSample) return 0;
  const cutoff = last.t - SAMPLE_WINDOW_MS;
  let first = firstSample;
  for (const s of samples) {
    if (s.t >= cutoff) {
      first = s;
      break;
    }
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return ((last[axis] - first[axis]) / dt) * 1000;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface DragToPageOptions {
  page: number;
  pageCount: number;
  onPageChange: (next: number) => void;
  /** Page width in px. Defaults to the element's clientWidth. */
  pageWidth?: number;
  axis?: "x" | "y";
  disabled?: boolean;
}

/**
 * Pointer-capture 1:1 drag with velocity history, ~10px hysteresis before committing
 * a direction, endpoint projection to choose the target page, then a spring handed
 * the release velocity. Reverse-vs-commit is decided on velocity sign, not position.
 */
export function useDragToPage(
  ref: RefObject<HTMLElement | null>,
  { page, pageCount, onPageChange, pageWidth, axis = "x", disabled = false }: DragToPageOptions,
) {
  const state = useRef({
    page,
    pageCount,
    onPageChange,
    pageWidth,
    axis,
    disabled,
  });
  state.current = { page, pageCount, onPageChange, pageWidth, axis, disabled };

  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0, page: 0 });
  const samples = useRef<Sample[]>([]);
  const offset = useRef(0);
  const locked = useRef<"x" | "y" | null>(null);

  const applyOffset = useCallback(
    (px: number) => {
      const el = ref.current;
      if (!el) return;
      offset.current = px;
      el.style.transform =
        state.current.axis === "x" ? `translate3d(${px}px,0,0)` : `translate3d(0,${px}px,0)`;
    },
    [ref],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (prefersReducedMotion()) return;
      dragging.current = true;
      locked.current = null;
      start.current = { x: event.clientX, y: event.clientY, page: state.current.page };
      samples.current = [{ t: event.timeStamp, x: event.clientX, y: event.clientY }];
      el.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      samples.current.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
      if (samples.current.length > 8) samples.current.shift();

      const dx = event.clientX - start.current.x;
      const dy = event.clientY - start.current.y;
      if (!locked.current) {
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
        locked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (locked.current !== state.current.axis) return;

      const raw = state.current.axis === "x" ? dx : dy;
      const width = state.current.pageWidth ?? el.clientWidth;
      const atStart = start.current.page <= 0 && raw > 0;
      const atEnd = start.current.page >= state.current.pageCount - 1 && raw < 0;
      const next = atStart || atEnd ? rubberband(Math.abs(raw), width) * Math.sign(raw) : raw;
      applyOffset(next);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }

      const width = state.current.pageWidth ?? el.clientWidth;
      const vel = velocityFrom(samples.current, state.current.axis);
      const projected = offset.current + project(vel);
      let next = start.current.page;

      if (locked.current === state.current.axis) {
        if (vel !== 0) {
          // Velocity sign decides commit vs reverse.
          next = vel < 0 ? start.current.page + 1 : start.current.page - 1;
        } else if (Math.abs(projected) > width * 0.35) {
          next = projected < 0 ? start.current.page + 1 : start.current.page - 1;
        }
      }

      next = Math.max(0, Math.min(state.current.pageCount - 1, next));
      applyOffset(0);
      el.style.transform = "";
      if (next !== state.current.page) state.current.onPageChange(next);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [applyOffset, disabled, ref]);
}

export interface DraggableAnchor {
  x: number;
  y: number;
}

export interface UseDraggableOptions {
  /** Current position (left/top of the element). */
  position: DraggableAnchor;
  onMove: (next: DraggableAnchor) => void;
  onRelease?: (next: DraggableAnchor, velocity: { x: number; y: number }) => void;
  bounds?: { minX: number; maxX: number; minY: number; maxY: number };
  /** Snap targets after release (corners, edges). */
  snapTo?: DraggableAnchor[];
  disabled?: boolean;
}

/**
 * 1:1 drag that respects the grab offset, snaps to the nearest anchor with
 * projection, and rubber-bands at bounds.
 */
export function useDraggable(
  ref: RefObject<HTMLElement | null>,
  { position, onMove, onRelease, bounds, snapTo, disabled = false }: UseDraggableOptions,
) {
  const state = useRef({ position, onMove, onRelease, bounds, snapTo, disabled });
  state.current = { position, onMove, onRelease, bounds, snapTo, disabled };

  const grab = useRef({ x: 0, y: 0, pointerX: 0, pointerY: 0 });
  const samples = useRef<Sample[]>([]);
  const dragging = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const clamp = (pt: DraggableAnchor): DraggableAnchor => {
      const b = state.current.bounds;
      if (!b) return pt;
      let { x, y } = pt;
      if (x < b.minX) x = b.minX - rubberband(b.minX - x, Math.max(1, b.maxX - b.minX));
      if (x > b.maxX) x = b.maxX + rubberband(x - b.maxX, Math.max(1, b.maxX - b.minX));
      if (y < b.minY) y = b.minY - rubberband(b.minY - y, Math.max(1, b.maxY - b.minY));
      if (y > b.maxY) y = b.maxY + rubberband(y - b.maxY, Math.max(1, b.maxY - b.minY));
      return { x, y };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select, [role='button']")) return;
      dragging.current = true;
      grab.current = {
        x: state.current.position.x,
        y: state.current.position.y,
        pointerX: event.clientX,
        pointerY: event.clientY,
      };
      samples.current = [{ t: event.timeStamp, x: event.clientX, y: event.clientY }];
      el.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      samples.current.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
      if (samples.current.length > 8) samples.current.shift();
      const next = clamp({
        x: grab.current.x + (event.clientX - grab.current.pointerX),
        y: grab.current.y + (event.clientY - grab.current.pointerY),
      });
      state.current.onMove(next);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      const vx = velocityFrom(samples.current, "x");
      const vy = velocityFrom(samples.current, "y");
      let next = {
        x: state.current.position.x + project(vx),
        y: state.current.position.y + project(vy),
      };
      const b = state.current.bounds;
      if (b) {
        next = {
          x: Math.min(b.maxX, Math.max(b.minX, next.x)),
          y: Math.min(b.maxY, Math.max(b.minY, next.y)),
        };
      }
      const anchors = state.current.snapTo;
      if (anchors && anchors.length > 0) {
        let best = anchors[0];
        let bestD = Number.POSITIVE_INFINITY;
        for (const a of anchors) {
          const d = (a.x - next.x) ** 2 + (a.y - next.y) ** 2;
          if (d < bestD) {
            best = a;
            bestD = d;
          }
        }
        if (best) next = best;
      }
      state.current.onMove(next);
      state.current.onRelease?.(next, { x: vx, y: vy });
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [disabled, ref]);
}
