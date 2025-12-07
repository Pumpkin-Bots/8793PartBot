/*
 * 8793PartBot – Shared Constants
 * Copyright (c) 2025 FRC Team 8793 – Pumpkin Bots
 *
 * This file defines the API contract between bot.js and code.js (Apps Script)
 * to ensure consistency and prevent integration errors.
 */

/******************************************************
 * API ACTIONS
 * These are the action types recognized by the Apps Script endpoint
 ******************************************************/

const API_ACTIONS = {
  DISCORD_REQUEST: 'discordRequest',
  INVENTORY: 'inventory',
  ORDER_STATUS: 'orderStatus',
  OPEN_ORDERS: 'openOrders',
  HEALTH: 'health'
};

/******************************************************
 * API RESPONSE STATUS
 ******************************************************/

const API_STATUS = {
  OK: 'ok',
  ERROR: 'error'
};

/******************************************************
 * ERROR CODES
 * Standardized error codes for better error handling
 ******************************************************/

const ERROR_CODES = {
  // Client errors (4xx equivalent)
  INVALID_ACTION: 'INVALID_ACTION',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  
  // Server errors (5xx equivalent)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SHEET_ERROR: 'SHEET_ERROR',
  AI_ERROR: 'AI_ERROR',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR'
};

/******************************************************
 * REQUEST FIELD NAMES
 * Field names used in API requests
 ******************************************************/

const REQUEST_FIELDS = {
  ACTION: 'action',
  REQUEST_ID: 'requestId',
  
  // Discord request fields
  REQUESTER: 'requester',
  SUBSYSTEM: 'subsystem',
  PART_LINK: 'partLink',
  QUANTITY: 'quantity',
  NEEDED_BY: 'neededBy',
  MAX_BUDGET: 'maxBudget',
  PRIORITY: 'priority',
  NOTES: 'notes',
  
  // Inventory lookup fields
  SKU: 'sku',
  SEARCH: 'search',
  
  // Order status fields
  ORDER_ID: 'orderId',
  
  // Authentication
  AUTH_TOKEN: 'authToken',
  TRACE_ID: 'traceId'
};

/******************************************************
 * RESPONSE FIELD NAMES
 * Field names used in API responses
 ******************************************************/

const RESPONSE_FIELDS = {
  STATUS: 'status',
  DATA: 'data',
  ERROR: 'error',
  META: 'meta',
  
  // Request creation response
  REQUEST_ID: 'requestID', // Note: Apps Script uses capital ID
  
  // Error response fields
  ERROR_CODE: 'code',
  ERROR_MESSAGE: 'message',
  ERROR_RETRYABLE: 'retryable',
  ERROR_DETAILS: 'details',
  
  // Meta fields
  TIMESTAMP: 'timestamp',
  VERSION: 'version',
  TRACE_ID: 'traceId'
};

/******************************************************
 * SUBSYSTEMS
 * Valid subsystem values
 ******************************************************/

const SUBSYSTEMS = {
  DRIVE: 'Drive',
  INTAKE: 'Intake',
  SHOOTER: 'Shooter',
  CLIMBER: 'Climber',
  MECHANICAL: 'Mechanical',
  ELECTRICAL: 'Electrical',
  VISION: 'Vision',
  PNEUMATICS: 'Pneumatics',
  SOFTWARE: 'Software',
  SAFETY: 'Safety',
  SPARES: 'Spares',
  OTHER: 'Other'
};

/******************************************************
 * PRIORITIES
 * Valid priority values
 ******************************************************/

const PRIORITIES = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low'
};

/******************************************************
 * REQUEST STATUS VALUES
 * Status values used in Part Requests sheet
 ******************************************************/

const REQUEST_STATUS = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  ORDERED: 'Ordered',
  DENIED: 'Denied'
};

/******************************************************
 * ORDER STATUS VALUES
 * Status values used in Orders sheet
 ******************************************************/

const ORDER_STATUS = {
  ORDERED: 'Ordered',
  SHIPPED: 'Shipped',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled'
};

/******************************************************
 * SHIPPING METHODS
 ******************************************************/

const SHIPPING_METHODS = {
  STANDARD: 'Standard',
  EXPEDITED: 'Expedited'
};

/******************************************************
 * VALIDATION LIMITS
 * Shared validation limits for both systems
 ******************************************************/

const VALIDATION_LIMITS = {
  MAX_QUANTITY: 1000,
  MIN_QUANTITY: 1,
  MAX_BUDGET: 10000,
  MIN_BUDGET: 0,
  MAX_NOTE_LENGTH: 500,
  MAX_URL_LENGTH: 2048,
  MAX_SKU_LENGTH: 100
};

/******************************************************
 * DISPLAY LIMITS
 * Limits for displaying results
 ******************************************************/

const DISPLAY_LIMITS = {
  MAX_ORDERS_DISPLAY: 15,
  MAX_DENIED_DISPLAY: 15,
  MAX_INVENTORY_DISPLAY: 10
};

/******************************************************
 * API VERSION
 ******************************************************/

const API_VERSION = 'v1.0.0';

/******************************************************
 * FALLBACK VALUES
 * Consistent fallback strings for missing data
 ******************************************************/

const FALLBACKS = {
  UNKNOWN: 'Unknown',
  NOT_AVAILABLE: 'N/A',
  NOT_SET: '—',
  NO_NAME: '(no name)',
  NONE: '(none)',
  EMPTY: ''
};

/******************************************************
 * EXPORT FOR NODE.JS (bot.js)
 ******************************************************/

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    API_ACTIONS,
    API_STATUS,
    ERROR_CODES,
    REQUEST_FIELDS,
    RESPONSE_FIELDS,
    SUBSYSTEMS,
    PRIORITIES,
    REQUEST_STATUS,
    ORDER_STATUS,
    SHIPPING_METHODS,
    VALIDATION_LIMITS,
    DISPLAY_LIMITS,
    API_VERSION,
    FALLBACKS
  };
}

/******************************************************
 * HELPER FUNCTIONS FOR APPS SCRIPT (code.js)
 * These are only available when running in Apps Script context
 ******************************************************/

/**
 * Creates a standardized success response
 * @param {object} data - Response data
 * @param {string} traceId - Optional trace ID for request tracking
 * @returns {object} Standardized response object
 */
function createSuccessResponse(data, traceId = null) {
  return {
    [RESPONSE_FIELDS.STATUS]: API_STATUS.OK,
    [RESPONSE_FIELDS.DATA]: data,
    [RESPONSE_FIELDS.META]: {
      [RESPONSE_FIELDS.TIMESTAMP]: new Date().toISOString(),
      [RESPONSE_FIELDS.VERSION]: API_VERSION,
      [RESPONSE_FIELDS.TRACE_ID]: traceId
    }
  };
}

/**
 * Creates a standardized error response
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {boolean} retryable - Whether the request can be retried
 * @param {object} details - Additional error details
 * @param {string} traceId - Optional trace ID for request tracking
 * @returns {object} Standardized error response object
 */
function createErrorResponse(code, message, retryable = false, details = {}, traceId = null) {
  return {
    [RESPONSE_FIELDS.STATUS]: API_STATUS.ERROR,
    [RESPONSE_FIELDS.ERROR]: {
      [RESPONSE_FIELDS.ERROR_CODE]: code,
      [RESPONSE_FIELDS.ERROR_MESSAGE]: message,
      [RESPONSE_FIELDS.ERROR_RETRYABLE]: retryable,
      [RESPONSE_FIELDS.ERROR_DETAILS]: details
    },
    [RESPONSE_FIELDS.META]: {
      [RESPONSE_FIELDS.TIMESTAMP]: new Date().toISOString(),
      [RESPONSE_FIELDS.VERSION]: API_VERSION,
      [RESPONSE_FIELDS.TRACE_ID]: traceId
    }
  };
}

/**
 * Validates that required fields are present in request
 * @param {object} body - Request body
 * @param {Array<string>} requiredFields - Array of required field names
 * @returns {object|null} Error response if validation fails, null if passes
 */
function validateRequiredFields(body, requiredFields) {
  const missing = [];
  
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      missing.push(field);
    }
  }
  
  if (missing.length > 0) {
    return createErrorResponse(
      ERROR_CODES.MISSING_PARAMETER,
      'Required fields are missing',
      false,
      { missingFields: missing }
    );
  }
  
  return null;
}

/**
 * Validates quantity value
 * @param {number} quantity - Quantity to validate
 * @returns {object|null} Error response if validation fails, null if passes
 */
function validateQuantity(quantity) {
  if (typeof quantity !== 'number' || isNaN(quantity)) {
    return createErrorResponse(
      ERROR_CODES.INVALID_PARAMETER,
      'Quantity must be a valid number',
      false,
      { field: REQUEST_FIELDS.QUANTITY, value: quantity }
    );
  }
  
  if (quantity < VALIDATION_LIMITS.MIN_QUANTITY) {
    return createErrorResponse(
      ERROR_CODES.VALIDATION_ERROR,
      `Quantity must be at least ${VALIDATION_LIMITS.MIN_QUANTITY}`,
      false,
      { field: REQUEST_FIELDS.QUANTITY, value: quantity }
    );
  }
  
  if (quantity > VALIDATION_LIMITS.MAX_QUANTITY) {
    return createErrorResponse(
      ERROR_CODES.VALIDATION_ERROR,
      `Quantity cannot exceed ${VALIDATION_LIMITS.MAX_QUANTITY}`,
      false,
      { field: REQUEST_FIELDS.QUANTITY, value: quantity }
    );
  }
  
  return null;
}

/**
 * Validates budget value
 * @param {number} budget - Budget to validate
 * @returns {object|null} Error response if validation fails, null if passes
 */
function validateBudget(budget) {
  if (budget === '' || budget === null || budget === undefined) {
    return null; // Budget is optional
  }
  
  if (typeof budget !== 'number' || isNaN(budget)) {
    return createErrorResponse(
      ERROR_CODES.INVALID_PARAMETER,
      'Budget must be a valid number',
      false,
      { field: REQUEST_FIELDS.MAX_BUDGET, value: budget }
    );
  }
  
  if (budget < VALIDATION_LIMITS.MIN_BUDGET) {
    return createErrorResponse(
      ERROR_CODES.VALIDATION_ERROR,
      'Budget cannot be negative',
      false,
      { field: REQUEST_FIELDS.MAX_BUDGET, value: budget }
    );
  }
  
  if (budget > VALIDATION_LIMITS.MAX_BUDGET) {
    return createErrorResponse(
      ERROR_CODES.VALIDATION_ERROR,
      `Budget cannot exceed $${VALIDATION_LIMITS.MAX_BUDGET}`,
      false,
      { field: REQUEST_FIELDS.MAX_BUDGET, value: budget }
    );
  }
  
  return null;
}

/**
 * Validates priority value
 * @param {string} priority - Priority to validate
 * @returns {object|null} Error response if validation fails, null if passes
 */
function validatePriority(priority) {
  const validPriorities = Object.values(PRIORITIES);
  
  if (!validPriorities.includes(priority)) {
    return createErrorResponse(
      ERROR_CODES.INVALID_PARAMETER,
      'Invalid priority value',
      false,
      { 
        field: REQUEST_FIELDS.PRIORITY, 
        value: priority,
        validValues: validPriorities
      }
    );
  }
  
  return null;
}

/**
 * Validates subsystem value
 * @param {string} subsystem - Subsystem to validate
 * @returns {object|null} Error response if validation fails, null if passes
 */
function validateSubsystem(subsystem) {
  const validSubsystems = Object.values(SUBSYSTEMS);
  
  if (!validSubsystems.includes(subsystem)) {
    return createErrorResponse(
      ERROR_CODES.INVALID_PARAMETER,
      'Invalid subsystem value',
      false,
      { 
        field: REQUEST_FIELDS.SUBSYSTEM, 
        value: subsystem,
        validValues: validSubsystems
      }
    );
  }
  
  return null;
}