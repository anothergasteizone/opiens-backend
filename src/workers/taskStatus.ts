export enum TaskStatus {
    Queued = 'queued',
    InProgress = 'in_progress',
    Completed = 'completed',
    Failed = 'failed',
}

/** Task states that count as terminal (the task will not transition further). */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [TaskStatus.Completed, TaskStatus.Failed];
