/**
 * Frontend API service for the managed Docker containers backend.
 */

export interface ManagedContainerResponse {
  id: number;
  name: string;
  dockerId: string;
  hostPort: number;
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
  const response = await fetch("/api/managed-containers");

  const isNotOk = !response.ok;
  if (isNotOk) {
    throw new Error("Failed to fetch managed containers");
  }

  return response.json() as Promise<ManagedContainerResponse[]>;
}

/**
 * Fetches a single managed container by id.
 * @param {number} id - The id of the managed container
 * @returns {Promise<ManagedContainerResponse>} The managed container record
 * @throws {Error} If the API request fails or the record is not found
 */
export async function getManagedContainer(id: number): Promise<ManagedContainerResponse> {
  const response = await fetch(`/api/managed-containers/${id}`);

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to fetch managed container");
  }

  return response.json() as Promise<ManagedContainerResponse>;
}

/**
 * Spawns a new managed Docker container with an auto-generated name.
 * @returns {Promise<ManagedContainerResponse>} The newly created managed container record
 * @throws {Error} If the API request fails
 */
export async function createManagedContainer(): Promise<ManagedContainerResponse> {
  const response = await fetch("/api/managed-containers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to create managed container");
  }

  return response.json() as Promise<ManagedContainerResponse>;
}

/**
 * Stops and removes the underlying Docker container, then deletes the record.
 * @param {number} id - The id of the managed container to delete
 * @returns {Promise<ManagedContainerResponse>} The deleted record
 * @throws {Error} If the API request fails
 */
export async function deleteManagedContainer(id: number): Promise<ManagedContainerResponse> {
  const response = await fetch(`/api/managed-containers/${id}`, {
    method: "DELETE",
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to delete managed container");
  }

  return response.json() as Promise<ManagedContainerResponse>;
}

/**
 * Pings the health endpoint of a managed container by id (proxied through the backend).
 * @param {number} id - The id of the managed container to ping
 * @returns {Promise<ManagedContainerHealthResponse>} The container's health response
 * @throws {Error} If the API request fails or the container is unreachable
 */
export async function pingManagedContainerHealth(id: number): Promise<ManagedContainerHealthResponse> {
  const response = await fetch(`/api/managed-containers/${id}/health`);

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Container health check failed");
  }

  return response.json() as Promise<ManagedContainerHealthResponse>;
}
