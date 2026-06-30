import { TaskRunner } from '../../src/workers/taskRunner';
import { ITaskRepository } from '../../src/repositories/TaskRepository';
import { WorkflowCompletionService } from '../../src/services/WorkflowCompletionService';
import { Task } from '../../src/models/Task';
import { Result } from '../../src/models/Result';
import { Workflow } from '../../src/models/Workflow';
import { TaskStatus } from '../../src/workers/taskStatus';
import { Job, DependencyOutput } from '../../src/jobs/Job';
import { getJobForTaskType } from '../../src/jobs/JobFactory';

// The runner picks the job via the factory; mock it so each test controls the job.
jest.mock('../../src/jobs/JobFactory');
const mockedGetJob = getJobForTaskType as jest.MockedFunction<typeof getJobForTaskType>;

class FakeTaskRepository implements ITaskRepository {
    getOutputsFor = jest.fn(async () => ({}) as Record<string, DependencyOutput>);
    hasUnfinishedTasks = jest.fn(async () => false);
    markInProgressIfInitial = jest.fn(async () => {});
    requeueInterruptedTasks = jest.fn(async () => {});
    findUnfinishedWorkflowIds = jest.fn(async () => [] as string[]);
    async findNextRunnable(): Promise<Task | null> {
        return null;
    }
    async save(task: Task): Promise<Task> {
        return task;
    }
    async saveResultForTask(task: Task, result: Result): Promise<void> {
        result.resultId = 'result-1';
        task.resultId = result.resultId;
    }
    async loadWorkflowWithTasks(): Promise<Workflow | null> {
        return null;
    }
    async saveWorkflow(workflow: Workflow): Promise<Workflow> {
        return workflow;
    }
}

function makeTask(overrides: Partial<Task> = {}): Task {
    const task = new Task();
    task.taskId = 'task-1';
    task.taskType = 'polygonArea';
    task.stepNumber = 1;
    task.dependencies = [];
    task.workflow = Object.assign(new Workflow(), { workflowId: 'wf-1' });
    return Object.assign(task, overrides);
}

function completionStub(): WorkflowCompletionService {
    return { updateStatus: jest.fn().mockResolvedValue(undefined) } as unknown as WorkflowCompletionService;
}

describe('TaskRunner.run', () => {
    let repo: FakeTaskRepository;
    let completion: WorkflowCompletionService;

    beforeEach(() => {
        repo = new FakeTaskRepository();
        completion = completionStub();
        mockedGetJob.mockReset();
    });

    it('runs the job, stores the result and marks the task completed', async () => {
        const job: Job = { run: jest.fn().mockResolvedValue({ ok: true }) };
        mockedGetJob.mockReturnValue(job);
        const task = makeTask();

        await new TaskRunner(repo, completion).run(task);

        expect(job.run).toHaveBeenCalledTimes(1);
        expect(task.status).toBe(TaskStatus.Completed);
        expect(task.resultId).toBe('result-1');
        expect(completion.updateStatus).toHaveBeenCalledWith('wf-1');
    });

    // The task is claimed (in_progress) before the job runs, so it leaves the queued pool
    // while executing.
    it('marks the task in_progress before running the job', async () => {
        let statusWhileRunning: TaskStatus | undefined;
        const task = makeTask();
        const job: Job = {
            run: jest.fn().mockImplementation(async () => {
                statusWhileRunning = task.status;
                return { ok: true };
            }),
        };
        mockedGetJob.mockReturnValue(job);

        await new TaskRunner(repo, completion).run(task);

        expect(statusWhileRunning).toBe(TaskStatus.InProgress);
        expect(task.status).toBe(TaskStatus.Completed);
    });

    // The workflow status re-evaluation must run on EVERY outcome.
    // It lives in a `finally`, so even when the job throws the workflow is re-evaluated
    // (previously it stayed stuck because the call was on the success path only).
    it('marks the task failed, rethrows, and STILL re-evaluates the workflow when the job throws', async () => {
        const job: Job = { run: jest.fn().mockRejectedValue(new Error('boom')) };
        mockedGetJob.mockReturnValue(job);
        const task = makeTask();

        const runner = new TaskRunner(repo, completion);
        await expect(runner.run(task)).rejects.toThrow('boom');

        expect(task.status).toBe(TaskStatus.Failed);
        expect(completion.updateStatus).toHaveBeenCalledWith('wf-1');
    });

    // Regression: the job is resolved INSIDE the try, so an unknown taskType (the factory
    // throws) is caught like any other failure — the task is marked Failed and the workflow is
    // STILL re-evaluated in the finally, instead of being stranded in_progress with the workflow
    // hung non-terminal forever.
    it('marks the task failed and re-evaluates the workflow when the taskType is unknown', async () => {
        mockedGetJob.mockImplementation(() => {
            throw new Error('No job found for task type: bogus');
        });
        const task = makeTask({ taskType: 'bogus' });

        const runner = new TaskRunner(repo, completion);
        await expect(runner.run(task)).rejects.toThrow(/No job found/);

        expect(task.status).toBe(TaskStatus.Failed);
        expect(completion.updateStatus).toHaveBeenCalledWith('wf-1');
    });

    // Task A.3: a task whose dependency failed is itself marked Failed (the job never runs) unless
    // the job tolerates failed dependencies. The progress carries the unsatisfied-dependency reason
    // and the run does not throw — completion is still re-evaluated.
    it('marks the task failed when a dependency failed and the job does not tolerate it', async () => {
        const job: Job = { run: jest.fn() };
        mockedGetJob.mockReturnValue(job);
        const failedDep = Object.assign(new Task(), { taskId: 'dep-1', status: TaskStatus.Failed });
        const task = makeTask({ dependencies: [failedDep] });

        await new TaskRunner(repo, completion).run(task);

        expect(job.run).not.toHaveBeenCalled();
        expect(task.status).toBe(TaskStatus.Failed);
        expect(task.progress).toMatch(/dep-1/);
        expect(completion.updateStatus).toHaveBeenCalledWith('wf-1');
    });

    // Task A.2/A.3: a failure-tolerant job (the report) runs despite a failed dependency and
    // receives the outputs of its declared dependencies (which, for an aggregator, are every
    // preceding step declared in its `dependsOn`).
    it('runs a failure-tolerant job despite a failed dependency and feeds it its dependency outputs', async () => {
        const outputs = { a: { taskId: 'a', type: 'analysis', status: TaskStatus.Completed, stepNumber: 1, output: 'Brazil' } };
        const job: Job = { run: jest.fn().mockResolvedValue({ report: true }), toleratesFailedDependencies: true };
        mockedGetJob.mockReturnValue(job);
        repo.getOutputsFor.mockResolvedValue(outputs);
        const failedDep = Object.assign(new Task(), { taskId: 'dep-1', status: TaskStatus.Failed });
        const task = makeTask({ taskType: 'reportGeneration', stepNumber: 4, dependencies: [failedDep] });

        await new TaskRunner(repo, completion).run(task);

        expect(repo.getOutputsFor).toHaveBeenCalledWith([failedDep]);
        expect(job.run).toHaveBeenCalledWith(task, outputs);
        expect(task.status).toBe(TaskStatus.Completed);
    });
});
