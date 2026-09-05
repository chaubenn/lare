import { Wordmark } from "@lare/ui/brand";
import { Bot, Download, Puzzle, Timer, Video } from "lucide-react";
import Link from "next/link";
import { GITHUB_RELEASES_URL } from "@/lib/env";
import { buttonPrimary, buttonSecondary } from "@/lib/styles";

const FEATURES = [
  {
    icon: Timer,
    title: "Log every session",
    body: "The Chrome extension runs a pausable timer on LeetCode and captures each submission: code, runtime and memory percentiles, and the distribution graph.",
  },
  {
    icon: Video,
    title: "Show your work",
    body: "Attach a demo video to a session and publish a post your followers can watch, replay and learn from.",
  },
  {
    icon: Bot,
    title: "AI-graded mock interviews",
    body: "Run a mock interview in the desktop app. Get scored on communication, problem solving, code quality, speed and correctness, with timestamped moments.",
  },
] as const;

export function Landing() {
  return (
    <div className="py-10 sm:py-16">
      <section className="lare-reveal max-w-xl">
        <Wordmark className="text-2xl text-zinc-50" markClassName="size-8" />
        <h1 className="mt-8 text-4xl font-medium tracking-tight text-zinc-50 sm:text-5xl">
          Hevy for LeetCode
        </h1>
        <p className="mt-4 text-base text-zinc-400 sm:text-lg">
          Track your practice like a workout. Log sessions, share the solve, follow friends and see
          how everyone is progressing.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/login" className={buttonPrimary}>
            Sign in
          </Link>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonSecondary}
          >
            <Puzzle className="size-4" />
            Get the extension
          </a>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonSecondary}
          >
            <Download className="size-4" />
            Download the desktop app
          </a>
        </div>
      </section>

      <ol className="mt-16 divide-y divide-zinc-800 border-y border-zinc-800">
        {FEATURES.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="flex gap-4 py-6">
            <span className="w-6 shrink-0 pt-1 font-mono text-xs tabular-nums text-zinc-600">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-medium text-zinc-100">
                <Icon className="size-4 shrink-0" aria-hidden />
                {title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
