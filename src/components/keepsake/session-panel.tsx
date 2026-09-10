import { useState } from "react";
import { KeyRound, LoaderCircle, LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SessionApi } from "@/hooks/use-session";

const STEPS = [
  "Install Firefox for Android, or Quetta — both support real extensions. Not Kiwi: it was archived in January 2025.",
  "From the official add-on store, install a reputable open-source cookie extension such as Cookie-Editor.",
  "Log in to instagram.com in that browser. Expect a one-time new-device check.",
  "Open the extension on instagram.com and copy sessionid, ds_user_id and csrftoken.",
  "Paste them below, then clear your clipboard.",
];

export function SessionPanel({ session }: { session: SessionApi }) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [dsUserId, setDsUserId] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [userAgent, setUserAgent] = useState("");

  /** Clear the inputs the moment they are no longer needed. */
  const clearFields = () => {
    setSessionId("");
    setDsUserId("");
    setCsrfToken("");
    setUserAgent("");
  };

  const submit = async () => {
    const ok = await session.signIn({ sessionId, dsUserId, csrfToken, userAgent });
    // Wipe on success, and on failure too: leaving a rejected sessionid sitting
    // in a form field serves nobody.
    clearFields();
    if (ok) setOpen(false);
  };

  if (session.authenticated) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
        <KeyRound className="size-4 text-muted" />
        <p className="flex-1 text-sm text-muted">
          Signed in as <span className="text-fg">@{session.username}</span> — stories and highlights
          from accounts this login can already see will now load.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void session.signOut()}
          disabled={session.busy}
        >
          {session.busy ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl bg-bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
      <button
        type="button"
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <KeyRound className="size-4 shrink-0 text-muted" />
        <span className="flex-1 text-sm text-muted">
          Optional: sign in to load stories and highlights
        </span>
        <span className="text-xs text-subtle">{open ? "Hide" : "Set up"}</span>
      </button>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-[color-mix(in_srgb,currentColor_12%,transparent)] pt-4">
          <div className="flex gap-3 rounded-lg bg-bg-subtle px-3 py-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted" />
            <div className="space-y-2 text-xs leading-relaxed text-muted">
              <p>
                <span className="text-fg">Use a secondary account.</span> Scraping with a session
                cookie is against Instagram&rsquo;s terms and is the pattern their automated-access
                detection weights most heavily. Do not point this at an account you cannot lose.
              </p>
              <p>
                This does <span className="text-fg">not</span> unlock private accounts you do not
                already follow. It unlocks what that login can already see in a browser — mainly
                stories and highlights, which need a login even for public accounts.
              </p>
              <p>
                Keepsake never sees your password: you log in with your own browser and paste only
                the resulting cookies. They are held in this local server&rsquo;s memory, never
                written to disk, and lost when it restarts. The cookie extension you install can
                read cookies for every site — install only a well-known open-source one from the
                official store.
              </p>
            </div>
          </div>

          <ol className="space-y-1.5 text-xs leading-relaxed text-muted">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="tabular-nums text-subtle">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <div className="space-y-2">
            <Field label="sessionid" value={sessionId} onChange={setSessionId} />
            <Field label="ds_user_id" value={dsUserId} onChange={setDsUserId} />
            <Field label="csrftoken" value={csrfToken} onChange={setCsrfToken} />
            <Field
              label="User-Agent (optional)"
              value={userAgent}
              onChange={setUserAgent}
              hint="Paste the User-Agent of the browser you logged in with. Without it, requests claim to be a Pixel 8, which contradicts the real login device."
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void submit()} disabled={session.busy}>
              {session.busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Verify and save
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={clearFields}>
              Clear
            </Button>
          </div>
          <p className="text-xs text-subtle">
            The cookies are checked against Instagram before they are kept. Clear your clipboard
            afterwards.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-subtle">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Treated as a secret: no autofill, no spellcheck, no autocapitalise,
        // and never persisted by the browser.
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn("mt-1 h-10 font-mono text-xs")}
      />
      {hint ? <span className="mt-1 block text-xs leading-relaxed text-subtle">{hint}</span> : null}
    </label>
  );
}
