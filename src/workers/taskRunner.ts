import { Task } from '../models/Task';
import { getJobForTaskType } from '../jobs/JobFactory';
import type { Job } from '../jobs/Job';
import { Result } from '../models/Result';
import type { ITaskRepository } from '../repositories/TaskRepository';
import type { WorkflowCompletionService } from '../services/WorkflowCompletionService';
import { TaskStatus } from './taskStatus';

export class TaskRunner {
    constructor(
        private readonly taskRepository: ITaskRepository,
        private readonly workflowCompletion: WorkflowCompletionService
    ) {}

    /**
     * Drives a task through its lifecycle: claim -> dependency gate -> execute -> persist outcome,
     * and re-evaluates workflow completion afterwards no matter how it ended. Each phase is a small
     * private method, so run() reads as the high-level sequence and nothing else.
     */
    async run(task: Task): Promise<void> {
        await this.claim(task);

        try {
            const job = getJobForTaskType(task.taskType);
            const deps = task.dependencies ?? [];

            const blocking = this.blockingDependencies(job, deps);
            if (blocking.length) {
                await this.markFailed(task, `dependencies not satisfied: ${blocking.map(d => d.taskId).join(', ')}`);
                return;
            }

            const dependencyOutputs = await this.taskRepository.getOutputsFor(deps);
            const output = await job.run(task, dependencyOutputs);
            await this.markCompleted(task, output);
        } catch (error: unknown) {
            console.error(`Error running job ${task.taskType} for task ${task.taskId}:`, error);
            await this.markFailed(task, this.toMessage(error));
            throw error;
        } finally {
            await this.workflowCompletion.updateStatus(task.workflow.workflowId);
        }
    }

    /** Claims the task out of the queued pool while it executes. */
    private async claim(task: Task): Promise<void> {
        task.status = TaskStatus.InProgress;
        task.progress = 'starting job...';
        await this.taskRepository.save(task);
    }

    /**
     * Dependencies are already terminal here (the findNextRunnable gate guarantees it), so one only
     * blocks the task if it FAILED and the job cannot tolerate a failed dependency.
     */
    private blockingDependencies(job: Job, deps: Task[]): Task[] {
        if (job.toleratesFailedDependencies) return [];
        return deps.filter(d => d.status === TaskStatus.Failed);
    }

    /**
     * Marks the task as complete.
     */
    private async markCompleted(task: Task, output: unknown): Promise<void> {
        const result = new Result();
        result.taskId = task.taskId!;
        result.data = JSON.stringify(output ?? {});
        task.status = TaskStatus.Completed;
        task.progress = null;
        await this.taskRepository.saveResultForTask(task, result);
        console.log(`Job ${task.taskType} for task ${task.taskId} completed successfully.`);
    }

    /**
     * Marks the task failed with a human-readable reason.
     */
    private async markFailed(task: Task, reason: string): Promise<void> {
        task.status = TaskStatus.Failed;
        task.progress = reason;
        await this.taskRepository.save(task);
    }

    private toMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
