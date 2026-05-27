/**
 * Sender-domain → label color mapping used by the inbox-discovery UI. The
 * extractor does not call this helper directly — the discovery service does,
 * when it persists DiscoveredJob rows and needs a hex color to render the
 * design's `.email-tag` chip next to each grouped email.
 *
 * Matching is domain-suffix-based so addresses like
 * `noreply@jobs-noreply.linkedin.com` still resolve to LinkedIn's color even
 * though the literal `linkedin.com` is preceded by a subdomain.
 */

/**
 * Lookup table from known recruiting-platform domain suffix to the brand hex
 * color we render in the inbox discovery UI. The order is irrelevant because
 * the lookup is exact-suffix; this object is just the catalog.
 */
const KNOWN_SENDER_DOMAIN_COLORS: Record<string, string> = {
  "linkedin.com": "#0a66c2",
  "wellfound.com": "#21c55d",
  "indeed.com": "#2557a7",
  "ziprecruiter.com": "#1f7da3",
  "glassdoor.com": "#0caa41",
};

/**
 * Extracts the host portion of an email address (the text after the final
 * `@`). Returns an empty string when the input has no `@` — callers treat
 * empty as an unknown domain and the function therefore returns null.
 *
 * @param {string} fromAddress - The raw sender email address (e.g. "noreply@jobs.linkedin.com")
 * @returns {string} The lowercased host portion, or empty when no `@` was present
 */
function extractHostFromAddress(fromAddress: string): string {
  const lastAtSignIndex = fromAddress.lastIndexOf("@");
  const hasAtSign = lastAtSignIndex !== -1;
  if (!hasAtSign) {
    return "";
  }
  const rawHost = fromAddress.slice(lastAtSignIndex + 1);
  return rawHost.toLowerCase().trim();
}

/**
 * Returns the brand hex color for a sender's email address when the address's
 * host matches (by suffix) one of the known recruiting-platform domains. The
 * match is suffix-based on dot-separated host labels so `linkedin.com` matches
 * both `linkedin.com` and `jobs.linkedin.com`, but does NOT match an
 * adversarial host like `linkedin.com.evil.example`.
 *
 * @param {string} fromAddress - The raw sender email address (header `From`)
 * @returns {string | null} The hex color (e.g. "#0a66c2") or null for unknown domains
 */
export function getEmailLabelColor(fromAddress: string): string | null {
  const senderHost = extractHostFromAddress(fromAddress);
  const hasNoHost = senderHost.length === 0;
  if (hasNoHost) {
    return null;
  }
  for (const knownDomain of Object.keys(KNOWN_SENDER_DOMAIN_COLORS)) {
    const isExactMatch = senderHost === knownDomain;
    const isSubdomainMatch = senderHost.endsWith(`.${knownDomain}`);
    if (isExactMatch || isSubdomainMatch) {
      return KNOWN_SENDER_DOMAIN_COLORS[knownDomain] ?? null;
    }
  }
  return null;
}
