/**
 * Stands in for `shiki/langs` and `shiki/themes` (see the aliases in vite.config.ts). The
 * editor's highlighter, `@lexical/code-shiki`, looks languages and themes up in those indexes,
 * which list every grammar Shiki ships: a few hundred lazy chunks in the app for the three
 * languages a code block can be. This lists just those, and the app's own code colours.
 */
import { CODE_THEME, CODE_THEME_NAME } from "@lare/ui";

export const bundledLanguagesInfo = [
  {
    id: "python",
    name: "Python",
    aliases: ["py"],
    import: () => import("@shikijs/langs/python"),
  },
  {
    id: "java",
    name: "Java",
    import: () => import("@shikijs/langs/java"),
  },
  {
    id: "cpp",
    name: "C++",
    aliases: ["c++"],
    import: () => import("@shikijs/langs/cpp"),
  },
];

export const bundledThemesInfo = [
  {
    id: CODE_THEME_NAME,
    displayName: "Lare",
    type: "dark",
    import: () => Promise.resolve({ default: CODE_THEME }),
  },
];
