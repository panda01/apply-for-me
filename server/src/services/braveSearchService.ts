/**
 * Service module wrapping the Brave Search Web API.
 *
 * Used by the application-URL resolver to find candidate company-site pages
 * for jobs whose original Indeed/LinkedIn apply button does not redirect off
 * platform. A single API key is read from BRAVE_SEARCH_API_KEY in .env.
 *
 * Brave docs: https://brave.com/search/api/
 *   Endpoint: https://api.search.brave.com/res/v1/web/search
 *   Auth: X-Subscription-Token header
 *   Free tier (2026): ~2000 queries/month.
 */

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/**
 * Maximum number of candidate results to return per query. The resolver only
 * needs the top handful — beyond that the results drift toward unrelated
 * pages and just add latency to the analyze-each-candidate loop.
 */
const DEFAULT_RESULT_LIMIT = 10;

/**
 * Per-request timeout (ms) for the Brave API. Brave normally responds in
 * <1s; we cap at 8s so a slow/blocked call doesn't stall the whole resolver.
 */
const BRAVE_REQUEST_TIMEOUT_MS = 8000;

/**
 * A single web-search result. Only the fields the resolver needs are kept;
 * Brave's response includes a lot more (favicons, language, etc.) which we
 * intentionally drop here to keep the surface area small.
 */
export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

/**
 * Raw shape of the Brave Search Web API response we care about. The full API
 * returns many more fields; we use a structural type covering only what we
 * read so test mocks don't need to recreate the entire response envelope.
 */
interface BraveSearchApiResponse {
  web?: {
    results?: {
      title?: string;
      url?: string;
      description?: string;
    }[];
  };
}

/**
 * Reads the Brave Search API key from the environment, throwing a clear error
 * when missing so the caller route can surface a 500 with a useful message.
 * @returns {string} The configured API key
 */
function getBraveApiKey(): string {
  const apiKey = process.env["BRAVE_SEARCH_API_KEY"];
  const isMissingKey = apiKey === undefined || apiKey.length === 0;
  if (isMissingKey) {
    throw new Error("BRAVE_SEARCH_API_KEY env var is not set. Add it to .env to enable application-URL resolution.");
  }
  return apiKey;
}

/**
 * Performs a Brave web search and returns the top results, capped at the
 * supplied limit. Filters out results whose URL is not a valid http(s) URL
 * (Brave occasionally returns relative or malformed entries).
 *
 * @param {string} query - The free-text web-search query (e.g. "Acme Corp Senior Software Engineer")
 * @param {number} [limit] - Maximum number of results to return; defaults to DEFAULT_RESULT_LIMIT
 * @returns {Promise<BraveSearchResult[]>} The result list, possibly empty
 * @throws {Error} If BRAVE_SEARCH_API_KEY is missing, the API call times out, or Brave returns a non-2xx status
 */
export async function searchWeb(query: string, limit: number = DEFAULT_RESULT_LIMIT): Promise<BraveSearchResult[]> {
  const apiKey = getBraveApiKey();

  const trimmedQuery = query.trim();
  const isEmptyQuery = trimmedQuery.length === 0;
  if (isEmptyQuery) {
    throw new Error("searchWeb requires a non-empty query");
  }

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("count", String(limit));

  // AbortSignal.timeout fires after BRAVE_REQUEST_TIMEOUT_MS without needing a
  // separate AbortController + setTimeout arrow; the signal aborts itself.
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(BRAVE_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`Brave Search request failed: ${errorMessage}`);
    // Attach the original as `cause` so the lint rule preserve-caught-error is
    // satisfied and any downstream consumer can introspect the underlying failure.
    // Set post-construction since the Error options bag landed in ES2022 and
    // this project's server tsconfig targets ES2020.
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }

  const isNotOk = !response.ok;
  if (isNotOk) {
    throw new Error(`Brave Search API returned ${String(response.status)} ${response.statusText}`);
  }

  const body = await response.json() as BraveSearchApiResponse;
  const rawResults = body.web?.results ?? [];

  const validResults: BraveSearchResult[] = [];
  for (const entry of rawResults) {
    const hasRequiredFields =
      typeof entry.title === "string" && entry.title.length > 0 &&
      typeof entry.url === "string" && entry.url.length > 0 &&
      URL.canParse(entry.url) &&
      (entry.url.startsWith("http://") || entry.url.startsWith("https://"));
    if (!hasRequiredFields) continue;
    validResults.push({
      title: entry.title!,
      url: entry.url!,
      description: typeof entry.description === "string" ? entry.description : "",
    });
  }

  return validResults;
}
