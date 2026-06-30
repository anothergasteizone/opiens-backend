import { DataSource, Repository } from 'typeorm';
import { Workflow } from '../models/Workflow';

export interface IWorkflowRepository {
    findById(workflowId: string): Promise<Workflow | null>;
    findWithTasks(workflowId: string): Promise<Workflow | null>;
}

export class WorkflowRepository implements IWorkflowRepository {
    private readonly workflows: Repository<Workflow>;

    constructor(dataSource: DataSource) {
        this.workflows = dataSource.getRepository(Workflow);
    }

    async findById(workflowId: string): Promise<Workflow | null> {
        return this.workflows.findOne({ where: { workflowId } });
    }

    async findWithTasks(workflowId: string): Promise<Workflow | null> {
        return this.workflows.findOne({ where: { workflowId }, relations: ['tasks'] });
    }
}
