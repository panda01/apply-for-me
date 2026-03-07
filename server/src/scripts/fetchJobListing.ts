import "dotenv/config";
import { BrowserUse } from "browser-use-sdk";
import WebSocket from "ws";

/**
 * Standalone script that fetches a LinkedIn job listing by:
 * 1. Creating a cloud browser session via Browser Use SDK
 * 2. Discovering the browser page target via the CDP HTTP endpoint
 * 3. Connecting to the page target via Chrome DevTools Protocol (CDP) WebSocket
 * 4. Injecting the user's LinkedIn cookies for authentication
 * 5. Navigating to the job listing URL
 * 6. Extracting and printing the job details (title, company, description, post date, url)
 *
 * @usage npx tsx server/src/scripts/fetchJobListing.ts "<linkedin_job_url>" "<cookie_string>"
 */

interface JobListing {
  title: string;
  company: string;
  description: string;
  postDate: string;
  url: string;
}

interface CdpResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface CdpTarget {
  id: string;
  type: string;
  webSocketDebuggerUrl: string;
}

/**
 * Sends a CDP command over the WebSocket and waits for the matching response.
 * Times out after 15 seconds if no response is received.
 * @param {WebSocket} ws - The active WebSocket connection to the CDP endpoint
 * @param {string} method - The CDP protocol method to invoke (e.g. "Network.setCookies")
 * @param {Record<string, unknown>} params - The parameters for the CDP command
 * @param {number} commandId - A unique numeric ID to correlate request/response
 * @returns {Promise<CdpResponse>} The CDP response for the given command
 */
function sendCdpCommand(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  commandId: number
): Promise<CdpResponse> {
  const COMMAND_TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const message = JSON.stringify({ id: commandId, method, params });

    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`CDP command timed out: ${method} (id=${commandId})`));
    }, COMMAND_TIMEOUT_MS);

    const onMessage = (data: WebSocket.Data) => {
      const response = JSON.parse(data.toString()) as CdpResponse;
      const isMatchingResponse = response.id === commandId;
      if (isMatchingResponse) {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve(response);
      }
    };

    ws.on("message", onMessage);
    ws.send(message, (err) => {
      if (err) {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        reject(err);
      }
    });
  });
}

/**
 * Waits for a specific CDP event to fire on the WebSocket connection.
 * @param {WebSocket} ws - The active WebSocket connection to the CDP endpoint
 * @param {string} eventName - The CDP event name to wait for (e.g. "Page.loadEventFired")
 * @param {number} timeoutMs - Maximum time to wait in milliseconds before rejecting
 * @returns {Promise<void>} Resolves when the event fires
 */
function waitForCdpEvent(ws: WebSocket, eventName: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out waiting for CDP event: ${eventName}`));
    }, timeoutMs);

    const onMessage = (data: WebSocket.Data) => {
      const parsed = JSON.parse(data.toString()) as { method?: string };
      const isTargetEvent = parsed.method === eventName;
      if (isTargetEvent) {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve();
      }
    };

    ws.on("message", onMessage);
  });
}

/**
 * Parses a raw cookie header string into an array of CDP-compatible cookie objects.
 * Each cookie object includes the name, value, domain, and path required by
 * the Network.setCookies CDP command.
 * @param {string} cookieString - A semicolon-separated cookie string (e.g. "name=value; name2=value2")
 * @param {string} domain - The domain to associate with each cookie (e.g. ".linkedin.com")
 * @returns {Array<{name: string, value: string, domain: string, path: string}>} Parsed cookie objects
 */
function parseCookies(cookieString: string, domain: string) {
  return cookieString.split(";").map((cookie) => {
    const trimmedCookie = cookie.trim();
    const equalsIndex = trimmedCookie.indexOf("=");
    const name = trimmedCookie.substring(0, equalsIndex);
    const value = trimmedCookie.substring(equalsIndex + 1);
    return { name, value, domain, path: "/" };
  });
}

/**
 * Discovers the first page target from the CDP HTTP endpoint and returns
 * its WebSocket debugger URL for direct page-level CDP control.
 * @param {string} cdpBaseUrl - The base CDP URL (e.g. "https://session-id.cdp2.browser-use.com")
 * @returns {Promise<string>} The WebSocket debugger URL for the page target
 */
async function discoverPageTarget(cdpBaseUrl: string): Promise<string> {
  const response = await fetch(`${cdpBaseUrl}/json/list`);
  const targets = await response.json() as CdpTarget[];

  const pageTarget = targets.find((target) => target.type === "page");
  const hasNoPageTarget = !pageTarget;
  if (hasNoPageTarget) {
    throw new Error("No page target found in the browser session");
  }

  return pageTarget.webSocketDebuggerUrl;
}

/**
 * Connects to the CDP WebSocket URL and returns the open WebSocket connection.
 * Times out after 15 seconds if the connection cannot be established.
 * @param {string} wsUrl - The WebSocket debugger URL for a CDP target
 * @returns {Promise<WebSocket>} The connected WebSocket instance
 */
function connectToCdp(wsUrl: string): Promise<WebSocket> {
  const CONNECTION_TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error(`CDP connection timed out after ${CONNECTION_TIMEOUT_MS}ms`));
    }, CONNECTION_TIMEOUT_MS);

    ws.on("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to CDP: ${err.message}`));
    });
  });
}

/**
 * Extracts job listing details from the currently loaded LinkedIn page
 * by evaluating JavaScript in the browser context via CDP Runtime.evaluate.
 * @param {WebSocket} ws - The active WebSocket connection to the CDP endpoint
 * @param {number} startId - The starting command ID for CDP requests
 * @param {string} jobUrl - The original job listing URL
 * @returns {Promise<JobListing>} The extracted job listing details
 */
async function extractJobDetails(ws: WebSocket, startId: number, jobUrl: string): Promise<JobListing> {
  const extractionScript = `
    (() => {
      const title = document.querySelector('.top-card-layout__title, .job-details-jobs-unified-top-card__job-title, h1')?.textContent?.trim() || '';
      const company = document.querySelector('.topcard__org-name-link, .job-details-jobs-unified-top-card__company-name, .top-card-layout__second-subline a')?.textContent?.trim() || '';
      const description = document.querySelector('.description__text, .jobs-description__content, .show-more-less-html__markup')?.textContent?.trim() || '';
      const postDate = document.querySelector('.posted-time-ago__text, .job-details-jobs-unified-top-card__primary-description-container span, time')?.textContent?.trim() || '';
      return JSON.stringify({ title, company, description, postDate });
    })()
  `;

  const evalResponse = await sendCdpCommand(ws, "Runtime.evaluate", {
    expression: extractionScript,
    returnByValue: true,
  }, startId);

  const resultValue = evalResponse.result as { result?: { value?: string } } | undefined;
  const rawJson = resultValue?.result?.value;

  const hasNoResult = !rawJson;
  if (hasNoResult) {
    throw new Error("Failed to extract job details from the page");
  }

  const parsed = JSON.parse(rawJson) as Omit<JobListing, "url">;
  return { ...parsed, url: jobUrl };
}

/**
 * Main function that orchestrates the entire job listing fetch workflow:
 * validates arguments, creates a cloud browser, discovers the page target,
 * injects cookies, navigates to the LinkedIn job page, extracts details, and prints them.
 */
async function main() {
  const jobUrl = process.argv[2];
  const cookieString = process.argv[3];

  const isMissingArguments = !jobUrl || !cookieString;
  if (isMissingArguments) {
    console.error("Usage: npx tsx server/src/scripts/fetchJobListing.ts <linkedin_job_url> <cookie_string>");
    process.exit(1);
  }

  const apiKey = process.env["BROWSER_USE_API"];
  const isMissingApiKey = !apiKey;
  if (isMissingApiKey) {
    console.error("Error: BROWSER_USE_API environment variable is not set. Add it to your .env file.");
    process.exit(1);
  }

  const client = new BrowserUse({ apiKey });
  let browserSessionId: string | undefined;

  try {
    console.log("Creating cloud browser session...");
    const browserSession = await client.browsers.create();
    browserSessionId = browserSession.id;

    const hasNoCdpUrl = !browserSession.cdpUrl;
    if (hasNoCdpUrl) {
      throw new Error("Browser session was created but no CDP URL was returned");
    }

    console.log(`Browser session created: ${browserSession.id}`);
    console.log(`Live URL: ${browserSession.liveUrl ?? "N/A"}`);

    console.log("Discovering page target...");
    const pageWsUrl = await discoverPageTarget(browserSession.cdpUrl!);
    console.log(`Page target WebSocket URL: ${pageWsUrl}`);

    console.log("Connecting to page target via CDP...");
    const ws = await connectToCdp(pageWsUrl);
    console.log("CDP connection established.");
    let commandId = 1;

    await sendCdpCommand(ws, "Network.enable", {}, commandId++);
    await sendCdpCommand(ws, "Page.enable", {}, commandId++);

    console.log("Setting cookies...");
    const cookieDomain = `.${new URL(jobUrl).hostname.split(".").slice(-2).join(".")}`;
    const cookies = parseCookies(cookieString, cookieDomain);
    await sendCdpCommand(ws, "Network.setCookies", { cookies }, commandId++);

    console.log(`Navigating to: ${jobUrl}`);
    const loadEventPromise = waitForCdpEvent(ws, "Page.loadEventFired", 30000);
    await sendCdpCommand(ws, "Page.navigate", { url: jobUrl }, commandId++);
    await loadEventPromise;

    console.log("Page loaded. Waiting for content to render...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log("Extracting job details...");
    const jobListing = await extractJobDetails(ws, commandId++, jobUrl);

    console.log("\n========== Job Listing Details ==========");
    console.log(`Title:       ${jobListing.title}`);
    console.log(`Company:     ${jobListing.company}`);
    console.log(`Post Date:   ${jobListing.postDate}`);
    console.log(`URL:         ${jobListing.url}`);
    console.log(`\nDescription:\n${jobListing.description}`);
    console.log("==========================================\n");

    ws.close();
  } finally {
    const hasBrowserSession = !!browserSessionId;
    if (hasBrowserSession) {
      console.log("Stopping browser session...");
      await client.browsers.stop(browserSessionId!);
      console.log("Browser session stopped.");
    }
  }
}

main().catch((err: Error) => {
  console.error("Error:", err.message);
  process.exit(1);
});
