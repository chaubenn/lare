import { useState } from "react";
import { notifyError } from "@/lib/notices";
import { useAuth } from "./AuthProvider";

/** Sign out from a button: `signingOut` disables it meanwhile, and a failure is shown as a toast. */
export function useSignOut(): { signingOut: boolean; signOut: () => Promise<void> } {
  const auth = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    try {
      await auth.signOut();
    } catch (err) {
      notifyError("Couldn't sign out", err);
      setSigningOut(false);
    }
  };
  return { signingOut, signOut };
}
