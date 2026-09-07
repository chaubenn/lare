import { buttonClass, Container } from "@lare/ui/primitives";
import Link from "next/link";

export default function NotFound() {
  return (
    <Container width="prose" className="py-16 text-center">
      <p className="lare-label text-[var(--text-tertiary)]">404</p>
      <h1 className="lare-title mt-2 text-[var(--text)]">Page not found</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        The page you're looking for doesn't exist or isn't visible to you.
      </p>
      <Link href="/" className={`${buttonClass("primary")} mt-6`}>
        Back to Lare
      </Link>
    </Container>
  );
}
