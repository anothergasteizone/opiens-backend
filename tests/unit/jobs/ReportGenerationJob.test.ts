import { ReportGenerationJob } from '../../../src/jobs/ReportGenerationJob';
import { Task } from '../../../src/models/Task';
import { Workflow } from '../../../src/models/Workflow';
import { TaskStatus } from '../../../src/workers/taskStatus';
import { DependencyOutput } from '../../../src/jobs/Job';

function reportTask(workflowId: string): Task {
    const task = new Task();
    task.taskId = 'report-task';
    task.workflow = Object.assign(new Workflow(), { workflowId });
    return task;
}

// Challenge task A.2: aggregate preceding task outputs into a report, including the
// error information of tasks that failed.
describe('ReportGenerationJob', () => {
    // ReportGenerationJob is a thin wrapper over summarizeTaskOutputs (which owns the per-field
    // output/error mapping — see summarizeTaskOutputs.test.ts). Assert only what the wrapper adds:
    // the workflowId passthrough, the constant finalReport, and that the report tasks come from the
    // supplied dependencies (failure info included). The toleratesFailedDependencies flag is
    // exercised behaviourally through the runner in TaskRunner.test.ts.
    it('wraps the summarized preceding outputs into a report payload', async () => {
        const dependencies: Record<string, DependencyOutput> = {
            a: { taskId: 'a', type: 'analysis', status: TaskStatus.Completed, stepNumber: 1, output: 'Brazil' },
            b: { taskId: 'b', type: 'polygonArea', status: TaskStatus.Failed, stepNumber: 2, output: null, error: 'Invalid GeoJSON' },
        };

        const report = (await new ReportGenerationJob().run(reportTask('wf-1'), dependencies)) as {
            workflowId: string;
            tasks: Array<{ stepNumber: number; output: unknown; error?: string }>;
            finalReport: string;
        };

        expect(report.workflowId).toBe('wf-1');
        expect(report.finalReport).toBe('Aggregated data and results');
        expect(report.tasks).toHaveLength(2);
        expect(report.tasks[1]).toMatchObject({ stepNumber: 2, output: null, error: 'Invalid GeoJSON' });
    });
});
