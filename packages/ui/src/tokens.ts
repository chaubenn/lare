/** JS mirror of `tokens.css`. Use only where CSS variables cannot (Satori, canvas, badges). */

export const brand = {
  ink: "#0c0c0b",
  ink2: "#161615",
  ink3: "#1e1e1c",
  line: "#2a2a27",
  lineStrong: "#3d3c39",
  muted: "#8a8780",
  soft: "#a8a49c",
  bone: "#f0ece4",
  paper: "#f7f4ee",
  focus: "#c8c2b6",
  statusRun: "#6f8f6a",
  statusPause: "#c4a15a",
  statusStop: "#c45c5c",
} as const;

export const semantic = {
  surface: brand.ink,
  surfaceRaised: brand.ink2,
  surfaceSunken: brand.ink3,
  border: brand.line,
  borderStrong: brand.lineStrong,
  text: brand.bone,
  textSecondary: brand.soft,
  textTertiary: brand.muted,
  accent: brand.bone,
  accentFg: brand.ink,
  focus: brand.focus,
  diffEasy: brand.statusRun,
  diffMedium: brand.statusPause,
  diffHard: brand.statusStop,
  info: "#7a9eb0",
  danger: brand.statusStop,
} as const;

export const DIFFICULTY_COLOUR: Record<"Easy" | "Medium" | "Hard", string> = {
  Easy: semantic.diffEasy,
  Medium: semantic.diffMedium,
  Hard: semantic.diffHard,
};

export const chart = {
  barIdle: brand.lineStrong,
  barActive: brand.bone,
  barStub: brand.line,
  tick: brand.muted,
  paper: brand.ink2,
  ink: brand.bone,
  line: brand.line,
} as const;
