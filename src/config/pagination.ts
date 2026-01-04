/**
 * Pagination Configuration for POS System
 *
 * CRITICAL: POS systems need access to ALL products, categories, and suppliers
 * for proper operation. These limits should be generous or unlimited.
 */

export const PAGINATION_CONFIG = {
  // Default limits for general queries
  DEFAULT_LIMIT: 100,

  // Maximum allowed limit (safety cap to prevent memory issues)
  MAX_LIMIT: 10000,

  // Specific limits for different entity types
  LIMITS: {
    // Core POS data - should fetch ALL
    products: 10000,      // POS needs all products available
    categories: 10000,    // POS needs all categories
    suppliers: 10000,     // Admin needs all suppliers
    customers: 10000,     // Customer lookup needs all

    // Transaction history - can be paginated
    orders: 100,
    refunds: 100,
    expenses: 100,
    cashTransactions: 100,

    // Session data - moderate limits
    registrySessions: 100,
    shifts: 100,

    // Financial records
    cheques: 200,
    customerCredits: 100,
    supplierCredits: 100,
    purchases: 200,

    // Detailed transaction data
    purchasePayments: 100,
    purchaseReturns: 100,
    purchaseReceives: 100,

    // Audit and logs
    auditLogs: 100,
    stockMovements: 100,
    priceHistory: 200,

    // Batch tracking
    batches: 100,
    batchHistory: 100,
  },

  // Default offset
  DEFAULT_OFFSET: 0,

  // For endpoints that should return ALL records (no pagination)
  UNLIMITED: -1,
} as const;

/**
 * Parse and validate limit parameter from query
 */
export function parseLimit(limit: any, entityType?: keyof typeof PAGINATION_CONFIG.LIMITS): number {
  // If limit is explicitly -1, return MAX_LIMIT (fetch all)
  if (limit === '-1' || limit === -1) {
    return PAGINATION_CONFIG.MAX_LIMIT;
  }

  // Get default limit for entity type
  const defaultLimit = entityType
    ? PAGINATION_CONFIG.LIMITS[entityType]
    : PAGINATION_CONFIG.DEFAULT_LIMIT;

  // Parse the limit
  const parsedLimit = parseInt(limit as string) || defaultLimit;

  // Cap at MAX_LIMIT for safety
  return Math.min(parsedLimit, PAGINATION_CONFIG.MAX_LIMIT);
}

/**
 * Parse and validate offset parameter from query
 */
export function parseOffset(offset: any): number {
  const parsedOffset = parseInt(offset as string) || PAGINATION_CONFIG.DEFAULT_OFFSET;
  return Math.max(0, parsedOffset); // Ensure non-negative
}

/**
 * Get pagination parameters for a specific entity type
 */
export function getPaginationParams(
  query: any,
  entityType?: keyof typeof PAGINATION_CONFIG.LIMITS
): { limit: number; offset: number } {
  return {
    limit: parseLimit(query.limit, entityType),
    offset: parseOffset(query.offset),
  };
}

/**
 * Create pagination metadata for API responses
 * Helps frontend know if there are more records and if limit was reached
 */
export interface PaginationMeta {
  total: number;           // Total records in database
  returned: number;        // Number of records returned
  limit: number;           // Applied limit
  hasMore: boolean;        // Are there more records?
  limitReached: boolean;   // Was the maximum limit cap reached?
  warningMessage?: string; // Warning message if limit reached
}

/**
 * Create pagination metadata for responses
 */
export function createPaginationMeta(
  totalCount: number,
  returnedCount: number,
  appliedLimit: number,
  entityType?: string
): PaginationMeta {
  const limitReached = appliedLimit === PAGINATION_CONFIG.MAX_LIMIT && totalCount > appliedLimit;
  const hasMore = totalCount > returnedCount;

  let warningMessage: string | undefined;
  if (limitReached) {
    warningMessage = `Showing ${returnedCount.toLocaleString()} of ${totalCount.toLocaleString()} ${entityType || 'records'}. Maximum limit of ${PAGINATION_CONFIG.MAX_LIMIT.toLocaleString()} reached. Please use filters or search to find specific items.`;
  } else if (hasMore) {
    warningMessage = `Showing ${returnedCount.toLocaleString()} of ${totalCount.toLocaleString()} ${entityType || 'records'}. Use pagination to load more.`;
  }

  return {
    total: totalCount,
    returned: returnedCount,
    limit: appliedLimit,
    hasMore,
    limitReached,
    warningMessage,
  };
}

/**
 * Create standardized paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

/**
 * Helper to create a paginated response
 */
export function createPaginatedResponse<T>(
  data: T[],
  totalCount: number,
  appliedLimit: number,
  entityType?: string
): PaginatedResponse<T> {
  return {
    data,
    pagination: createPaginationMeta(totalCount, data.length, appliedLimit, entityType),
  };
}
