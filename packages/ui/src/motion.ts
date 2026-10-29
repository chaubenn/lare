/** Apple damping/response table mapped onto motion's bounce/duration. */

export const SPRING = {
  ui: { type: "spring", bounce: 0, duration: 0.35 },
  move: { type: "spring", bounce: 0, duration: 0.4 },
  momentum: { type: "spring", bounce: 0.2, duration: 0.4 },
  sheet: { type: "spring", bounce: 0.2, duration: 0.3 },
} as const;

export type SpringName = keyof typeof SPRING;
