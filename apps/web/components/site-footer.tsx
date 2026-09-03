import { GITHUB_REPO_URL } from "@/lib/env";
import { GitHubIcon } from "./brand-icons";

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-900">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-zinc-500">
        <p>
          <span className="font-semibold text-zinc-400">Lare</span> · Hevy for LeetCode
        </p>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-zinc-200"
        >
          <GitHubIcon className="size-3.5" />
          chaubenn/lare
        </a>
      </div>
    </footer>
  );
}
