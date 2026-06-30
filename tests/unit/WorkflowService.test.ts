import { WorkflowService, WorkflowNotFoundError, WorkflowForbiddenError, WorkflowNotTerminalError } from '../../src/services/WorkflowService';
import { IWorkflowRepository } from '../../src/repositories/WorkflowRepository';
import { Workflow } from '../../src/models/Workflow';
import { Task } from '../../src/models/Task';
import { TaskStatus } from '../../src/workers/taskStatus';
import { WorkflowStatus } from '../../src/workflows/WorkflowStatus';

function workflow(partial: Partial<Workflow>): Workflow {
    return Object.assign(new Workflow(), partial);
}

function taskWithStatus(status: TaskStatus): Task {
    return Object.assign(new Task(), { status });
}

class FakeWorkflowRepository implements IWorkflowRepository {
    constructor(private readonly workflow: Workflow | null) {}
    async findById(): Promise<Workflow | null> {
        return this.workflow;
    }
    async findWithTasks(): Promise<Workflow | null> {
        return this.workflow;
    }
}

// Challenge tasks A.5 (GET /status) and A.6 (GET /results) plus their error contracts.
describe('WorkflowService', () => {
    describe('getStatus', () => {
        it('reports completed and total task counts (task A.5)', async () => {
            const wf = workflow({
                workflowId: 'wf-1',
                clientId: 'client-1',
                status: WorkflowStatus.Initial,
                tasks: [taskWithStatus(TaskStatus.Completed), taskWithStatus(TaskStatus.Completed), taskWithStatus(TaskStatus.Queued)],
            });
            const service = new WorkflowService(new FakeWorkflowRepository(wf));

            expect(await service.getStatus('wf-1', 'client-1')).toEqual({
                workflowId: 'wf-1',
                status: WorkflowStatus.Initial,
                completedTasks: 2,
                totalTasks: 3,
            });
        });

        it('throws WorkflowNotFoundError (→404) when the workflow does not exist', async () => {
            const service = new WorkflowService(new FakeWorkflowRepository(null));
            await expect(service.getStatus('missing', 'client-1')).rejects.toBeInstanceOf(WorkflowNotFoundError);
        });

        it('throws WorkflowForbiddenError (→403) when the client does not own the workflow', async () => {
            const wf = workflow({ workflowId: 'wf-1', clientId: 'owner', status: WorkflowStatus.Initial, tasks: [] });
            const service = new WorkflowService(new FakeWorkflowRepository(wf));
            await expect(service.getStatus('wf-1', 'intruder')).rejects.toBeInstanceOf(WorkflowForbiddenError);
        });
    });

    describe('getResults', () => {
        it('returns the deserialized finalResult of a completed workflow (task A.6)', async () => {
            const finalResult = { workflowId: 'wf-1', status: WorkflowStatus.Completed, tasks: [{ stepNumber: 1, output: 'Brazil' }] };
            const wf = workflow({ workflowId: 'wf-1', clientId: 'client-1', status: WorkflowStatus.Completed, finalResult: JSON.stringify(finalResult) });
            const service = new WorkflowService(new FakeWorkflowRepository(wf));

            const result = await service.getResults('wf-1', 'client-1');

            expect(result.status).toBe(WorkflowStatus.Completed);
            expect(result.finalResult).toEqual(finalResult);
        });

        it('throws WorkflowNotFoundError (→404) when the workflow does not exist', async () => {
            const service = new WorkflowService(new FakeWorkflowRepository(null));
            await expect(service.getResults('missing', 'client-1')).rejects.toBeInstanceOf(WorkflowNotFoundError);
        });

        it('throws WorkflowForbiddenError (→403) when the client does not own the workflow', async () => {
            const wf = workflow({ workflowId: 'wf-1', clientId: 'owner', status: WorkflowStatus.Completed, finalResult: '{}' });
            const service = new WorkflowService(new FakeWorkflowRepository(wf));
            await expect(service.getResults('wf-1', 'intruder')).rejects.toBeInstanceOf(WorkflowForbiddenError);
        });

        it('returns the deserialized finalResult of a failed workflow', async () => {
            const finalResult = {
                workflowId: 'wf-1',
                status: WorkflowStatus.Failed,
                tasks: [{ stepNumber: 1, status: TaskStatus.Failed, output: null, error: 'boom' }],
            };
            const wf = workflow({ workflowId: 'wf-1', clientId: 'client-1', status: WorkflowStatus.Failed, finalResult: JSON.stringify(finalResult) });
            const service = new WorkflowService(new FakeWorkflowRepository(wf));

            const result = await service.getResults('wf-1', 'client-1');

            expect(result.status).toBe(WorkflowStatus.Failed);
            expect(result.finalResult).toEqual(finalResult);
        });

        it('throws WorkflowNotTerminalError (→400) carrying the current status when not finished', async () => {
            const wf = workflow({ workflowId: 'wf-1', clientId: 'client-1', status: WorkflowStatus.Initial });
            const service = new WorkflowService(new FakeWorkflowRepository(wf));

            await expect(service.getResults('wf-1', 'client-1')).rejects.toMatchObject({
                name: 'WorkflowNotTerminalError',
                status: WorkflowStatus.Initial,
            });
            await expect(service.getResults('wf-1', 'client-1')).rejects.toBeInstanceOf(WorkflowNotTerminalError);
        });

        it('throws WorkflowNotTerminalError (→400) while the workflow is in_progress', async () => {
            const wf = workflow({ workflowId: 'wf-1', clientId: 'client-1', status: WorkflowStatus.InProgress });
            const service = new WorkflowService(new FakeWorkflowRepository(wf));

            await expect(service.getResults('wf-1', 'client-1')).rejects.toBeInstanceOf(WorkflowNotTerminalError);
        });
    });
});
