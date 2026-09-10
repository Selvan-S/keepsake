export function proxiedMediaUrl(src: string, downloadName?: string): string {
  const params = new URLSearchParams({ u: src });
  if (downloadName) params.set("name", downloadName);
  return `/api/media?${params.toString()}`;
}

export function isAllowedMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.endsWith(".cdninstagram.com") ||
    host === "cdninstagram.com" ||
    host.endsWith(".fbcdn.net") ||
    host === "fbcdn.net" ||
    host.endsWith(".cdninstagram.net")
  );
}
