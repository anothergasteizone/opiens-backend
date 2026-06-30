import { Workflow } from '../models/Workflow';
import { Task } from '../models/Task';
import { WorkflowStatus } from '../workflows/WorkflowStatus';
import { TaskStatus } from '../workers/taskStatus';
import { summarizeTaskOutputs, type TaskOutputSummary } from '../workflows/taskSummary';
import type { DependencyOutput } from '../jobs/Job';

export interface IWorkflowCompletionRepository {
    hasUnfinishedTasks(workflowId: string): Promise<boolean>;
    markInProgressIfInitial(workflowId: string): Promise<void>;
    loadWorkflowWithTasks(workflowId: string): Promise<Workflow | null>;
    saveWorkflow(workflow: Workflow): Promise<Workflow>;
    getOutputsFor(tasks: Task[]): Promise<Record<string, DependencyOutput>>;
}

export class WorkflowCompletionService {
    constructor(private readonly repository: IWorkflowCompletionRepository) {}

    async updateStatus(workflowId: string): Promise<void> {
        if (await this.repository.hasUnfinishedTasks(workflowId)) {
            await this.repository.markInProgressIfInitial(workflowId);
            return;
        }

        const workflow = await this.repository.loadWorkflowWithTasks(workflowId);
        if (!workflow) return;

        if (workflow.status === WorkflowStatus.Completed || workflow.status === WorkflowStatus.Failed) return;

        workflow.status = this.deriveStatus(workflow);
        workflow.finalResult = JSON.stringify(await this.buildFinalResult(workflow));
        await this.repository.saveWorkflow(workflow);
    }

    private deriveStatus(workflow: Workflow): WorkflowStatus {
        const anyFailed = workflow.tasks.some(t => t.status === TaskStatus.Failed);
        return anyFailed ? WorkflowStatus.Failed : WorkflowStatus.Completed;
    }

    private async buildFinalResult(workflow: Workflow): Promise<{ workflowId: string; status: WorkflowStatus; tasks: TaskOutputSummary[] }> {
        const outputs = await this.repository.getOutputsFor(workflow.tasks);
        const tasks = summarizeTaskOutputs(Object.values(outputs));

        return { workflowId: workflow.workflowId, status: workflow.status, tasks };
    }
}
