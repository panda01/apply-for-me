/**
 * Tiny shared fetch helper used by all frontend API services.
 * Handles JSON parsing, error-body extraction, and a default error message.
 */

/**
 * Fetches a URL and returns the parsed JSON body, throwing a descriptive Error
 * with the API's `error` field (or the provided default) on non-2xx responses.
 * @template T - The expected JSON response shape
 * @param {string} url - The URL to fetch
 * @param {RequestInit | undefined} init - Optional fetch init (method, headers, body, etc.)
 * @param {string} defaultErrorMessage - Fallback message when the API does not return an `error` field
 * @returns {Promise<T>} The parsed JSON body
 * @throws {Error} If the response is not ok, with the API's error message or the default
 */
export async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  defaultErrorMessage: string
): Promise<T> {
  // Call fetch with one or two arguments depending on whether init was provided,
  // so call-site assertions on argument count remain stable for both shapes.
  const response = init === undefined ? await fetch(url) : await fetch(url, init);

  const isNotOk = !response.ok;
  if (isNotOk) {
    let errorBody: { error?: string } = {};
    try {
      errorBody = await response.json() as { error?: string };
    } catch {
      // Response had no readable JSON body — fall through to the default message.
    }
    throw new Error(errorBody.error ?? defaultErrorMessage);
  }

  return response.json() as Promise<T>;
}
