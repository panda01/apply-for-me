/**
 * Reads Smartproxy (residential-proxy) credentials from the container's env
 * and returns a Playwright-compatible proxy config, or null when no creds are
 * configured. The container forwards SMARTPROXY_USERNAME, SMARTPROXY_PASSWORD,
 * and SMARTPROXY_ENDPOINT from the host's .env via dockerContainerService.
 *
 * The endpoint defaults to gate.smartproxy.com:7000, Smartproxy's rotating
 * residential gateway: each request gets a different residential exit IP,
 * which is what we want for the experiment of "does this bypass Cloudflare's
 * datacenter-IP block on Indeed?".
 */

const DEFAULT_SMARTPROXY_ENDPOINT = "http://gate.smartproxy.com:7000";

/**
 * Shape Playwright accepts for the `proxy` option on launch / newContext.
 */
export interface SmartproxyConfig {
  server: string;
  username: string;
  password: string;
}

/**
 * Reads Smartproxy creds from env and returns a proxy config Playwright can
 * accept directly, or null if creds are missing.
 *
 * @returns {SmartproxyConfig | null} Proxy config for Playwright, or null when SMARTPROXY_USERNAME or SMARTPROXY_PASSWORD is unset
 */
export function getSmartproxyConfig(): SmartproxyConfig | null {
  const username = process.env.SMARTPROXY_USERNAME;
  const password = process.env.SMARTPROXY_PASSWORD;
  const isMissingCreds =
    username === undefined || username.length === 0 ||
    password === undefined || password.length === 0;
  if (isMissingCreds) {
    return null;
  }
  const customEndpoint = process.env.SMARTPROXY_ENDPOINT;
  const hasCustomEndpoint = customEndpoint !== undefined && customEndpoint.length > 0;
  const server = hasCustomEndpoint ? customEndpoint : DEFAULT_SMARTPROXY_ENDPOINT;
  return { server, username, password };
}
