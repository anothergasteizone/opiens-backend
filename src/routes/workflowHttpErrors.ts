import { WorkflowNotFoundError, WorkflowForbiddenError, WorkflowNotTerminalError } from '../services/WorkflowService';

export interface HttpErrorResponse {
    status: number;
    body: Record<string, unknown>;
}

/**
 * Maps a WorkflowService domain error to its HTTP status and body.
 */
export function toHttpError(error: unknown, fallbackMessage: string): HttpErrorResponse {
    if (error instanceof WorkflowNotFoundError) {
        return { status: 404, body: { message: 'Workflow not found' } };
    }
    if (error instanceof WorkflowForbiddenError) {
        return { status: 403, body: { message: 'Forbidden' } };
    }
    if (error instanceof WorkflowNotTerminalError) {
        return { status: 400, body: { message: error.message, status: error.status } };
    }
    console.error(error);
    return { status: 500, body: { message: fallbackMessage } };
}
