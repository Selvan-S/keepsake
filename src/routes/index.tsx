import { createFileRoute } from "@tanstack/react-router";
import { KeepsakeApp } from "@/components/keepsake";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <KeepsakeApp />;
}
