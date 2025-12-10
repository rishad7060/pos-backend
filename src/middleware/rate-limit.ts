import rateLimit from 'express-rate-limit';

// General API rate limiter - Increased for high-volume POS usage
// 1000 requests per 15 minutes (previously 100)
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: {
        error: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Auth limiter - Significantly increased for POS cashier login/logout patterns
// 100 login attempts per 15 minutes (previously 5)
// Cashiers frequently login/logout during shifts, breaks, and shift changes
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    skipSuccessfulRequests: true, // Don't count successful requests
    message: {
        error: 'Too many login attempts from this IP, please try again after 15 minutes.',
        code: 'AUTH_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// PIN login limiter - Increased for frequent POS cashier authentication
// 50 attempts per 15 minutes (previously 3)
// Multiple cashiers use the same terminal throughout the day
export const pinAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50,
    skipSuccessfulRequests: true,
    message: {
        error: 'Too many PIN attempts from this IP, please try again after 15 minutes.',
        code: 'PIN_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Order creation limiter - Increased for busy POS periods
// 200 orders per minute (previously 30)
// During peak hours, a busy store can process many orders quickly
export const orderCreationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 200,
    message: {
        error: 'Too many orders created too quickly, please slow down.',
        code: 'ORDER_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
