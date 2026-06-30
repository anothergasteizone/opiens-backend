import type { DependencyOutput } from '../jobs/Job';
import { TaskStatus } from '../workers/taskStatus';

export type TaskOutputSummary = DependencyOutput;

export function summarizeTaskOutputs(outputs: DependencyOutput[]): TaskOutputSummary[] {
    return [...outputs]
        .sort((a, b) => a.stepNumber - b.stepNumber)
        .map(o => {
            const failed = o.status === TaskStatus.Failed;
            const errorInfo = failed ? { error: o.error ?? 'Task failed' } : {};
            return {
                taskId: o.taskId,
                type: o.type,
                stepNumber: o.stepNumber,
                status: o.status,
                output: failed ? null : o.output,
                ...errorInfo,
            };
        });
}
