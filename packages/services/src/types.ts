import type { Database } from "@monark/db";

/**
 * A transaction handle.
 *
 * Services take this rather than a Database so callers are forced to decide
 * transaction boundaries explicitly. Conversion emission in particular is only
 * correct inside the same transaction as the business change that caused it.
 */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
