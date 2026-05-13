/**
 * Frontend API service for the managed Docker containers backend.
 */
import { requestJson } from "./httpClient";

export interface ManagedContainerResponse {
  id: number;
  name: string;
  dockerId: string;
  hostPort: number;
  wgConfigName: string | null;
  status: string;
  created_date: string;
}

export interface ManagedContainerHealthResponse {
  status: string;
  name: string;
}

/**
 * Fetches all managed containers, ordered by created_date descending.
 * @returns {Promise<ManagedContainerResponse[]>} Array of managed container records
 * @throws {Error} If the API request fails
 */
export async function listManagedContainers(): Promise<ManagedContainerResponse[]> {
  return requestJson<ManagedContainerResponse[]>(
    "/api/managed-containers",
    undefined,
    "Failed to fetch managed containers"
  );
}

/**
 * Fetches a single managed container by id.
 * @param {number} id - The id of the managed container
 * @returns {Promise<ManagedContainerResponse>} The managed container record
 * @throws {Error} If the API request fails or the record is not found
 */
export async function getManagedContainer(id: number): Promise<ManagedContainerResponse> {
  return requestJson<ManagedContainerResponse>(
    `/api/managed-containers/${String(id)}`,
    undefined,
    "Failed to fetch managed container"
  );
}

/**
 * Spawns a new managed Docker container with an auto-generated name.
 * @returns {Promise<ManagedContainerResponse>} The newly created managed container record
 * @throws {Error} If the API request fails
 */
export async function createManagedContainer(): Promise<ManagedContainerResponse> {
  return requestJson<ManagedContainerResponse>(
    "/api/managed-containers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
    "Failed to create managed container"
  );
}

/**
 * Stops and removes the underlying Docker container, then deletes the record.
 * @param {number} id - The id of the managed container to delete
 * @returns {Promise<ManagedContainerResponse>} The deleted record
 * @throws {Error} If the API request fails
 */
export async function deleteManagedContainer(id: number): Promise<ManagedContainerResponse> {
  return requestJson<ManagedContainerResponse>(
    `/api/managed-containers/${String(id)}`,
    { method: "DELETE" },
    "Failed to delete managed container"
  );
}

/**
 * Pings the health endpoint of a managed container by id (proxied through the backend).
 * @param {number} id - The id of the managed container to ping
 * @returns {Promise<ManagedContainerHealthResponse>} The container's health response
 * @throws {Error} If the API request fails or the container is unreachable
 */
export async function pingManagedContainerHealth(id: number): Promise<ManagedContainerHealthResponse> {
  return requestJson<ManagedContainerHealthResponse>(
    `/api/managed-containers/${String(id)}/health`,
    undefined,
    "Container health check failed"
  );
}

export interface AnalyzeResponse {
  is_job_description: boolean;
  apply_button_present: boolean;
  description_signals: string[];
  reasoning: string;
  screenshot_b64: string;
}

/**
 * Asks the managed container to analyze a URL with the Claude tool-calling agent.
 * Returns a structured verdict + base64 screenshot. On failure, throws an Error
 * whose message is the server's error string when available so the UI can render it verbatim.
 * @param {number} id - The id of the managed container that should perform the analysis
 * @param {string} url - The URL to analyze
 * @param {boolean} [useProxy] - When true, route the request through Smartproxy residential exits instead of the default WireGuard egress (needed for Cloudflare-blocked sites like Indeed)
 * @returns {Promise<AnalyzeResponse>} The agent's verdict, signals, reasoning, and screenshot
 * @throws {Error} If the response is not ok, with the server's error message or a fallback
 */
export async function analyzeUrl(id: number, url: string, useProxy = false): Promise<AnalyzeResponse> {
  return requestJson<AnalyzeResponse>(
    `/api/managed-containers/${String(id)}/analyze`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, useProxy }),
    },
    "Failed to analyze URL"
  );
}

/**
 * Captures a full-page screenshot of the given URL by proxying through the managed
 * container. Returns the raw image bytes as a Blob so callers can render them via
 * URL.createObjectURL. By default the container fetches the page through its
 * WireGuard tunnel; pass `useProxy: true` to route through Smartproxy residential
 * exits (necessary for Cloudflare-blocked sites). On failure, throws an Error
 * whose message is the server-provided error string when available (e.g. the
 * Playwright failure reason), so the UI can show it verbatim.
 * @param {number} id - The id of the managed container that should perform the capture
 * @param {string} url - The URL to render and screenshot
 * @param {boolean} [useProxy] - When true, route the request through Smartproxy
 * @returns {Promise<Blob>} A Blob containing the image/png response bytes
 * @throws {Error} If the response is not ok, with the server's error message or a fallback
 */
export async function captureScreenshot(id: number, url: string, useProxy = false): Promise<Blob> {
  const response = await fetch(`/api/managed-containers/${String(id)}/screenshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, useProxy }),
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    let errorBody: { error?: string } = {};
    try {
      errorBody = await response.json() as { error?: string };
    } catch {
      // Response had no readable JSON body — fall through to default message.
    }
    throw new Error(errorBody.error ?? "Failed to capture screenshot");
  }

  return response.blob();
}
