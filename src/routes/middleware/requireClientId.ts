import { Request, Response, NextFunction } from 'express';

/**
 * Validates that every request carries an X-Client-Id header and attaches it
 * to res.
 * Returns 400 when the header is absent or empty.
 */
export function requireClientId(req: Request, res: Response, next: NextFunction): void {
    const clientId = req.headers['x-client-id'];
    if (!clientId || typeof clientId !== 'string') {
        res.status(400).json({ message: 'X-Client-Id header is required' });
        return;
    }
    res.locals.clientId = clientId;
    next();
}
