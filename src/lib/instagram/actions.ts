import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ResolveResult } from "./types";

const querySchema = z.object({
  query: z.string().trim().min(1, "Enter a URL or username").max(8000),
});

export const resolveInstagram = createServerFn({ method: "POST" })
  .validator((data) => querySchema.parse(data))
  .handler(async ({ data }): Promise<ResolveResult> => {
    const { resolveInstagramQuery } = await import("./fetch.server");
    return resolveInstagramQuery(data.query);
  });
