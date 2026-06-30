import { summarizeTaskOutputs } from '../../src/workflows/taskSummary';
import { TaskStatus } from '../../src/workers/taskStatus';
import { DependencyOutput } from '../../src/jobs/Job';

// Shared aggregation used both by the report job (task A.2) and by the workflow's
// finalResult (task A.4): ordering and the "include failure information" requirement.
describe('summarizeTaskOutputs', () => {
    it('orders the summary by step number regardless of input order', () => {
        const outputs: DependencyOutput[] = [
            { taskId: 'b', type: 't', status: TaskStatus.Completed, stepNumber: 3, output: 'c' },
            { taskId: 'a', type: 't', status: TaskStatus.Completed, stepNumber: 1, output: 'a' },
            { taskId: 'c', type: 't', status: TaskStatus.Completed, stepNumber: 2, output: 'b' },
        ];
        expect(summarizeTaskOutputs(outputs).map(o => o.stepNumber)).toEqual([1, 2, 3]);
    });

    it('nulls the output of a failed task and surfaces its error message', () => {
        const [summary] = summarizeTaskOutputs([{ taskId: 'a', type: 'polygonArea', status: TaskStatus.Failed, stepNumber: 1, output: 'stale', error: 'Invalid GeoJSON' }]);
        expect(summary.output).toBeNull();
        expect(summary.error).toBe('Invalid GeoJSON');
    });

    it('falls back to a generic error when a failed task has no message', () => {
        const [summary] = summarizeTaskOutputs([{ taskId: 'a', type: 'polygonArea', status: TaskStatus.Failed, stepNumber: 1, output: null }]);
        expect(summary.error).toBe('Task failed');
    });

    it('does not attach an error to completed tasks', () => {
        const [summary] = summarizeTaskOutputs([{ taskId: 'a', type: 'analysis', status: TaskStatus.Completed, stepNumber: 1, output: 'Brazil' }]);
        expect(summary.output).toBe('Brazil');
        expect(summary.error).toBeUndefined();
    });

    // A task whose dependency failed is itself marked Failed, carrying the unsatisfied-dependency
    // reason — the summary nulls its output and surfaces that reason.
    it('nulls the output and surfaces the reason of a task failed by an unsatisfied dependency', () => {
        const [summary] = summarizeTaskOutputs([{ taskId: 'a', type: 'polygonArea', status: TaskStatus.Failed, stepNumber: 2, output: null, error: 'dependencies not satisfied: dep-1' }]);
        expect(summary.status).toBe(TaskStatus.Failed);
        expect(summary.output).toBeNull();
        expect(summary.error).toMatch(/dep-1/);
    });
});
