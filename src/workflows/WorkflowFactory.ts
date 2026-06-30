import { DataSource } from 'typeorm';
import { Workflow } from '../models/Workflow';
import { Task } from '../models/Task';
import { TaskStatus } from '../workers/taskStatus';
import { WorkflowStatus } from './WorkflowStatus';
import { assertValidDag, resolveStepDependencies, validateWorkflowDefinition } from './WorkflowDefinition';
import { jobDependsOnPrecedingTasks } from '../jobs/JobFactory';
import type { IWorkflowDefinitionLoader } from './WorkflowDefinitionLoader';

export class WorkflowFactory {
    constructor(
        private readonly dataSource: DataSource,
        private readonly loader: IWorkflowDefinitionLoader
    ) {}

    async createWorkflow(source: string, clientId: string, geoJson: string): Promise<Workflow> {
        const workflowDef = this.loader.load(source);
        validateWorkflowDefinition(workflowDef);
        assertValidDag(workflowDef.steps);
        const steps = resolveStepDependencies(workflowDef.steps, jobDependsOnPrecedingTasks);

        const workflowRepository = this.dataSource.getRepository(Workflow);
        const taskRepository = this.dataSource.getRepository(Task);

        let workflow = new Workflow();
        workflow.clientId = clientId;
        workflow.status = WorkflowStatus.Initial;
        workflow = await workflowRepository.save(workflow);

        const tasks: Task[] = steps.map(step => {
            const task = new Task();
            task.clientId = clientId;
            task.geoJson = geoJson;
            task.status = TaskStatus.Queued;
            task.taskType = step.taskType;
            task.stepNumber = step.stepNumber;
            task.workflow = workflow;
            return task;
        });

        const taskByStep = new Map<number, Task>(tasks.map(t => [t.stepNumber, t]));
        steps.forEach((step, i) => {
            if (step.dependsOn?.length) {
                tasks[i].dependencies = step.dependsOn.map(n => taskByStep.get(n)).filter((d): d is Task => d != null);
            }
        });
        await taskRepository.save(tasks);

        return workflow;
    }
}
