import { IWorkflowRepository } from '../repositories/WorkflowRepository';
import { WorkflowStatus } from '../workflows/WorkflowStatus';
import { TaskStatus } from '../workers/taskStatus';

export class WorkflowNotFoundError extends Error {
    override name = 'WorkflowNotFoundError';
    constructor(workflowId: string) {
        super(`Workflow ${workflowId} not found`);
    }
}

export class WorkflowForbiddenError extends Error {
    override name = 'WorkflowForbiddenError';
    constructor(workflowId: string) {
        super(`Access to workflow ${workflowId} is forbidden`);
    }
}

export class WorkflowNotTerminalError extends Error {
    override name = 'WorkflowNotTerminalError';
    constructor(public readonly status: WorkflowStatus) {
        super('Workflow has not finished yet');
    }
}

/** Workflow states for which a finalResult has been built and persisted. */
const TERMINAL_STATUSES: readonly WorkflowStatus[] = [WorkflowStatus.Completed, WorkflowStatus.Failed];

export interface WorkflowStatusView {
    workflowId: string;
    status: WorkflowStatus;
    completedTasks: number;
    totalTasks: number;
}

export interface WorkflowResultsView {
    workflowId: string;
    status: WorkflowStatus;
    finalResult: unknown;
}

/**
 * Workflow read-side use cases. Owns the business rules (existence, completion,
 * progress counting, result deserialization) so controllers only translate HTTP.
 */
export class WorkflowService {
    constructor(private readonly workflows: IWorkflowRepository) {}

    async getStatus(workflowId: string, clientId: string): Promise<WorkflowStatusView> {
        const workflow = await this.workflows.findWithTasks(workflowId);
        if (!workflow) throw new WorkflowNotFoundError(workflowId);
        if (workflow.clientId !== clientId) throw new WorkflowForbiddenError(workflowId);

        const completedTasks = workflow.tasks.filter(t => t.status === TaskStatus.Completed).length;

        return {
            workflowId: workflow.workflowId,
            status: workflow.status,
            completedTasks,
            totalTasks: workflow.tasks.length,
        };
    }

    async getResults(workflowId: string, clientId: string): Promise<WorkflowResultsView> {
        const workflow = await this.workflows.findById(workflowId);
        if (!workflow) throw new WorkflowNotFoundError(workflowId);
        if (workflow.clientId !== clientId) throw new WorkflowForbiddenError(workflowId);
        if (!TERMINAL_STATUSES.includes(workflow.status)) {
            throw new WorkflowNotTerminalError(workflow.status);
        }

        return {
            workflowId: workflow.workflowId,
            status: workflow.status,
            finalResult: workflow.finalResult ? JSON.parse(workflow.finalResult) : null,
        };
    }
}
