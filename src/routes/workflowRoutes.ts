import { Router } from 'express';
import { AppDataSource } from '../data-source';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { WorkflowService } from '../services/WorkflowService';
import { requireClientId } from './middleware/requireClientId';
import { toHttpError } from './workflowHttpErrors';

const router = Router();
const workflowService = new WorkflowService(new WorkflowRepository(AppDataSource));

router.use(requireClientId);

/**
 * GET /workflow/:id/status
 * Returns the current status of a workflow plus its task progress.
 * - 400 if the X-Client-Id header is missing.
 * - 403 if the workflow does not belong to the caller.
 * - 404 if the workflow does not exist.
 */
router.get('/:id/status', async (req, res) => {
    try {
        return res.json(await workflowService.getStatus(req.params.id, res.locals.clientId));
    } catch (error: unknown) {
        const { status, body } = toHttpError(error, 'Failed to retrieve workflow status');
        return res.status(status).json(body);
    }
});

/**
 * GET /workflow/:id/results
 * Returns the aggregated finalResult of a terminal workflow (completed or failed).
 * - 400 if the X-Client-Id header is missing or the workflow has not finished yet
 *   (initial / in_progress, i.e. no finalResult exists yet).
 * - 403 if the workflow does not belong to the caller.
 * - 404 if the workflow does not exist.
 */
router.get('/:id/results', async (req, res) => {
    try {
        return res.json(await workflowService.getResults(req.params.id, res.locals.clientId));
    } catch (error: unknown) {
        const { status, body } = toHttpError(error, 'Failed to retrieve workflow results');
        return res.status(status).json(body);
    }
});

export default router;
