import { DataSource, In, Not, Repository } from 'typeorm';
import { Task } from '../models/Task';
import { Result } from '../models/Result';
import { Workflow } from '../models/Workflow';
import { TaskStatus, TERMINAL_TASK_STATUSES } from '../workers/taskStatus';
import { WorkflowStatus } from '../workflows/WorkflowStatus';
import type { DependencyOutput } from '../jobs/Job';

function parseResultData(data: string | null | undefined): unknown {
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch {
        return data;
    }
}

export interface ITaskRepository {
    findNextRunnable(): Promise<Task | null>;
    requeueInterruptedTasks(): Promise<void>;
    findUnfinishedWorkflowIds(): Promise<string[]>;
    hasUnfinishedTasks(workflowId: string): Promise<boolean>;
    markInProgressIfInitial(workflowId: string): Promise<void>;
    getOutputsFor(tasks: Task[]): Promise<Record<string, DependencyOutput>>;
    save(task: Task): Promise<Task>;
    saveResultForTask(task: Task, result: Result): Promise<void>;
    loadWorkflowWithTasks(workflowId: string): Promise<Workflow | null>;
    saveWorkflow(workflow: Workflow): Promise<Workflow>;
}

export class TaskRepository implements ITaskRepository {
    private readonly tasks: Repository<Task>;
    private readonly results: Repository<Result>;
    private readonly workflows: Repository<Workflow>;

    constructor(dataSource: DataSource) {
        this.tasks = dataSource.getRepository(Task);
        this.results = dataSource.getRepository(Result);
        this.workflows = dataSource.getRepository(Workflow);
    }

    /**
     * Finds the next queued task taking into account dependencies.
     */
    async findNextRunnable(): Promise<Task | null> {
        return this.tasks
            .createQueryBuilder('task')
            .leftJoinAndSelect('task.workflow', 'workflow')
            .leftJoinAndSelect('task.dependencies', 'dependencies')
            .where('task.status = :queued', { queued: TaskStatus.Queued })
            .andWhere(qb => {
                const sub = qb
                    .subQuery()
                    .select('1')
                    .from('task_dependencies', 'td')
                    .innerJoin(Task, 'dep', 'dep.taskId = td.dependsOnTaskId')
                    .where('td.taskId = task.taskId')
                    .andWhere('dep.status NOT IN (:...terminal)', {
                        terminal: TERMINAL_TASK_STATUSES,
                    })
                    .getQuery();
                return `NOT EXISTS ${sub}`;
            })
            .orderBy('task.stepNumber', 'ASC')
            .addOrderBy('workflow.workflowId', 'ASC')
            .getOne();
    }

    async requeueInterruptedTasks(): Promise<void> {
        await this.tasks.update({ status: TaskStatus.InProgress }, { status: TaskStatus.Queued, progress: null });
    }

    async findUnfinishedWorkflowIds(): Promise<string[]> {
        const rows = await this.workflows.find({
            where: { status: Not(In([WorkflowStatus.Completed, WorkflowStatus.Failed])) },
            select: { workflowId: true },
        });
        return rows.map(w => w.workflowId);
    }

    /**
     * Light COUNT used to gate workflow completion: Avoids heavy queries after each task.
     */
    async hasUnfinishedTasks(workflowId: string): Promise<boolean> {
        const remaining = await this.tasks.count({
            where: {
                workflow: { workflowId },
                status: Not(In(TERMINAL_TASK_STATUSES as TaskStatus[])),
            },
        });
        return remaining > 0;
    }

    /**
     * Light conditional promotion to in_progress.
     */
    async markInProgressIfInitial(workflowId: string): Promise<void> {
        await this.workflows.update({ workflowId, status: WorkflowStatus.Initial }, { status: WorkflowStatus.InProgress });
    }

    /**
     * Gets the outputs of the given tasks.
     */
    async getOutputsFor(tasks: Task[]): Promise<Record<string, DependencyOutput>> {
        const resultIds = tasks.map(t => t.resultId).filter((id): id is string => id != null);
        const results = resultIds.length ? await this.results.find({ where: { resultId: In(resultIds) } }) : [];
        const resultById = new Map(results.map(r => [r.resultId, r]));

        const outputs: Record<string, DependencyOutput> = {};
        for (const t of tasks) {
            const r = t.resultId ? resultById.get(t.resultId) : undefined;
            outputs[t.taskId] = {
                taskId: t.taskId,
                type: t.taskType,
                status: t.status,
                stepNumber: t.stepNumber,
                output: parseResultData(r?.data),
                // Surface the failure reason (carried in progress) for failed tasks.
                error: t.status === TaskStatus.Failed && t.progress ? t.progress : undefined,
            };
        }
        return outputs;
    }

    async save(task: Task): Promise<Task> {
        return this.tasks.save(task);
    }

    async saveResultForTask(task: Task, result: Result): Promise<void> {
        const saved = await this.results.save(result);
        task.resultId = saved.resultId;
        await this.tasks.save(task);
    }

    async loadWorkflowWithTasks(workflowId: string): Promise<Workflow | null> {
        return this.workflows.findOne({ where: { workflowId }, relations: ['tasks'] });
    }

    async saveWorkflow(workflow: Workflow): Promise<Workflow> {
        return this.workflows.save(workflow);
    }
}
