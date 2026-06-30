import { DataSource } from 'typeorm';
import { WorkflowFactory } from '../../src/workflows/WorkflowFactory';
import { TaskRepository } from '../../src/repositories/TaskRepository';
import { Task } from '../../src/models/Task';
import { TaskStatus } from '../../src/workers/taskStatus';
import { createTestDataSource, InMemoryDefinitionLoader, validPolygonJson } from '../helpers/fixtures';

const CLIENT = 'client-1';

// A definition where stepNumber order does NOT match dependency order: step 2 depends on
// step 3. This matters because, if dependency rows lagged behind the `queued`
// transition, step 2 would be schedulable before step 3, out of order.
const definition = {
    name: 'out_of_order',
    steps: [
        { taskType: 'analysis', stepNumber: 1 },
        { taskType: 'notification', stepNumber: 2, dependsOn: [3] },
        { taskType: 'polygonArea', stepNumber: 3 },
    ],
};

describe('WorkflowFactory (single atomic save)', () => {
    let dataSource: DataSource;

    beforeEach(async () => {
        dataSource = await createTestDataSource();
    });

    afterEach(async () => {
        await dataSource.destroy();
    });

    it('persists task_dependencies in the same save that queues the tasks', async () => {
        const factory = new WorkflowFactory(dataSource, new InMemoryDefinitionLoader(definition));

        const created = await factory.createWorkflow('ignored', CLIENT, validPolygonJson);

        // Reload from the DB (not the in-memory graph) to prove the cascade actually wrote
        // the join rows, not just the in-memory references.
        const reloaded = await dataSource.getRepository(Task).find({ where: { workflow: { workflowId: created.workflowId } }, relations: ['dependencies'] });

        const step2 = reloaded.find(t => t.stepNumber === 2)!;
        const step3 = reloaded.find(t => t.stepNumber === 3)!;

        // All tasks are queued AND the dependency is already linked — atomically.
        expect(reloaded.every(t => t.status === TaskStatus.Queued)).toBe(true);
        expect(step2.dependencies.map(d => d.stepNumber)).toEqual([3]);
    });

    it('never exposes a dependent task as runnable before its dependency, even when stepNumber order disagrees', async () => {
        const taskRepository = new TaskRepository(dataSource);
        const factory = new WorkflowFactory(dataSource, new InMemoryDefinitionLoader(definition));

        await factory.createWorkflow('ignored', CLIENT, validPolygonJson);

        // Step 2 depends on step 3, so the next runnable task must be step 1 or step 3 —
        // never step 2, despite step 2 having a lower stepNumber than step 3.
        const next = await taskRepository.findNextRunnable();
        expect(next).not.toBeNull();
        expect(next!.stepNumber).not.toBe(2);
    });

    // An aggregator (reportGeneration) implicitly depends on every preceding step (challenge task
    // 2): the factory wires it to all lower stepNumbers WITHOUT any explicit `dependsOn`, so the
    // report waits for them and receives their outputs through the same dependency machinery.
    it('infers the aggregator dependencies from preceding steps without an explicit dependsOn', async () => {
        const aggregatorDef = {
            name: 'implicit_aggregator',
            steps: [
                { taskType: 'analysis', stepNumber: 1 },
                { taskType: 'polygonArea', stepNumber: 2 },
                { taskType: 'reportGeneration', stepNumber: 3 },
            ],
        };
        const factory = new WorkflowFactory(dataSource, new InMemoryDefinitionLoader(aggregatorDef));

        const created = await factory.createWorkflow('ignored', CLIENT, validPolygonJson);

        const reloaded = await dataSource.getRepository(Task).find({ where: { workflow: { workflowId: created.workflowId } }, relations: ['dependencies'] });
        const aggregator = reloaded.find(t => t.stepNumber === 3)!;

        expect(aggregator.dependencies.map(d => d.stepNumber).sort()).toEqual([1, 2]);
    });

    // Explicit `dependsOn` (task 3) and the implicit aggregator edges (task 2) compose: the union
    // is persisted, with no duplicate links when they overlap.
    it('unions explicit dependsOn with the implicit preceding-step edges', async () => {
        const mixedDef = {
            name: 'mixed_aggregator',
            steps: [
                { taskType: 'analysis', stepNumber: 1 },
                { taskType: 'polygonArea', stepNumber: 2 },
                { taskType: 'reportGeneration', stepNumber: 3, dependsOn: [1] },
            ],
        };
        const factory = new WorkflowFactory(dataSource, new InMemoryDefinitionLoader(mixedDef));

        const created = await factory.createWorkflow('ignored', CLIENT, validPolygonJson);

        const reloaded = await dataSource.getRepository(Task).find({ where: { workflow: { workflowId: created.workflowId } }, relations: ['dependencies'] });
        const aggregator = reloaded.find(t => t.stepNumber === 3)!;

        expect(aggregator.dependencies.map(d => d.stepNumber).sort()).toEqual([1, 2]);
    });
});
