import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let query = "";
        try {
          const body = (await request.json()) as { query?: unknown };
          query = typeof body.query === "string" ? body.query : "";
        } catch {
          return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
        }
        if (!query.trim()) {
          return Response.json(
            { ok: false, error: "Paste a username, profile link, or a public post / reel link." },
            { status: 400 },
          );
        }
        if (query.length > 8000) {
          return Response.json({ ok: false, error: "That paste is too long." }, { status: 400 });
        }
        const { resolveInstagramQuery } = await import("@/lib/instagram/fetch.server");
        const result = await resolveInstagramQuery(query);
        return Response.json(result);
      },
    },
  },
});
