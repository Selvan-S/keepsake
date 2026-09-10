import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * A download rendered as a real link rather than a click handler, so the
 * browser's own "save as" affordances (long-press, middle-click, context menu)
 * keep working -- which on a phone is the only reliable route to Photos.
 */
export function SaveLink({
  href,
  name,
  children,
  className,
  variant = "primary",
  size = "sm",
}: {
  href: string;
  name: string;
  children: ReactNode;
  className?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "lg";
}) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={href} download={name} target="_blank" rel="noopener">
        {children}
      </a>
    </Button>
  );
}
