import { GLOSSARY } from "@/lib/glossary";

/**
 * Wraps a technical term in `<abbr>` with the plain-English definition
 * shown as a native browser tooltip on hover. Dotted underline signals
 * "hover for more". Zero JS.
 *
 * Usage:
 *   <Term>ACB</Term>                  // looks up "ACB" in GLOSSARY
 *   <Term term="ACB">Avg cost</Term>  // displays "Avg cost", tooltip is for "ACB"
 */
export function Term({
  children,
  term,
  className = "",
}: {
  children: React.ReactNode;
  /** Glossary key. Defaults to children when it's a string. */
  term?: string;
  className?: string;
}) {
  const key = term ?? (typeof children === "string" ? children : null);
  const definition = key ? lookup(key) : undefined;
  if (!definition) {
    // Unknown term — render plain so a bad lookup doesn't break layout.
    return <span className={className}>{children}</span>;
  }
  return (
    <abbr
      title={definition}
      className={`cursor-help underline decoration-dotted decoration-muted-2 underline-offset-2 ${className}`}
    >
      {children}
    </abbr>
  );
}

// Case-insensitive lookup so callers don't have to match glossary key casing
// exactly (e.g. `<Term>unrealized</Term>` resolves to "Unrealized"). Keys with
// punctuation/spaces still need to match those exactly.
const GLOSSARY_LC: Record<string, string> = Object.fromEntries(
  Object.entries(GLOSSARY).map(([k, v]) => [k.toLowerCase(), v]),
);

function lookup(key: string): string | undefined {
  return GLOSSARY[key] ?? GLOSSARY_LC[key.toLowerCase()];
}
