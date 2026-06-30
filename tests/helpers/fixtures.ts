import { DataSource } from 'typeorm';
import { Task } from '../../src/models/Task';
import { Workflow } from '../../src/models/Workflow';
import { Result } from '../../src/models/Result';
import { WorkflowDefinition } from '../../src/workflows/WorkflowDefinition';
import { IWorkflowDefinitionLoader } from '../../src/workflows/WorkflowDefinitionLoader';

/** A small but valid GeoJSON Polygon (a patch in Rondônia, Brazil), as a JSON string. */
export const validPolygonJson = JSON.stringify({
    type: 'Polygon',
    coordinates: [
        [
            [-63.624885, -10.31105],
            [-63.624885, -10.367865],
            [-63.612783, -10.367865],
            [-63.612783, -10.31105],
            [-63.624885, -10.31105],
        ],
    ],
});

/**
 * Fresh, isolated in-memory SQLite DataSource with the project entities. Lets the
 * integration tests exercise the real repositories/factory without touching disk.
 */
export async function createTestDataSource(): Promise<DataSource> {
    const dataSource = new DataSource({
        type: 'sqlite',
        database: ':memory:',
        dropSchema: true,
        synchronize: true,
        logging: false,
        entities: [Task, Workflow, Result],
    });
    await dataSource.initialize();
    return dataSource;
}

/** In-memory workflow definition loader, so the factory needs no YAML file on disk. */
export class InMemoryDefinitionLoader implements IWorkflowDefinitionLoader {
    constructor(private readonly definition: WorkflowDefinition) {}
    load(): WorkflowDefinition {
        return this.definition;
    }
}
