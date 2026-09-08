"use client";

import { Wordmark } from "@lare/ui/brand";
import { cn } from "@lare/ui/cn";
import { buttonClass, Container } from "@lare/ui/primitives";
import { House, LogIn, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AvatarMenu } from "./avatar-menu";

export interface SiteViewer {
  id: string;
  avatarUrl: string | null;
  displayName: string | null;
  handle: string | null;
}

export function SiteChrome({ viewer, pending }: { viewer: SiteViewer | null; pending: number }) {
  const pathname = usePathname();
  const onLogin = pathname === "/login";

  return (
    <>
      <header className="lare-material-regular sticky top-0 z-30">
        <Container width="wide" className="flex h-12 items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <Link href="/" className="text-lg text-[var(--text)]">
              <Wordmark markClassName="size-5" />
            </Link>
            {viewer ? (
              <nav className="hidden items-center gap-4 text-sm text-[var(--text-tertiary)] md:flex">
                <NavLink href="/" current={pathname === "/"}>
                  Feed
                </NavLink>
                <NavLink href="/friends" current={pathname.startsWith("/friends")}>
                  Friends
                  {pending > 0 ? <Count>{pending}</Count> : null}
                </NavLink>
              </nav>
            ) : null}
          </div>

          {viewer ? (
            <AvatarMenu
              avatarUrl={viewer.avatarUrl}
              displayName={viewer.displayName}
              handle={viewer.handle}
            />
          ) : onLogin ? null : (
            <Link
              href="/login"
              className={cn(buttonClass("primary", "sm"), "hidden md:inline-flex")}
            >
              Sign in
            </Link>
          )}
        </Container>
        {/* Fades the header material into the page. Must not also carry
            `.lare-edge` — that masks bottom-up, and being the later rule it
            would win and leave a hard-edged band under the header. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-full h-5 bg-[var(--lare-material-regular)] [mask-image:linear-gradient(to_bottom,#000,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000,transparent)]"
        />
      </header>

      <nav
        aria-label="Mobile"
        className="lare-material-regular fixed inset-x-0 bottom-0 z-30 border-t border-[color-mix(in_oklab,var(--border)_50%,transparent)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-stretch">
          <MobileItem href="/" label="Feed" icon={House} current={pathname === "/"} />
          <MobileItem
            href="/friends"
            label="Friends"
            icon={Users}
            current={pathname.startsWith("/friends")}
            badge={viewer ? pending : undefined}
          />
          {viewer ? null : (
            <MobileItem href="/login" label="Sign in" icon={LogIn} current={onLogin} />
          )}
        </div>
      </nav>
    </>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 hover:text-[var(--text)]",
        current && "text-[var(--text)]",
      )}
    >
      {children}
    </Link>
  );
}

function Count({ children }: { children: number }) {
  return (
    <span className="lare-badge-pop inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[var(--accent-fg)]">
      {children > 99 ? "99+" : children}
    </span>
  );
}

function MobileItem({
  href,
  label,
  icon: Icon,
  current,
  badge,
}: {
  href: string;
  label: string;
  icon: typeof House;
  current: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
        current ? "text-[var(--text)]" : "text-[var(--text-tertiary)]",
      )}
    >
      <span className="relative">
        <Icon className="size-5" aria-hidden />
        {badge !== undefined && badge > 0 ? (
          <span className="absolute -top-1.5 -right-2.5">
            <Count>{badge}</Count>
          </span>
        ) : null}
      </span>
      {label}
    </Link>
  );
}

export function SiteHeaderFallback() {
  return (
    <header className="lare-material-regular sticky top-0 z-30">
      <Container width="wide" className="flex h-12 items-center">
        <Link href="/" className="text-lg text-[var(--text)]">
          <Wordmark markClassName="size-5" />
        </Link>
      </Container>
    </header>
  );
}
