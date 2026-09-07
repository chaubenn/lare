import { Wordmark } from "@lare/ui/brand";
import { Container } from "@lare/ui/primitives";
import { GITHUB_REPO_URL } from "@/lib/env";
import { GitHubIcon } from "./brand-icons";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border)] pb-16 md:pb-0">
      <Container
        width="wide"
        className="flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-[var(--text-tertiary)]"
      >
        <p className="inline-flex items-center gap-2">
          <Wordmark
            markClassName="size-3.5 text-[var(--text-tertiary)]"
            className="text-[var(--text-tertiary)]"
          />
          <span>· Hevy for LeetCode</span>
        </p>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-[var(--text)]"
        >
          <GitHubIcon className="size-3.5" />
          chaubenn/lare
        </a>
      </Container>
    </footer>
  );
}
