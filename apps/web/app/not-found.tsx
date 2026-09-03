import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Page not found</h1>
      <p className="mt-2 text-sm text-zinc-400">
        The page you're looking for doesn't exist or isn't visible to you.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white"
      >
        Back to Lare
      </Link>
    </div>
  );
}
