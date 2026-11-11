import { Navigate, Outlet } from "react-router";
import { ErrorState, PageSpinner } from "@/components/ui/States";
import { WindowScreen } from "@/components/ui/WindowScreen";
import { useAuth } from "@/features/auth/AuthProvider";
import { OnboardingPage } from "@/features/auth/OnboardingPage";
import { SetupGate } from "@/features/settings/SetupGate";
import { routes } from "@/lib/routes";

/** Gate: restores the session, forces onboarding until a handle exists, then renders children. */
export function RequireAuth() {
  const { session, profile, profileLoading, profileError, retryProfile } = useAuth();
  // These render without the shell, so they carry their own drag region: a window that cannot be
  // moved while the session is being restored is the worst place to leave someone.
  if (session === undefined)
    return (
      <WindowScreen>
        <PageSpinner label="Restoring your session…" />
      </WindowScreen>
    );
  if (!session) return <Navigate to={routes.login} replace />;
  if (profileLoading)
    return (
      <WindowScreen>
        <PageSpinner label="Loading your profile…" />
      </WindowScreen>
    );
  // Only when there is no profile to show: a background refresh that fails (offline, say) must not
  // throw someone out of the app they were using.
  if (profileError && profile === undefined) {
    return (
      <WindowScreen className="max-w-md">
        <ErrorState
          error={profileError}
          title="Couldn't load your profile"
          onRetry={retryProfile}
        />
      </WindowScreen>
    );
  }
  if (!profile || profile.handle === null) return <OnboardingPage />;
  return (
    <SetupGate>
      <Outlet />
    </SetupGate>
  );
}
