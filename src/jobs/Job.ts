import { Task } from '../models/Task';
import type { TaskStatus } from '../workers/taskStatus';

export interface DependencyOutput {
    taskId: string;
    type: string;
    status: TaskStatus;
    stepNumber: number;
    output: unknown;
    error?: string;
}

export interface Job {
    run(task: Task, dependencies?: Record<string, DependencyOutput>): Promise<unknown>;
    // If the jobs should run if any dependency failed.
    toleratesFailedDependencies?: boolean;
    // If true, the task implicitly depends on every preceding step (lower stepNumber) in the
    // workflow, because the job aggregates their outputs.
    dependsOnPrecedingTasks?: boolean;
}
