import { createFileRoute } from "@tanstack/react-router";

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "keepsake-media";
}

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("u");
        if (!target) {
          return new Response("Missing media URL", { status: 400 });
        }
        const { fetchRemoteMedia } = await import("@/lib/instagram/fetch.server");
        const response = await fetchRemoteMedia(target);
        if (!response.ok) return response;
        const name = url.searchParams.get("name");
        const headers = new Headers(response.headers);
        if (name) {
          const filename = safeFilename(name);
          headers.set(
            "content-disposition",
            `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          );
        } else {
          headers.set("content-disposition", "inline");
        }
        headers.set("x-content-type-options", "nosniff");
        return new Response(response.body, { status: 200, headers });
      },
    },
  },
});
