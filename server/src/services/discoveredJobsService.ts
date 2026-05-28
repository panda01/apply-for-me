/**
 * Inbox-discovery service. The single place outside the route layer that
 * operates on `DiscoveredJob` rows. Coordinates the reader, the extractor,
 * and the JobListing-side dedup check; owns the lifecycle of
 * pending → imported / duplicate / dismissed.
 *
 * Multi-job-per-email behavior is built into scanInbox: each call to
 * extractFromMessage returns 0..N ExtractedJobs, and each ExtractedJob
 * becomes its own DiscoveredJob row via upsert on
 * `(gmail_connection_id, email_message_id, company, title)` — re-scanning
 * the same digest email never creates duplicate rows even if LinkedIn's
 * trackingId-mangled URLs rotate between scans. Empty company OR empty
 * title rows are refused entirely (logged + skipped).
 *
 * Scan-time duplicate detection: when an extracted (company, title) pair
 * matches an existing JobListing case-insensitively, the new DiscoveredJob
 * is born with `status="duplicate"` and `duplicate_of_job_id` set to that
 * listing. Such rows cannot be imported (the import endpoint rejects any
 * status other than `pending`).
 *
 * Cross-discovery duplicate refresh on import: when the user imports a
 * pending discovery, the import path runs an updateMany that flips ALL other
 * pending discoveries with matching normalized (company, title) to
 * `status="duplicate"` + `duplicate_of_job_id=<new JobListing id>` in the
 * same transaction. This handles the "same job in a LinkedIn digest AND a
 * Wellfound digest" case.
 */

import type {
  DiscoveredJob,
  GmailMessage,
  JobListing,
} from "../../prisma/generated/client/client.js";
import { DiscoveredJobStatus } from "../../prisma/generated/client/client.js";
import prisma from "../prismaClient.js";
import {
  fetchMessage,
  getFirstConnectionId,
  listJobKeywordMessages,
} from "./gmailMessageReaderService.js";
import { extractFromMessage } from "./jobDiscoveryExtractorService.js";
import {
  findExistingJobListingByCompanyTitle,
  normalizeForMatch,
} from "./jobListingMatchService.js";
import { getEmailLabelColor } from "./senderColorPalette.js";
import type {
  DiscoveredJobStatusValue,
  ImportResult,
  PublicDiscoveredJob,
  PublicDiscoveredJobReference,
  ScanResult,
} from "./inboxTypes.js";
import type { SyncLogger } from "./syncLogger.js";

/**
 * Maximum number of inbox messages processed in parallel during scanInbox.
 * Set to 1 (sequential) because Anthropic's free-tier rate limit is 50k
 * input tokens/minute and a typical extractor call can be ~7-10k tokens —
 * 3-way concurrency easily blew past the limit on the first real scan.
 * Future: bump this up when we add per-call backoff or sit on a higher tier.
 */
const SCAN_CONCURRENCY_CAP = 1;

/**
 * Number of milliseconds in one day. Used to translate the `days` argument
 * on scanInbox into the absolute `sinceDate` passed to the reader.
 */
const MILLISECONDS_PER_DAY = 86400 * 1000;

/**
 * Processes items through `worker` with a bounded number of in-flight tasks.
 * Used by scanInbox to limit Gmail+Claude concurrency to the configured cap.
 *
 * Order of results matches the order of `items` (i.e. results[i] is the
 * worker output for items[i]), regardless of completion order.
 *
 * @template TItem - The input item type
 * @template TResult - The worker's resolved value type
 * @param {TItem[]} items - Items to process
 * @param {number} concurrencyLimit - Maximum in-flight worker invocations
 * @param {(item: TItem, index: number) => Promise<TResult>} worker - Per-item async worker
 * @returns {Promise<TResult[]>} Worker results, ordered to match `items`
 */
export async function processWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrencyLimit: number,
  worker: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const totalItemCount = items.length;
  const results: TResult[] = new Array(totalItemCount);
  let nextItemIndex = 0;

  // Launch up to `concurrencyLimit` workers; each worker pulls the next
  // unclaimed index until the input is exhausted, so the in-flight count
  // never exceeds the cap.
  async function runWorkerLoop(): Promise<void> {
    while (true) {
      const claimedIndex = nextItemIndex;
      nextItemIndex += 1;
      const allItemsClaimed = claimedIndex >= totalItemCount;
      if (allItemsClaimed) {
        return;
      }
      const item = items[claimedIndex] as TItem;
      const workerResult = await worker(item, claimedIndex);
      results[claimedIndex] = workerResult;
    }
  }

  const activeWorkerCount = Math.min(concurrencyLimit, totalItemCount);
  const workerPromises: Promise<void>[] = [];
  for (let workerSlot = 0; workerSlot < activeWorkerCount; workerSlot += 1) {
    workerPromises.push(runWorkerLoop());
  }
  await Promise.all(workerPromises);
  return results;
}

/**
 * Per-message outcome reported up from the scan worker so the caller can
 * tally counts without re-querying the database.
 */
interface PerMessageScanOutcome {
  extractedJobCount: number;
  newDiscoveryCount: number;
}

/**
 * Light-normalize the (company, title) values that double as the dedup key.
 * Trim leading/trailing whitespace and collapse runs of internal whitespace
 * to a single space; case is preserved (the unique index on `discovered_jobs`
 * uses `COLLATE NOCASE` for case-insensitive uniqueness, so callers can keep
 * proper casing for display).
 *
 * @param {string} value - The raw extractor output
 * @returns {string} Display-ready normalized value
 */
export function lightNormalizeForStorage(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Light-normalize a nullable string. Returns null when the input is null,
 * empty, or whitespace-only; otherwise returns the trimmed, whitespace-
 * collapsed value (case preserved). Used for nullable fields where null is
 * a meaningful "unknown" sentinel — currently just `location`. Storing the
 * trimmed value (instead of "" or whitespace) keeps the JobView page's read
 * path simple and the COALESCE(location, '') unique index deterministic.
 *
 * @param {string | null} value - The raw extractor output (may be null)
 * @returns {string | null} Normalized value or null
 */
export function lightNormalizeNullableForStorage(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length === 0 ? null : normalized;
}

/**
 * Reads recent messages from the first GmailConnection, runs each through the
 * extractor, and upserts the results as `DiscoveredJob` rows. At upsert time,
 * each new row's `duplicate_of_job_id` is set when a JobListing already
 * exists with normalized-matching (company, title). Idempotent.
 *
 * Thin wrapper around {@link runScanWorkInline} that resolves the
 * connection id and translates the `days` argument into a Date — preserved
 * for any direct callers (e.g. unit tests) that want the legacy synchronous
 * behavior without going through the session worker.
 *
 * @param {object} args - Scan parameters
 * @param {number} args.days - Lower bound on email received-at, in days back from now
 * @returns {Promise<ScanResult>} Counts: messages scanned, jobs found, newly-inserted rows
 * @throws {Error} When no GmailConnection exists, the access token is unrecoverable, or Claude is unreachable
 */
export async function scanInbox(args: { days: number }): Promise<ScanResult> {
  const connectionId = await getFirstConnectionId();
  const sinceDate = new Date(Date.now() - args.days * MILLISECONDS_PER_DAY);
  return runScanWorkInline({ connectionId, sinceDate });
}

/**
 * Core "do the scan" routine shared by both the legacy {@link scanInbox}
 * entry point and the new background worker in `gmailSyncWorker.ts`.
 * Accepts the resolved `connectionId` + `sinceDate` directly so callers that
 * have already done that work (e.g. the worker, which logs the resolution)
 * don't double-resolve. An optional {@link SyncLogger} is threaded into each
 * per-message call so the worker can record progress per Gmail message.
 *
 * Messages are processed oldest-first. Gmail's `users.messages.list` returns
 * IDs newest-first; we reverse a copy of that list before handing it to
 * {@link processWithConcurrency} so that partial progress on a crashed scan
 * covers the older end of the window and the next run's incremental
 * `sinceDate` naturally moves forward from where this one left off.
 *
 * @param {object} args - Scan inputs
 * @param {number} args.connectionId - GmailConnection id to scan against
 * @param {Date} args.sinceDate - Lower bound on email received-at
 * @param {SyncLogger} [args.logger] - Optional session-scoped logger for per-message progress lines
 * @returns {Promise<ScanResult>} Counts: messages scanned, jobs found, newly-inserted rows
 */
export async function runScanWorkInline(args: {
  connectionId: number;
  sinceDate: Date;
  logger?: SyncLogger;
}): Promise<ScanResult> {
  const { connectionId, sinceDate, logger } = args;
  const messageIds = await listJobKeywordMessages(connectionId, sinceDate);
  // Gmail returns IDs newest-first; reverse so we process the oldest matching
  // email first. With SCAN_CONCURRENCY_CAP=1, partial progress on a crashed
  // scan covers the older end of the window, and the next run's incremental
  // sinceDate naturally moves forward from there. `[...arr].reverse()` keeps
  // the original `messageIds` intact (the reverse is in-place but on the copy).
  const messageIdsOldestFirst = [...messageIds].reverse();

  const perMessageOutcomes = await processWithConcurrency<string, PerMessageScanOutcome>(
    messageIdsOldestFirst,
    SCAN_CONCURRENCY_CAP,
    (messageId) => processSingleMessage(connectionId, messageId, logger)
  );

  let totalExtractedJobCount = 0;
  let totalNewDiscoveryCount = 0;
  for (const outcome of perMessageOutcomes) {
    totalExtractedJobCount += outcome.extractedJobCount;
    totalNewDiscoveryCount += outcome.newDiscoveryCount;
  }

  return {
    scanned: messageIds.length,
    found: totalExtractedJobCount,
    newDiscoveries: totalNewDiscoveryCount,
  };
}

/**
 * Fetches a single Gmail message, runs the extractor, and upserts a
 * DiscoveredJob row per extracted job. Tracks whether each upsert created a
 * new row (versus refreshed an existing one) so the scanInbox tally is
 * accurate.
 *
 * Already-scanned guard: GmailMessage is the source of truth for "have we
 * ever processed this email". When a row exists, both the Gmail
 * `messages.get` call and the Claude API call are skipped — even when the
 * previous extraction returned zero jobs. This is the main runtime win:
 * messages that are clearly not job posts get skipped on every re-scan.
 *
 * GmailMessage is created BEFORE the DiscoveredJob inserts so the dedupe
 * key (gmail_message_id, company, title, location) has a valid FK to
 * reference. If the DiscoveredJob loop crashes partway through, the
 * GmailMessage row stays — meaning we won't re-Claude that message on the
 * next scan, but we will lose the rows that didn't get inserted. Same
 * crash semantics as before the GmailMessage refactor.
 *
 * Skips any extracted job whose `company` or `title` is empty after
 * light-normalization — those rows can't be deduplicated under the new key
 * and would corrupt the unique index. Skipped jobs are logged so the user
 * can audit what was dropped.
 *
 * Within-email location-aware dedup: the table's unique key now includes
 * `location`, so two extracted jobs from the same email with the same
 * (company, title) but different locations are distinct rows. However, when
 * one side has a null/unknown location it acts as a wildcard — we merge it
 * into the row with a valid location (and promote a valid value into a row
 * whose stored location was null). This avoids creating phantom rows for
 * "same job, location unknown in one digest entry" cases. We use `findMany`
 * + in-memory selection (mirroring jobListingMatchService) because the
 * either-null-wildcard rule can't be expressed as a SQL findUnique key.
 *
 * Newly-created rows are born with `status="duplicate"` +
 * `duplicate_of_job_id` set when an existing JobListing already covers the
 * (company, title, location) tuple; otherwise they start as
 * `status="pending"`. The update branch never touches `status` or
 * `imported_job_listing_id` — preserving any action the user has already
 * taken on the row — EXCEPT the pending → duplicate auto-flip.
 *
 * @param {number} connectionId - GmailConnection id to scan against
 * @param {string} messageId - Gmail message id to process
 * @param {SyncLogger} [logger] - Optional session-scoped logger; when provided, emits per-message progress lines under the `finding_jobs` step
 * @returns {Promise<PerMessageScanOutcome>} Per-message extraction + insertion counts
 */
async function processSingleMessage(
  connectionId: number,
  messageId: string,
  logger?: SyncLogger
): Promise<PerMessageScanOutcome> {
  // Already-scanned guard. GmailMessage rows are created during each scan
  // regardless of whether the extractor produced any jobs, so a hit here
  // means "we've seen this email before". Skips the Gmail messages.get
  // call (~200-500ms) AND the Claude tool-use call (2-10s).
  const existingScannedMessage = await prisma.gmailMessage.findFirst({
    where: {
      gmail_connection_id: connectionId,
      email_message_id: messageId,
    },
    select: { id: true },
  });
  const messageWasAlreadyScanned = existingScannedMessage !== null;
  if (messageWasAlreadyScanned) {
    if (logger !== undefined) {
      await logger.log(
        "finding_jobs",
        `Skipped already-scanned message ${messageId}`,
        { messageId }
      );
    }
    return { extractedJobCount: 0, newDiscoveryCount: 0 };
  }

  const message = await fetchMessage(connectionId, messageId);
  const labelColor = getEmailLabelColor(message.fromAddress);

  // Persist the GmailMessage row up front. After this point any subsequent
  // crash leaves the row in the DB — which means the next scan correctly
  // treats this message as "already seen" and skips Claude. The cost is
  // that any DiscoveredJob rows we WOULD have inserted after a mid-loop
  // crash are lost (same behavior as the pre-GmailMessage codepath).
  const gmailMessageRow = await prisma.gmailMessage.create({
    data: {
      gmail_connection_id: connectionId,
      email_message_id: message.messageId,
      email_thread_id: message.threadId,
      email_from_name: message.fromName,
      email_from_address: message.fromAddress,
      email_subject: message.subject,
      email_snippet: message.snippet,
      email_received_at: message.receivedAt,
      email_label_color: labelColor,
    },
  });

  const extractionResult = await extractFromMessage(message);
  if (logger !== undefined) {
    await logger.log("finding_jobs", `Processed message ${messageId}`, {
      messageId,
      subject: message.subject,
      extractedJobCount: extractionResult.jobs.length,
    });
  }

  let newDiscoveryCount = 0;

  for (const extractedJob of extractionResult.jobs) {
    const normalizedCompany = lightNormalizeForStorage(extractedJob.company);
    const normalizedTitle = lightNormalizeForStorage(extractedJob.title);
    const companyIsEmpty = normalizedCompany.length === 0;
    const titleIsEmpty = normalizedTitle.length === 0;
    if (companyIsEmpty || titleIsEmpty) {
      // Refuse-to-insert policy: rows missing either half of the dedup key
      // are unhandleable. Log enough context so the user can audit which
      // email + extracted job got dropped and decide whether to refine the
      // extractor prompt.
      process.stderr.write(
        `[discoveredJobs] skipping row from message ${message.messageId} ` +
          `(subject "${message.subject}"): missing ` +
          `${companyIsEmpty ? "company" : ""}${companyIsEmpty && titleIsEmpty ? "+" : ""}` +
          `${titleIsEmpty ? "title" : ""}\n`
      );
      continue;
    }

    const normalizedLocation = lightNormalizeNullableForStorage(extractedJob.location);

    const existingJobListing = await findExistingJobListingByCompanyTitle(
      normalizedCompany,
      normalizedTitle,
      normalizedLocation
    );
    const duplicateOfJobId = existingJobListing ? existingJobListing.id : null;

    // Within-email candidate lookup: pull all DiscoveredJob rows for this
    // GmailMessage where (company, title) match case-insensitively. Then
    // apply the either-null-wildcard rule on location at the application
    // layer — SQLite + Prisma can't express a function-based predicate or
    // the wildcard semantic in a findUnique key.
    const candidateRows = await prisma.discoveredJob.findMany({
      where: { gmail_message_id: gmailMessageRow.id },
    });
    const companyTitleMatchingCandidates = candidateRows.filter((candidateRow) => {
      const candidateCompanyMatches =
        normalizeForMatch(candidateRow.company) === normalizeForMatch(normalizedCompany);
      const candidateTitleMatches =
        normalizeForMatch(candidateRow.title) === normalizeForMatch(normalizedTitle);
      return candidateCompanyMatches && candidateTitleMatches;
    });

    const mergeTarget = pickMergeTarget(
      companyTitleMatchingCandidates,
      normalizedLocation
    );

    if (mergeTarget === null) {
      // No mergeable existing row → CREATE a brand-new DiscoveredJob.
      const initialStatus = existingJobListing
        ? DiscoveredJobStatus.duplicate
        : DiscoveredJobStatus.pending;
      await prisma.discoveredJob.create({
        data: {
          gmail_connection_id: connectionId,
          gmail_message_id: gmailMessageRow.id,
          title: normalizedTitle,
          company: normalizedCompany,
          job_url: extractedJob.jobUrl,
          location: normalizedLocation,
          work_arrangement: extractedJob.workArrangement,
          salary: extractedJob.salary,
          description: extractedJob.description,
          confidence: extractedJob.confidence,
          status: initialStatus,
          duplicate_of_job_id: duplicateOfJobId,
        },
      });
      newDiscoveryCount += 1;
      continue;
    }

    // Re-scan / within-email merge path: refresh content fields + the
    // latest URL. Never touch `imported_job_listing_id` — once a row has
    // been imported, it stays imported even if the underlying email gets
    // rescanned.
    //
    // Location handling: PROMOTE a null-location row when we now have a
    // valid value. Never overwrite an existing valid location (the merge
    // target was picked because the new value's null acts as a wildcard,
    // so the stored value is at least as specific).
    //
    // Work-arrangement handling: same promotion rule as location, but applied
    // independently — `work_arrangement` is NOT part of the dedup identity, so
    // we simply promote a stored null to a freshly-extracted valid value and
    // never overwrite an existing valid arrangement with a null re-scan.
    //
    // Status handling: only auto-flip `pending` → `duplicate` when a
    // JobListing has since appeared with matching (company, title, location).
    // Other status transitions (imported, dismissed) are user-driven and
    // must be preserved verbatim. `duplicate` rows whose JobListing has
    // been deleted should NOT auto-recover to pending — the FK `onDelete:
    // SetNull` handles the FK side, and we leave the status untouched so
    // the user retains control.
    const newLocationIsValid = normalizedLocation !== null;
    const existingLocationIsNull = mergeTarget.location === null;
    const shouldPromoteLocation = newLocationIsValid && existingLocationIsNull;
    const locationToWrite = shouldPromoteLocation ? normalizedLocation : mergeTarget.location;

    const newWorkArrangementIsValid = extractedJob.workArrangement !== null;
    const existingWorkArrangementIsNull = mergeTarget.work_arrangement === null;
    const shouldPromoteWorkArrangement =
      newWorkArrangementIsValid && existingWorkArrangementIsNull;
    const workArrangementToWrite = shouldPromoteWorkArrangement
      ? extractedJob.workArrangement
      : mergeTarget.work_arrangement;

    const shouldAutoFlipToDuplicate =
      mergeTarget.status === DiscoveredJobStatus.pending &&
      existingJobListing !== null;

    await prisma.discoveredJob.update({
      where: { id: mergeTarget.id },
      data: {
        job_url: extractedJob.jobUrl,
        location: locationToWrite,
        work_arrangement: workArrangementToWrite,
        salary: extractedJob.salary,
        description: extractedJob.description,
        confidence: extractedJob.confidence,
        duplicate_of_job_id: duplicateOfJobId,
        ...(shouldAutoFlipToDuplicate
          ? { status: DiscoveredJobStatus.duplicate }
          : {}),
      },
    });
  }

  return {
    extractedJobCount: extractionResult.jobs.length,
    newDiscoveryCount,
  };
}

/**
 * Selects which of the (company, title)-matching candidate rows to merge
 * the incoming extracted job into, applying the either-null-wildcard rule
 * for `location`.
 *
 * Selection rules:
 *   - If the new location is null → prefer a candidate with a valid
 *     (non-null) location (so the null gets absorbed into the more
 *     specific row); otherwise take any null-location candidate.
 *   - If the new location is valid → look for a candidate with the same
 *     case-insensitive location; if none, fall back to a candidate with
 *     null location (to promote it); if none, return null so the caller
 *     creates a brand-new row.
 *
 * @param {DiscoveredJob[]} companyTitleMatchingCandidates - Candidate rows already filtered to (company, title) match
 * @param {string | null} normalizedNewLocation - Normalized location from the incoming extracted job (null = wildcard)
 * @returns {DiscoveredJob | null} The selected merge target, or null when no candidate matches under the wildcard rule
 */
function pickMergeTarget(
  companyTitleMatchingCandidates: DiscoveredJob[],
  normalizedNewLocation: string | null
): DiscoveredJob | null {
  const newLocationIsWildcard = normalizedNewLocation === null;

  if (newLocationIsWildcard) {
    // Prefer absorbing the wildcard into a more-specific row.
    const candidateWithValidLocation = companyTitleMatchingCandidates.find(
      (candidate) => candidate.location !== null
    );
    if (candidateWithValidLocation !== undefined) {
      return candidateWithValidLocation;
    }
    const candidateWithNullLocation = companyTitleMatchingCandidates.find(
      (candidate) => candidate.location === null
    );
    return candidateWithNullLocation ?? null;
  }

  // Incoming location is valid: prefer exact case-insensitive match.
  const normalizedNewLocationLowercased = normalizeForMatch(normalizedNewLocation);
  const candidateWithMatchingLocation = companyTitleMatchingCandidates.find(
    (candidate) => normalizeForMatch(candidate.location) === normalizedNewLocationLowercased
  );
  if (candidateWithMatchingLocation !== undefined) {
    return candidateWithMatchingLocation;
  }

  // Fall back to a null-location candidate so we can promote its location.
  const candidateWithNullLocationForPromotion = companyTitleMatchingCandidates.find(
    (candidate) => candidate.location === null
  );
  return candidateWithNullLocationForPromotion ?? null;
}

/**
 * Shape of the rows returned by listDiscoveries' findMany call, including
 * the GmailMessage source, plus the duplicate/imported JobListing relations.
 * Declared inline so the public surface of this module stays compact.
 */
type DiscoveredJobWithRelations = DiscoveredJob & {
  gmail_message: GmailMessage;
  duplicate_of_job: JobListing | null;
  imported_job_listing: JobListing | null;
};

/**
 * Builds a `PublicDiscoveredJobReference` projection from a related
 * JobListing row, or null when the FK is unset. Centralizes the
 * `{ jobListingId, title, status }` shape used for both `duplicateOf` and
 * `importedAs`.
 *
 * @param {JobListing | null | undefined} relatedJobListing - The related row, or null/undefined
 * @returns {PublicDiscoveredJobReference | null} Projection or null
 */
function buildJobListingReference(
  relatedJobListing: JobListing | null | undefined
): PublicDiscoveredJobReference | null {
  const hasRelatedRow = relatedJobListing !== null && relatedJobListing !== undefined;
  if (!hasRelatedRow) {
    return null;
  }
  return {
    jobListingId: relatedJobListing.id,
    title: relatedJobListing.title ?? "",
    status: String(relatedJobListing.status),
  };
}

/**
 * Returns the persisted discoveries within the given time window, optionally
 * filtered by status. Rows are sorted by `email_received_at` descending so
 * the most-recently-received jobs appear first. Each row embeds the email
 * metadata + duplicate/imported references for the UI to render without a
 * second round-trip.
 *
 * @param {object} args - List parameters
 * @param {number} args.days - Lower bound on email received-at, in days back from now
 * @param {DiscoveredJobStatusValue} [args.status] - Optional status filter; omit to return all statuses
 * @returns {Promise<PublicDiscoveredJob[]>} HTTP-safe projections
 */
export async function listDiscoveries(args: {
  days: number;
  status?: DiscoveredJobStatusValue;
}): Promise<PublicDiscoveredJob[]> {
  const sinceDate = new Date(Date.now() - args.days * MILLISECONDS_PER_DAY);

  // `email_received_at` lives on GmailMessage now, so the where-clause +
  // orderBy traverse the relation. Prisma generates a JOIN under the hood.
  const whereClause: {
    gmail_message: { email_received_at: { gte: Date } };
    status?: DiscoveredJobStatusValue;
  } = {
    gmail_message: { email_received_at: { gte: sinceDate } },
  };
  const hasStatusFilter = args.status !== undefined;
  if (hasStatusFilter) {
    whereClause.status = args.status;
  }

  const discoveryRows = (await prisma.discoveredJob.findMany({
    where: whereClause,
    include: {
      gmail_message: true,
      duplicate_of_job: true,
      imported_job_listing: true,
    },
    orderBy: { gmail_message: { email_received_at: "desc" } },
  })) as DiscoveredJobWithRelations[];

  return discoveryRows.map((row) => mapDiscoveredJobRowToPublic(row));
}

/**
 * Maps a DiscoveredJob row (with its duplicate/imported relations loaded) to
 * the HTTP-safe `PublicDiscoveredJob` shape. Builds the Gmail deep link from
 * the stored message id and converts Date columns to ISO strings.
 *
 * @param {DiscoveredJobWithRelations} row - The Prisma row to project
 * @returns {PublicDiscoveredJob} Public projection ready for JSON serialization
 */
function mapDiscoveredJobRowToPublic(
  row: DiscoveredJobWithRelations
): PublicDiscoveredJob {
  const sourceMessage = row.gmail_message;
  const gmailDeepLinkUrl = `https://mail.google.com/mail/u/0/#inbox/${sourceMessage.email_message_id}`;
  const duplicateOfReference = buildJobListingReference(row.duplicate_of_job);
  const importedAsReference = buildJobListingReference(row.imported_job_listing);

  return {
    id: row.id,
    status: row.status as DiscoveredJobStatusValue,
    title: row.title,
    company: row.company,
    jobUrl: row.job_url,
    location: row.location,
    workArrangement: row.work_arrangement,
    salary: row.salary,
    description: row.description,
    confidence: row.confidence,
    email: {
      messageId: sourceMessage.email_message_id,
      threadId: sourceMessage.email_thread_id,
      fromName: sourceMessage.email_from_name,
      fromAddress: sourceMessage.email_from_address,
      subject: sourceMessage.email_subject,
      snippet: sourceMessage.email_snippet,
      receivedAt: sourceMessage.email_received_at.toISOString(),
      labelColor: sourceMessage.email_label_color,
      gmailUrl: gmailDeepLinkUrl,
    },
    duplicateOf: duplicateOfReference,
    importedAs: importedAsReference,
    createdDate: row.created_date.toISOString(),
  };
}

/**
 * Promotes the given pending discoveries to real `JobListing` rows. For each
 * id, atomically: creates a JobListing, flips the DiscoveredJob to
 * `imported` with `imported_job_listing_id` set, and refreshes any sibling
 * pending discoveries with normalized-matching (company, title) to point at
 * the freshly-created JobListing as their duplicate-of target.
 *
 * Discoveries whose `duplicate_of_job_id` is already set are returned in
 * the `duplicates` field and skipped — the UI should prevent these from
 * being selected, but the server is defensive.
 *
 * @param {number[]} ids - DiscoveredJob ids to import
 * @returns {Promise<ImportResult>} Per-id outcomes
 */
export async function importDiscoveries(ids: number[]): Promise<ImportResult> {
  const importedEntries: { discoveryId: number; jobListingId: number }[] = [];
  const failedEntries: { discoveryId: number; reason: string }[] = [];
  const duplicateEntries: { discoveryId: number; jobListingId: number }[] = [];

  for (const discoveryId of ids) {
    // Include the source GmailMessage so we can read `email_received_at`
    // for the new JobListing's `post_date` without a second round-trip.
    const discoveryRow = await prisma.discoveredJob.findUnique({
      where: { id: discoveryId },
      include: { gmail_message: true },
    });
    const discoveryNotFound = discoveryRow === null;
    if (discoveryNotFound) {
      failedEntries.push({ discoveryId, reason: "not found" });
      continue;
    }
    const discoveryIsNotPending = discoveryRow.status !== DiscoveredJobStatus.pending;
    if (discoveryIsNotPending) {
      failedEntries.push({
        discoveryId,
        reason: `already ${String(discoveryRow.status)}`,
      });
      continue;
    }
    const discoveryIsAlreadyFlaggedAsDuplicate =
      discoveryRow.duplicate_of_job_id !== null &&
      discoveryRow.duplicate_of_job_id !== undefined;
    if (discoveryIsAlreadyFlaggedAsDuplicate) {
      duplicateEntries.push({
        discoveryId,
        jobListingId: discoveryRow.duplicate_of_job_id as number,
      });
      continue;
    }

    const newlyCreatedJobListing = await prisma.$transaction(async (tx) => {
      const createdJobListing = await tx.jobListing.create({
        data: {
          url: discoveryRow.job_url,
          title: discoveryRow.title,
          company: discoveryRow.company,
          description: discoveryRow.description ?? "",
          salary: discoveryRow.salary,
          location: discoveryRow.location,
          work_arrangement: discoveryRow.work_arrangement,
          post_date: discoveryRow.gmail_message.email_received_at,
          status: "init",
        },
      });

      await tx.discoveredJob.update({
        where: { id: discoveryRow.id },
        data: {
          status: DiscoveredJobStatus.imported,
          imported_job_listing_id: createdJobListing.id,
        },
      });

      // Cross-discovery duplicate refresh: any OTHER pending discoveries
      // with normalized-matching (company, title) AND a wildcard-compatible
      // location get their status flipped to `duplicate` and
      // `duplicate_of_job_id` pointed at the freshly-created listing, all
      // in the same transaction. The status flip is what makes the row
      // vanish from the Inbox "New" tab and surface in the "Duplicates"
      // tab without requiring a re-scan.
      //
      // Location matching uses the same either-null-wildcard rule as
      // jobListingMatchService: a sibling matches if its normalized
      // location is empty OR the imported row's normalized location is
      // empty OR the two normalized locations are exactly equal.
      const siblingPendingDiscoveries = await tx.discoveredJob.findMany({
        where: {
          id: { not: discoveryRow.id },
          status: DiscoveredJobStatus.pending,
        },
      });
      const normalizedImportedLocation = normalizeForMatch(discoveryRow.location);
      const importedLocationIsWildcard = normalizedImportedLocation.length === 0;
      const matchingSiblingIds = siblingPendingDiscoveries
        .filter((sibling) => {
          const companyMatches =
            normalizeForMatch(sibling.company) ===
            normalizeForMatch(discoveryRow.company);
          const titleMatches =
            normalizeForMatch(sibling.title) ===
            normalizeForMatch(discoveryRow.title);
          if (!companyMatches || !titleMatches) {
            return false;
          }
          const normalizedSiblingLocation = normalizeForMatch(sibling.location);
          const siblingLocationIsWildcard = normalizedSiblingLocation.length === 0;
          const eitherSideIsWildcard =
            siblingLocationIsWildcard || importedLocationIsWildcard;
          const locationsMatchExactly =
            normalizedSiblingLocation === normalizedImportedLocation;
          const locationMatches = eitherSideIsWildcard || locationsMatchExactly;
          return locationMatches;
        })
        .map((sibling) => sibling.id);

      const hasMatchingSiblings = matchingSiblingIds.length > 0;
      if (hasMatchingSiblings) {
        await tx.discoveredJob.updateMany({
          where: { id: { in: matchingSiblingIds } },
          data: {
            status: DiscoveredJobStatus.duplicate,
            duplicate_of_job_id: createdJobListing.id,
          },
        });
      }

      return createdJobListing;
    });

    importedEntries.push({
      discoveryId,
      jobListingId: newlyCreatedJobListing.id,
    });
  }

  return {
    imported: importedEntries,
    failed: failedEntries,
    duplicates: duplicateEntries,
  };
}

/**
 * Flips a DiscoveredJob's status to `dismissed`. Idempotent — dismissing an
 * already-dismissed row is a no-op (the status is rewritten to dismissed,
 * matching the design's behavior of clicking Dismiss twice).
 *
 * @param {number} id - The DiscoveredJob id to dismiss
 * @returns {Promise<DiscoveredJob>} The updated row
 * @throws {Error} When the row does not exist or is already imported
 */
export async function dismissDiscovery(id: number): Promise<DiscoveredJob> {
  return flipDiscoveryStatus(id, DiscoveredJobStatus.dismissed);
}

/**
 * Flips a `dismissed` DiscoveredJob back to `pending` so it appears in the
 * default filter again. Idempotent — restoring an already-pending row is a
 * no-op (the status is rewritten to pending).
 *
 * @param {number} id - The DiscoveredJob id to restore
 * @returns {Promise<DiscoveredJob>} The updated row
 * @throws {Error} When the row does not exist or is already imported
 */
export async function restoreDiscovery(id: number): Promise<DiscoveredJob> {
  return flipDiscoveryStatus(id, DiscoveredJobStatus.pending);
}

/**
 * Shared status-flip helper for dismiss + restore. Loads the row, validates
 * it isn't already imported (the only terminal status the UI can't undo),
 * then writes the new status.
 *
 * @param {number} id - The DiscoveredJob id to flip
 * @param {Extract<DiscoveredJobStatusValue, "pending" | "dismissed">} newStatus - Status to write
 * @returns {Promise<DiscoveredJob>} The updated row
 * @throws {Error} When the row does not exist or is currently imported
 */
async function flipDiscoveryStatus(
  id: number,
  newStatus: Extract<DiscoveredJobStatusValue, "pending" | "dismissed">
): Promise<DiscoveredJob> {
  const existingRow = await prisma.discoveredJob.findUnique({ where: { id } });
  const rowNotFound = existingRow === null;
  if (rowNotFound) {
    throw new Error(`DiscoveredJob ${id} not found`);
  }
  const rowIsAlreadyImported = existingRow.status === DiscoveredJobStatus.imported;
  if (rowIsAlreadyImported) {
    const action = newStatus === DiscoveredJobStatus.dismissed ? "dismiss" : "restore";
    throw new Error(`Cannot ${action} an imported discovery`);
  }
  const updatedRow = await prisma.discoveredJob.update({
    where: { id },
    data: { status: newStatus },
  });
  return updatedRow;
}

// Re-export for callers that need the row type alongside the public types.
export type { DiscoveredJob, JobListing };
