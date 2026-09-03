import { Bot, Download, Puzzle, Timer, Video } from "lucide-react";
import Link from "next/link";
import { GITHUB_RELEASES_URL } from "@/lib/env";
import { buttonPrimary, buttonSecondary, cardClass } from "@/lib/styles";

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
    <div className="py-8 sm:py-16">
      <section className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-amber-400">Lare</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
          Hevy for LeetCode
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-zinc-400 sm:text-lg">
          Track your practice like a workout. Log sessions, share the solve, follow friends and see
          how everyone is progressing.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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

      <section className="mt-14 grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className={`${cardClass} p-5`}>
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
              <Icon className="size-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold text-zinc-100">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
