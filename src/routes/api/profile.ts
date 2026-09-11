import { createFileRoute } from "@tanstack/react-router";
import type { ProfileTab } from "@/core/instagram/types";

const TABS: ProfileTab[] = ["posts", "reels", "stories", "highlights"];

export const Route = createFileRoute("/api/profile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let username = "";
        let tab: ProfileTab = "posts";
        let cursor: string | null = null;
        let userId: string | null = null;
        try {
          const body = (await request.json()) as {
            username?: unknown;
            tab?: unknown;
            cursor?: unknown;
            userId?: unknown;
          };
          username = typeof body.username === "string" ? body.username.trim().replace(/^@/, "").toLowerCase() : "";
          if (typeof body.tab === "string" && TABS.includes(body.tab as ProfileTab)) {
            tab = body.tab as ProfileTab;
          }
          cursor = typeof body.cursor === "string" && body.cursor ? body.cursor : null;
          userId = typeof body.userId === "string" && body.userId ? body.userId : null;
        } catch {
          return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
        }
        if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) {
          return Response.json({ ok: false, error: "Enter a valid Instagram username." }, { status: 400 });
        }
        try {
          const { fetchProfileTab } = await import("@/lib/instagram/fetch.server");
          const page = await fetchProfileTab(username, tab, cursor, userId);
          return Response.json({ ok: true, tab, ...page });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not load more from that profile.";
          return Response.json({ ok: false, error: message });
        }
      },
    },
  },
});
