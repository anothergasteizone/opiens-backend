import type { Job, DependencyOutput } from './Job';
import { Task } from '../models/Task';
import { summarizeTaskOutputs, type TaskOutputSummary } from '../workflows/taskSummary';

export class ReportGenerationJob implements Job {
    toleratesFailedDependencies = true;
    dependsOnPrecedingTasks = true;

    async run(task: Task, dependencies: Record<string, DependencyOutput> = {}): Promise<{ workflowId: string; tasks: TaskOutputSummary[]; finalReport: string }> {
        console.log(`Generating report for workflow ${task.workflow.workflowId}...`);

        const reportTasks = summarizeTaskOutputs(Object.values(dependencies));

        return {
            workflowId: task.workflow.workflowId,
            tasks: reportTasks,
            finalReport: 'Aggregated data and results',
        };
    }
}
