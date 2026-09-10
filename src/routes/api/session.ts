import { createFileRoute } from "@tanstack/react-router";

/**
 * The session setup endpoint.
 *
 * Credentials only ever travel inbound. Nothing here echoes a cookie value
 * back, logs one, or writes one to disk -- the responses carry a boolean and a
 * username, and that is all the UI needs.
 */
export const Route = createFileRoute("/api/session")({
  server: {
    handlers: {
      GET: async () => {
        const { sessionStatus } = await import("@/lib/instagram/fetch.server");
        return Response.json({ ok: true, ...sessionStatus() });
      },

      POST: async ({ request }) => {
        let body: {
          sessionId?: unknown;
          dsUserId?: unknown;
          csrfToken?: unknown;
          userAgent?: unknown;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
        }
        const asText = (value: unknown) => (typeof value === "string" ? value : "");
        const { signIn } = await import("@/lib/instagram/fetch.server");
        const result = await signIn({
          sessionId: asText(body.sessionId),
          dsUserId: asText(body.dsUserId),
          csrfToken: asText(body.csrfToken),
          userAgent: asText(body.userAgent),
        });
        if (!result.ok) {
          // 400, not 401: the caller is the local UI, and this is a rejected
          // paste rather than a challenge to the caller's own credentials.
          return Response.json({ ok: false, error: result.error }, { status: 400 });
        }
        return Response.json({ ok: true, authenticated: true, username: result.username });
      },

      DELETE: async () => {
        const { signOut } = await import("@/lib/instagram/fetch.server");
        return Response.json({ ok: true, ...signOut() });
      },
    },
  },
});
