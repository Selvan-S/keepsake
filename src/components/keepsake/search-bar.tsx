import { ClipboardPaste, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EXAMPLES = [
  { label: "@nasa", query: "nasa" },
  { label: "profile link", query: "https://www.instagram.com/nasa/" },
  { label: "NASA reel", query: "https://www.instagram.com/reel/Dbn-XJhk0_-/" },
];

export function SearchBar({
  query,
  onQuery,
  onRun,
  onPaste,
  loading,
}: {
  query: string;
  onQuery: (value: string) => void;
  onRun: (value: string) => void;
  onPaste: () => void;
  loading: boolean;
}) {
  return (
    <>
      <form
        className="stagger-in mt-8 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          onRun(query);
        }}
      >
        <label className="sr-only" htmlFor="ig-query">
          Instagram username or URL
        </label>
        <Input
          id="ig-query"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onPaste={(e) => {
            // Pasting a link is the whole interaction, so it runs immediately
            // rather than making the user reach for a second button.
            const text = e.clipboardData.getData("text/plain").trim();
            if (!text) return;
            e.preventDefault();
            onQuery(text);
            onRun(text);
          }}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="@nasa or instagram.com/nasa"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          inputMode="url"
          className="h-12 sm:flex-1"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-12 flex-1 sm:flex-none"
            onClick={onPaste}
            disabled={loading}
          >
            <ClipboardPaste className="size-4" />
            Paste
          </Button>
          <Button type="submit" size="lg" className="h-12 min-w-28 flex-1 sm:flex-none" disabled={loading}>
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {loading ? "Fetching" : "Fetch"}
          </Button>
        </div>
      </form>

      <div className="stagger-in mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-subtle">Try</span>
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            className="h-9 rounded-full px-3 text-xs text-muted shadow-[var(--shadow-border)] transition-[color,box-shadow] duration-150 hover:text-fg hover:shadow-[var(--shadow-border-hover)]"
            onClick={() => {
              onQuery(example.query);
              onRun(example.query);
            }}
          >
            {example.label}
          </button>
        ))}
      </div>
      <p className="stagger-in mt-3 text-xs leading-relaxed text-subtle">
        Private accounts will not load. Live stories only appear when Instagram still serves them. On a
        phone: long-press the box, tap Paste.
      </p>
    </>
  );
}
