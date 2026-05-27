/**
 * Gmail message reader used by the inbox-discovery feature. Wraps Gmail's
 * REST API and exposes a project-shaped surface that hides token handling
 * (via gmailConnectionService.getValidAccessToken) and Gmail-specific
 * concerns (pagination, base64url body decoding, retry on 401).
 *
 * Implementation of Unit A1 of the parallel fan-out; every dependent unit
 * (A3, B, C) imports from here during the prelude.
 */

import prisma from "../prismaClient.js";
import { getValidAccessToken } from "./gmailConnectionService.js";
import type { GmailMessageSummary } from "./inboxTypes.js";

/**
 * Hard cap on the number of message ids `listJobKeywordMessages` will return
 * per scan. Acts as a cost guardrail since each id costs one downstream
 * `messages.get` call plus one Claude extraction. Even when Gmail says there
 * are more pages, we stop once we have this many.
 */
const MAX_MESSAGE_IDS_PER_SCAN = 200;

/**
 * Maximum page size Gmail allows per `users.messages.list` call. We request
 * the maximum so a typical scan finishes in one page; pagination only kicks
 * in when the user has more than 100 keyword matches in the window.
 */
const GMAIL_LIST_PAGE_SIZE = 100;

/**
 * Keyword group OR'd together to form the Gmail search. Centralized so the
 * test can assert the exact query Gmail receives and so adding/removing a
 * keyword is a one-line change. Order matters only for readability — Gmail
 * treats `OR` commutatively.
 */
const JOB_KEYWORDS: readonly string[] = [
  "job",
  "jobs",
  "hiring",
  "career",
  "careers",
  "position",
  "opportunity",
  "opening",
  "recruiter",
];

/**
 * Shape of the JSON Gmail returns from `users.messages.list`. Only the fields
 * we actually read are declared; Gmail returns more (e.g. `resultSizeEstimate`)
 * that we ignore.
 */
interface GmailMessagesListResponse {
  messages?: { id: string; threadId?: string }[];
  nextPageToken?: string;
}

/**
 * Shape of a single body part inside Gmail's `messages.get?format=full`
 * response. Parts can be nested via `parts`, so this type is recursive.
 */
interface GmailMessagePart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

/**
 * Shape of the JSON Gmail returns from `users.messages.get?format=full`.
 * Only the fields we read are declared.
 */
interface GmailMessageGetResponse {
  id: string;
  threadId?: string;
  snippet?: string;
  payload?: GmailMessagePart;
}

/**
 * Formats a Date as `YYYY/MM/DD` in UTC for use in Gmail's `after:` operator.
 * Gmail accepts other formats too, but YYYY/MM/DD is the documented one and
 * the easiest to assert against in tests.
 *
 * @param {Date} date - The lower-bound date to format
 * @returns {string} The date as `YYYY/MM/DD` (UTC)
 */
function formatDateForGmailAfter(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * Builds the full Gmail search query string used by `listJobKeywordMessages`.
 * Returned unencoded; the caller is responsible for URL-encoding it before
 * placing it in the query string.
 *
 * @param {Date} sinceDate - Lower-bound on received-at (used in `after:` clause)
 * @returns {string} The unencoded Gmail query string
 */
function buildJobKeywordQuery(sinceDate: Date): string {
  const keywordGroup = JOB_KEYWORDS.join(" OR ");
  const afterClause = `after:${formatDateForGmailAfter(sinceDate)}`;
  return `(${keywordGroup}) ${afterClause}`;
}

/**
 * Translates a Gmail API non-2xx response into the error message the rest of
 * the system expects. 401s carry the special "reconnect" message because the
 * UI surfaces it as an actionable banner; everything else is reported with
 * status + raw body so callers can debug.
 *
 * @param {Response} response - The fetch Response (already non-2xx)
 * @returns {Promise<never>} Always throws — return type is `never`
 */
async function throwForGmailError(response: Response): Promise<never> {
  const isAuthorizationFailure = response.status === 401;
  if (isAuthorizationFailure) {
    throw new Error("Gmail authorization expired or revoked — reconnect at /integrations");
  }
  const responseBody = await response.text();
  throw new Error(`Gmail API error: ${String(response.status)} ${responseBody}`);
}

/**
 * Returns the id of the first (oldest-by-created_date) GmailConnection row.
 * Used by the inbox scanner since the page is single-account in v1.
 *
 * TODO: a future account-switcher will replace this helper with an explicit
 * connection-id parameter on the scan endpoint.
 *
 * @returns {Promise<number>} The connection id to scan against
 * @throws {Error} When no GmailConnection rows exist
 */
export async function getFirstConnectionId(): Promise<number> {
  const oldestConnection = await prisma.gmailConnection.findFirst({
    orderBy: { created_date: "asc" },
  });
  const hasNoConnection = oldestConnection === null;
  if (hasNoConnection) {
    throw new Error("No Gmail account connected — connect one at /integrations first");
  }
  return oldestConnection.id;
}

/**
 * Runs the Gmail keyword search and returns every matched message id within
 * the given time window. The query is constructed from a fixed keyword set
 * (job, hiring, career, position, opportunity, opening, recruiter) plus an
 * `after:` date filter. Paginated server-side via `pageToken`, capped at
 * MAX_MESSAGE_IDS_PER_SCAN total per scan (cost guardrail).
 *
 * @param {number} connectionId - GmailConnection id whose access token will be used
 * @param {Date} sinceDate - The lower bound on email received-at; messages strictly older are excluded
 * @returns {Promise<string[]>} Message ids in chronological-ish order (Gmail's default)
 * @throws {Error} When the access token cannot be refreshed or Gmail returns an error
 */
export async function listJobKeywordMessages(
  connectionId: number,
  sinceDate: Date,
): Promise<string[]> {
  const accessToken = await getValidAccessToken(connectionId);
  const query = buildJobKeywordQuery(sinceDate);
  const encodedQuery = encodeURIComponent(query);

  const collectedMessageIds: string[] = [];
  let nextPageToken: string | undefined;

  do {
    const pageTokenSegment =
      nextPageToken === undefined ? "" : `&pageToken=${encodeURIComponent(nextPageToken)}`;
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
      `?q=${encodedQuery}` +
      `&maxResults=${String(GMAIL_LIST_PAGE_SIZE)}` +
      pageTokenSegment;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const isFailure = !response.ok;
    if (isFailure) {
      await throwForGmailError(response);
    }

    const responseJson = (await response.json()) as GmailMessagesListResponse;
    const pageMessages = responseJson.messages ?? [];
    for (const message of pageMessages) {
      collectedMessageIds.push(message.id);
      const hasReachedCap = collectedMessageIds.length >= MAX_MESSAGE_IDS_PER_SCAN;
      if (hasReachedCap) {
        return collectedMessageIds;
      }
    }
    nextPageToken = responseJson.nextPageToken;
  } while (nextPageToken !== undefined);

  return collectedMessageIds;
}

/**
 * Looks up a header by name (case-insensitive) in a Gmail payload's headers
 * array. Gmail preserves the casing the sender used, so a case-sensitive
 * match would miss e.g. `from` vs `From`.
 *
 * @param {{ name: string; value: string }[] | undefined} headers - The headers array from the payload
 * @param {string} headerName - The header to look up
 * @returns {string | null} The header value, or null when absent
 */
function findHeader(
  headers: { name: string; value: string }[] | undefined,
  headerName: string,
): string | null {
  const lowerCaseTarget = headerName.toLowerCase();
  const safeHeaders = headers ?? [];
  for (const header of safeHeaders) {
    const isMatch = header.name.toLowerCase() === lowerCaseTarget;
    if (isMatch) {
      return header.value;
    }
  }
  return null;
}

/**
 * Parses a Gmail `From` header into a name + address pair. Supports the
 * common `"Display Name" <addr@example.com>` form and the bare
 * `addr@example.com` form. When no angle brackets are present, the whole
 * value is treated as the address and the name is set equal to the address
 * (caller-facing rendering can fall back to the address when no friendlier
 * name is known).
 *
 * @param {string | null} fromHeaderValue - The raw `From` header value (may be null)
 * @returns {{ fromName: string; fromAddress: string }} Normalized name + address
 */
function parseFromHeader(fromHeaderValue: string | null): {
  fromName: string;
  fromAddress: string;
} {
  const isMissingFromHeader = fromHeaderValue === null || fromHeaderValue.trim() === "";
  if (isMissingFromHeader) {
    return { fromName: "", fromAddress: "" };
  }

  const trimmedValue = fromHeaderValue.trim();
  const angleStartIndex = trimmedValue.indexOf("<");
  const angleEndIndex = trimmedValue.lastIndexOf(">");
  const hasAngleBrackets = angleStartIndex !== -1 && angleEndIndex > angleStartIndex;
  if (!hasAngleBrackets) {
    return { fromName: trimmedValue, fromAddress: trimmedValue };
  }

  const rawName = trimmedValue.slice(0, angleStartIndex).trim();
  const fromAddress = trimmedValue.slice(angleStartIndex + 1, angleEndIndex).trim();
  // Strip surrounding double-quotes if the display name was quoted.
  const isQuotedName =
    rawName.length >= 2 && rawName.startsWith("\"") && rawName.endsWith("\"");
  const fromName = isQuotedName ? rawName.slice(1, -1) : rawName;
  return { fromName, fromAddress };
}

/**
 * Decodes a single Gmail base64url-encoded body part into a UTF-8 string.
 * Gmail uses standard base64url (URL-safe alphabet, no padding) so we
 * translate `-`→`+`, `_`→`/`, and re-pad to a multiple of 4 before handing
 * to Node's Buffer.
 *
 * @param {string} base64UrlData - The `body.data` value from a Gmail part
 * @returns {string} The decoded UTF-8 text
 */
function decodeBase64UrlBody(base64UrlData: string): string {
  const standardBase64 = base64UrlData.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (standardBase64.length % 4)) % 4;
  const paddedBase64 = standardBase64 + "=".repeat(paddingNeeded);
  return Buffer.from(paddedBase64, "base64").toString("utf-8");
}

/**
 * Walks the Gmail payload tree depth-first, collecting decoded bodies by
 * mime-type. Multipart messages can nest `text/html` and `text/plain` parts
 * arbitrarily deep (and either type may appear multiple times in
 * forwarded/inlined threads), so we concatenate same-type parts into a
 * single string per type rather than picking just the first match.
 *
 * @param {GmailMessagePart | undefined} payload - The root payload node from messages.get
 * @returns {{ bodyHtml: string | null; bodyText: string | null }} Concatenated bodies (null when absent)
 */
function collectBodiesFromPayload(payload: GmailMessagePart | undefined): {
  bodyHtml: string | null;
  bodyText: string | null;
} {
  const htmlBodyFragments: string[] = [];
  const textBodyFragments: string[] = [];

  /**
   * Recursive walker. Pushes decoded body data into the closure-level
   * fragment arrays based on the part's mime-type. Top-level parts without
   * a mime-type are skipped (we only care about text/html and text/plain).
   *
   * @param {GmailMessagePart | undefined} node - The current part to inspect
   * @returns {void}
   */
  function walk(node: GmailMessagePart | undefined): void {
    const isMissingNode = node === undefined;
    if (isMissingNode) {
      return;
    }

    const mimeType = node.mimeType ?? "";
    const encodedData = node.body?.data;
    const hasEncodedData = encodedData !== undefined && encodedData !== "";

    if (hasEncodedData && mimeType === "text/html") {
      htmlBodyFragments.push(decodeBase64UrlBody(encodedData));
    } else if (hasEncodedData && mimeType === "text/plain") {
      textBodyFragments.push(decodeBase64UrlBody(encodedData));
    }

    const childParts = node.parts ?? [];
    for (const child of childParts) {
      walk(child);
    }
  }

  walk(payload);

  const bodyHtml = htmlBodyFragments.length === 0 ? null : htmlBodyFragments.join("");
  const bodyText = textBodyFragments.length === 0 ? null : textBodyFragments.join("");
  return { bodyHtml, bodyText };
}

/**
 * Fetches the full body + headers of a single Gmail message and returns a
 * normalized projection. Base64url-decodes body parts and concatenates them
 * by mime-type into one HTML string and one plaintext string. Either may be
 * null if the message doesn't include that body type.
 *
 * @param {number} connectionId - GmailConnection id whose access token will be used
 * @param {string} messageId - Gmail message id to fetch
 * @returns {Promise<GmailMessageSummary>} Decoded message ready for the extractor
 * @throws {Error} When the message cannot be fetched, the access token cannot be refreshed, or headers are malformed
 */
export async function fetchMessage(
  connectionId: number,
  messageId: string,
): Promise<GmailMessageSummary> {
  const accessToken = await getValidAccessToken(connectionId);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const isFailure = !response.ok;
  if (isFailure) {
    await throwForGmailError(response);
  }

  const responseJson = (await response.json()) as GmailMessageGetResponse;
  const headers = responseJson.payload?.headers;

  const fromHeaderValue = findHeader(headers, "From");
  const { fromName, fromAddress } = parseFromHeader(fromHeaderValue);

  const subjectHeaderValue = findHeader(headers, "Subject");
  const subject = subjectHeaderValue ?? "";

  const dateHeaderValue = findHeader(headers, "Date");
  const receivedAt = dateHeaderValue === null ? new Date(NaN) : new Date(dateHeaderValue);

  const snippet = responseJson.snippet ?? null;

  const { bodyHtml, bodyText } = collectBodiesFromPayload(responseJson.payload);

  return {
    messageId: responseJson.id,
    threadId: responseJson.threadId ?? null,
    fromName,
    fromAddress,
    subject,
    snippet,
    receivedAt,
    bodyHtml,
    bodyText,
  };
}
