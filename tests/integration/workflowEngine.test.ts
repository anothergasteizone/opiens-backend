import { DataSource } from 'typeorm';
import { WorkflowFactory } from '../../src/workflows/WorkflowFactory';
import { TaskRepository } from '../../src/repositories/TaskRepository';
import { WorkflowRepository } from '../../src/repositories/WorkflowRepository';
import { WorkflowCompletionService } from '../../src/services/WorkflowCompletionService';
import { WorkflowService } from '../../src/services/WorkflowService';
import { TaskRunner } from '../../src/workers/taskRunner';
import { WorkflowStatus } from '../../src/workflows/WorkflowStatus';
import { TaskStatus } from '../../src/workers/taskStatus';
import { Task } from '../../src/models/Task';
import { Workflow } from '../../src/models/Workflow';
import { createTestDataSource, InMemoryDefinitionLoader, validPolygonJson } from '../helpers/fixtures';

const CLIENT = 'client-1';

// The default workflow: analysis (1) and notification (2) and polygonArea (3) run
// independently; reportGeneration (4) depends on all three.
const definition = {
    name: 'example_workflow',
    steps: [
        { taskType: 'analysis', stepNumber: 1 },
        { taskType: 'notification', stepNumber: 2 },
        { taskType: 'polygonArea', stepNumber: 3 },
        { taskType: 'reportGeneration', stepNumber: 4, dependsOn: [1, 2, 3] },
    ],
};

/** Drains the queue the way the worker would, but synchronously and without the 5s wait. */
async function runAllTasks(taskRepository: TaskRepository, runner: TaskRunner): Promise<void> {
    let next: Task | null;
    while ((next = await taskRepository.findNextRunnable())) {
        await runner.run(next).catch(() => {
            /* failures are persisted on the task; keep draining */
        });
    }
}

describe('Workflow engine (end-to-end, in-memory DB)', () => {
    let dataSource: DataSource;

    beforeEach(async () => {
        dataSource = await createTestDataSource();
    });

    afterEach(async () => {
        await dataSource.destroy();
    });

    it('runs a full workflow and exposes status and aggregated results', async () => {
        const taskRepository = new TaskRepository(dataSource);
        const completion = new WorkflowCompletionService(taskRepository);
        const runner = new TaskRunner(taskRepository, completion);
        const factory = new WorkflowFactory(dataSource, new InMemoryDefinitionLoader(definition));
        const workflowService = new WorkflowService(new WorkflowRepository(dataSource));

        const created = await factory.createWorkflow('ignored', CLIENT, validPolygonJson);

        // While nothing has run yet, the read endpoints already behave (task A.5/A.6).
        const initialStatus = await workflowService.getStatus(created.workflowId, CLIENT);
        expect(initialStatus.totalTasks).toBe(4);
        expect(initialStatus.completedTasks).toBe(0);

        // After one task runs (three still queued), the workflow reports in_progress against the
        // real DB — driven by the cheap markInProgressIfInitial UPDATE on the completion gate path
        // (task A.5). Then drain the rest.
        const firstTask = await taskRepository.findNextRunnable();
        await runner.run(firstTask!);
        const midStatus = await workflowService.getStatus(created.workflowId, CLIENT);
        expect(midStatus.status).toBe(WorkflowStatus.InProgress);
        expect(midStatus.completedTasks).toBeGreaterThan(0);
        expect(midStatus.completedTasks).toBeLessThan(midStatus.totalTasks);

        await runAllTasks(taskRepository, runner);

        const status = await workflowService.getStatus(created.workflowId, CLIENT);
        expect(status.status).toBe(WorkflowStatus.Completed);
        expect(status.completedTasks).toBe(4);
        expect(status.totalTasks).toBe(4);

        const results = await workflowService.getResults(created.workflowId, CLIENT);
        const finalResult = results.finalResult as { tasks: Array<{ stepNumber: number; type: string; output: unknown }> };
        const tasks = finalResult.tasks;
        expect(tasks.map(t => t.stepNumber)).toEqual([1, 2, 3, 4]);

        // Task A.2/A.3: the report ran last and aggregated the three preceding tasks.
        const report = tasks.find(t => t.stepNumber === 4)!;
        expect((report.output as { tasks: unknown[] }).tasks).toHaveLength(3);

        // Task A.1: the polygon area is present in the aggregated result.
        const polygonArea = tasks.find(t => t.stepNumber === 3)!;
        expect(polygonArea.output).toMatchObject({ unit: 'square_meters' });
    });

    // Crash recovery: a task left in_progress by a dead worker is returned to queued at
    // startup, so it is retried instead of being stranded forever.
    it('requeues an interrupted (in_progress) task on startup', async () => {
        const taskRepository = new TaskRepository(dataSource);
        const factory = new WorkflowFactory(dataSource, new InMemoryDefinitionLoader(definition));
        await factory.createWorkflow('ignored', CLIENT, validPolygonJson);

        // Simulate a worker that claimed a task and then crashed mid-execution.
        const claimed = await taskRepository.findNextRunnable();
        claimed!.status = TaskStatus.InProgress;
        await taskRepository.save(claimed!);
        expect((await taskRepository.findNextRunnable())!.taskId).not.toBe(claimed!.taskId);

        // The startup sweep brings it back so the (single) worker will pick it up again.
        await taskRepository.requeueInterruptedTasks();

        const reloaded = await dataSource.getRepository(Task).findOneByOrFail({ taskId: claimed!.taskId });
        expect(reloaded.status).toBe(TaskStatus.Queued);
        expect(reloaded.progress).toBeNull();
    });

    // Crash recovery (persistent DB): a workflow whose tasks all finished but whose status was
    // never persisted (crash in TaskRunner's finalization step) is finalized by the startup
    // reconciliation, instead of being stranded non-terminal with no queued task to revive it.
    it('reconciles a workflow left non-terminal after all its tasks completed', async () => {
        const taskRepository = new TaskRepository(dataSource);
        const completion = new WorkflowCompletionService(taskRepository);
        const runner = new TaskRunner(taskRepository, completion);
        const factory = new WorkflowFactory(dataSource, new InMemoryDefinitionLoader(definition));
        const workflowService = new WorkflowService(new WorkflowRepository(dataSource));

        const created = await factory.createWorkflow('ignored', CLIENT, validPolygonJson);
        await runAllTasks(taskRepository, runner);

        // Simulate the crash: tasks stay terminal, but the workflow is rolled back to a
        // non-terminal state with no finalResult, as if updateStatus never ran.
        await dataSource.getRepository(Workflow).update({ workflowId: created.workflowId }, { status: WorkflowStatus.InProgress, finalResult: null });

        // Startup reconciliation, exactly as taskWorker performs it before its loop.
        await taskRepository.requeueInterruptedTasks();
        for (const id of await taskRepository.findUnfinishedWorkflowIds()) {
            await completion.updateStatus(id);
        }

        const results = await workflowService.getResults(created.workflowId, CLIENT);
        expect(results.status).toBe(WorkflowStatus.Completed);
        expect(results.finalResult).not.toBeNull();
    });

    // Note: dependency gating (a dependent task is not runnable until its deps are terminal) is
    // covered more strongly in workflowFactory.test.ts, which uses an out-of-order definition
    // (step 2 dependsOn step 3) so it proves the query honours dependency edges, not just stepNumber.
});
