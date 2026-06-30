import { WorkflowCompletionService, IWorkflowCompletionRepository } from '../../src/services/WorkflowCompletionService';
import { Workflow } from '../../src/models/Workflow';
import { Task } from '../../src/models/Task';
import { TaskStatus, TERMINAL_TASK_STATUSES } from '../../src/workers/taskStatus';
import { WorkflowStatus } from '../../src/workflows/WorkflowStatus';
import { DependencyOutput } from '../../src/jobs/Job';

function task(taskId: string, status: TaskStatus, stepNumber: number): Task {
    return Object.assign(new Task(), { taskId, status, stepNumber, taskType: 'analysis' });
}

class FakeCompletionRepository implements IWorkflowCompletionRepository {
    saved?: Workflow;
    constructor(
        private readonly workflow: Workflow | null,
        private readonly outputs: Record<string, DependencyOutput> = {}
    ) {}
    async hasUnfinishedTasks(): Promise<boolean> {
        // Mirror the real repository: a task is "unfinished" only if it is NOT in a terminal state.
        return (this.workflow?.tasks ?? []).some(t => !TERMINAL_TASK_STATUSES.includes(t.status));
    }
    async markInProgressIfInitial(): Promise<void> {
        if (this.workflow?.status === WorkflowStatus.Initial) {
            this.workflow.status = WorkflowStatus.InProgress;
        }
    }
    async loadWorkflowWithTasks(): Promise<Workflow | null> {
        return this.workflow;
    }
    async saveWorkflow(workflow: Workflow): Promise<Workflow> {
        this.saved = workflow;
        return workflow;
    }
    async getOutputsFor(): Promise<Record<string, DependencyOutput>> {
        return this.outputs;
    }
}

// Challenge task A.4: aggregate every task into finalResult once the workflow ends,
// including failure information.
describe('WorkflowCompletionService.updateStatus', () => {
    it('marks the workflow completed and persists finalResult when every task completed', async () => {
        const wf = Object.assign(new Workflow(), {
            workflowId: 'wf-1',
            status: WorkflowStatus.Initial,
            tasks: [task('a', TaskStatus.Completed, 1), task('b', TaskStatus.Completed, 2)],
        });
        const outputs: Record<string, DependencyOutput> = {
            a: { taskId: 'a', type: 'analysis', status: TaskStatus.Completed, stepNumber: 1, output: 'Brazil' },
            b: { taskId: 'b', type: 'polygonArea', status: TaskStatus.Completed, stepNumber: 2, output: { calculatedArea: 42 } },
        };
        const repo = new FakeCompletionRepository(wf, outputs);

        await new WorkflowCompletionService(repo).updateStatus('wf-1');

        expect(repo.saved!.status).toBe(WorkflowStatus.Completed);
        const finalResult = JSON.parse(repo.saved!.finalResult!);
        expect(finalResult.status).toBe(WorkflowStatus.Completed);
        expect(finalResult.tasks).toHaveLength(2);
        expect(finalResult.tasks.map((t: { stepNumber: number }) => t.stepNumber)).toEqual([1, 2]);
    });

    it('marks the workflow failed and includes failure information in finalResult', async () => {
        const wf = Object.assign(new Workflow(), {
            workflowId: 'wf-1',
            status: WorkflowStatus.Initial,
            tasks: [task('a', TaskStatus.Completed, 1), task('b', TaskStatus.Failed, 2)],
        });
        const outputs: Record<string, DependencyOutput> = {
            a: { taskId: 'a', type: 'analysis', status: TaskStatus.Completed, stepNumber: 1, output: 'Brazil' },
            b: { taskId: 'b', type: 'polygonArea', status: TaskStatus.Failed, stepNumber: 2, output: null, error: 'Invalid GeoJSON' },
        };
        const repo = new FakeCompletionRepository(wf, outputs);

        await new WorkflowCompletionService(repo).updateStatus('wf-1');

        expect(repo.saved!.status).toBe(WorkflowStatus.Failed);
        const finalResult = JSON.parse(repo.saved!.finalResult!);
        const failed = finalResult.tasks.find((t: { stepNumber: number }) => t.stepNumber === 2);
        expect(failed).toMatchObject({ output: null, error: 'Invalid GeoJSON' });
    });

    it('does not finalize (no load, no save) while any task is still pending', async () => {
        const wf = Object.assign(new Workflow(), {
            workflowId: 'wf-1',
            status: WorkflowStatus.Initial,
            tasks: [task('a', TaskStatus.Completed, 1), task('b', TaskStatus.Queued, 2)],
        });
        const repo = new FakeCompletionRepository(wf);

        await new WorkflowCompletionService(repo).updateStatus('wf-1');

        // The cheap gate short-circuits: nothing is written until the workflow truly ends.
        expect(repo.saved).toBeUndefined();
    });

    it('promotes the workflow to in_progress (without finalizing) while a task is still pending', async () => {
        const wf = Object.assign(new Workflow(), {
            workflowId: 'wf-1',
            status: WorkflowStatus.Initial,
            tasks: [task('a', TaskStatus.Completed, 1), task('b', TaskStatus.Queued, 2)],
        });
        const repo = new FakeCompletionRepository(wf);

        await new WorkflowCompletionService(repo).updateStatus('wf-1');

        // The status reflects that work has started, but finalResult is NOT built yet.
        expect(wf.status).toBe(WorkflowStatus.InProgress);
        expect(repo.saved).toBeUndefined();
    });

    // The requirement: even when the workflow fails, finalResult must carry the outputs of every
    // completed task plus failure info. Because finalResult is built only once all tasks are
    // terminal, tasks that completed *after* an earlier failure are still included.
    it('includes outputs of tasks completed after a failure in the final result', async () => {
        const wf = Object.assign(new Workflow(), {
            workflowId: 'wf-1',
            status: WorkflowStatus.Initial,
            tasks: [task('a', TaskStatus.Failed, 1), task('b', TaskStatus.Completed, 2), task('c', TaskStatus.Completed, 3)],
        });
        const outputs: Record<string, DependencyOutput> = {
            a: { taskId: 'a', type: 'analysis', status: TaskStatus.Failed, stepNumber: 1, output: null, error: 'boom' },
            b: { taskId: 'b', type: 'polygonArea', status: TaskStatus.Completed, stepNumber: 2, output: { calculatedArea: 42 } },
            c: { taskId: 'c', type: 'analysis', status: TaskStatus.Completed, stepNumber: 3, output: 'Brazil' },
        };
        const repo = new FakeCompletionRepository(wf, outputs);

        await new WorkflowCompletionService(repo).updateStatus('wf-1');

        expect(repo.saved!.status).toBe(WorkflowStatus.Failed);
        const finalResult = JSON.parse(repo.saved!.finalResult!);
        expect(finalResult.tasks).toHaveLength(3);
        expect(finalResult.tasks.find((t: { stepNumber: number }) => t.stepNumber === 1)).toMatchObject({ error: 'boom' });
        expect(finalResult.tasks.find((t: { stepNumber: number }) => t.stepNumber === 2).output).toEqual({ calculatedArea: 42 });
        expect(finalResult.tasks.find((t: { stepNumber: number }) => t.stepNumber === 3).output).toBe('Brazil');
    });

    // A cascade of failures after a real failure still resolves the workflow to Failed. Mirrors:
    // A fails -> B (dep of A) fails -> C (dep of B) fails. Every task is terminal, so the workflow
    // finalizes, and the dependency-blocked tasks carry their reason.
    it('finalizes as failed when tasks cascade-fail after a failure', async () => {
        const wf = Object.assign(new Workflow(), {
            workflowId: 'wf-1',
            status: WorkflowStatus.Initial,
            tasks: [task('a', TaskStatus.Failed, 1), task('b', TaskStatus.Failed, 2), task('c', TaskStatus.Failed, 3)],
        });
        const outputs: Record<string, DependencyOutput> = {
            a: { taskId: 'a', type: 'analysis', status: TaskStatus.Failed, stepNumber: 1, output: null, error: 'boom' },
            b: { taskId: 'b', type: 'polygonArea', status: TaskStatus.Failed, stepNumber: 2, output: null, error: 'dependencies not satisfied: a' },
            c: { taskId: 'c', type: 'reportGeneration', status: TaskStatus.Failed, stepNumber: 3, output: null, error: 'dependencies not satisfied: b' },
        };
        const repo = new FakeCompletionRepository(wf, outputs);

        await new WorkflowCompletionService(repo).updateStatus('wf-1');

        expect(repo.saved!.status).toBe(WorkflowStatus.Failed);
        const finalResult = JSON.parse(repo.saved!.finalResult!);
        expect(finalResult.tasks).toHaveLength(3);
        expect(finalResult.tasks.find((t: { stepNumber: number }) => t.stepNumber === 2)).toMatchObject({
            status: TaskStatus.Failed,
            output: null,
            error: expect.stringMatching(/not satisfied/),
        });
    });

    it('does nothing when the workflow does not exist', async () => {
        const repo = new FakeCompletionRepository(null);
        await new WorkflowCompletionService(repo).updateStatus('missing');
        expect(repo.saved).toBeUndefined();
    });

    // Finalization is idempotent. A redundant call on an already-terminal workflow
    // (e.g. startup reconciliation racing the last task's finally) must not rebuild/rewrite.
    it('does not re-finalize a workflow that is already terminal', async () => {
        const wf = Object.assign(new Workflow(), {
            workflowId: 'wf-1',
            status: WorkflowStatus.Completed,
            finalResult: '{"already":"built"}',
            tasks: [task('a', TaskStatus.Completed, 1)],
        });
        const repo = new FakeCompletionRepository(wf);

        await new WorkflowCompletionService(repo).updateStatus('wf-1');

        expect(repo.saved).toBeUndefined();
        expect(wf.finalResult).toBe('{"already":"built"}');
    });
});
