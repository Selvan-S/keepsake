import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export type SessionState = { authenticated: boolean; username: string | null };

export type SignInInput = {
  sessionId: string;
  dsUserId: string;
  csrfToken: string;
  userAgent?: string;
};

/**
 * The optional signed-in session.
 *
 * Credentials go one way: into the server, which holds them in memory and
 * validates them. Nothing here keeps them in React state beyond the moment of
 * submission, and nothing is written to localStorage -- a secret in browser
 * storage is readable by anything that can run script on this origin, survives
 * far longer than the user expects, and would outlive the "sign out" they
 * think ended it.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>({ authenticated: false, username: null });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/session");
      const data = (await res.json()) as { ok: boolean } & SessionState;
      if (data.ok) setState({ authenticated: data.authenticated, username: data.username });
    } catch {
      // A status check failing is not worth interrupting anyone over; the UI
      // simply keeps showing "signed out".
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (input: SignInInput): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = (await res.json()) as { ok: boolean; error?: string; username?: string };
        if (!data.ok) {
          toast.error(data.error || "Those cookies were not accepted.");
          setState({ authenticated: false, username: null });
          return false;
        }
        setState({ authenticated: true, username: data.username ?? null });
        toast.success(`Signed in as @${data.username}`);
        return true;
      } catch {
        toast.error("Could not reach the local server.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/session", { method: "DELETE" });
      setState({ authenticated: false, username: null });
      toast.success("Signed out. The session cookies are gone from this process.");
    } catch {
      toast.error("Could not reach the local server.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { ...state, busy, signIn, signOut, refresh };
}

export type SessionApi = ReturnType<typeof useSession>;
