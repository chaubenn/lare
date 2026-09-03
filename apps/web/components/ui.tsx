"use client";

/**
 * `@lare/ui` components use hooks but don't carry a "use client" directive, so they must be
 * re-exported from a client module before Server Components can render them.
 */
export { CodeBlock, DifficultyBadge, SubmissionStats } from "@lare/ui";
