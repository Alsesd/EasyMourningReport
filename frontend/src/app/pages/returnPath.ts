/** Where to go after sign-in: the page the user was sent away from, if it is a same-site path. */
export function returnPath(state: unknown): string | null {
  const from = (state as { from?: { pathname?: string; search?: string } } | null)?.from;
  if (!from?.pathname || from.pathname === "/" || from.pathname.startsWith("/login")) return null;
  // Only same-site paths: "//host" and "/\\host" would be read as another origin.
  if (!from.pathname.startsWith("/") || from.pathname.startsWith("//") || from.pathname.includes("\\")) return null;
  return from.pathname + (from.search ?? "");
}
