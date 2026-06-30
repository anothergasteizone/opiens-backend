import { DataSource } from 'typeorm';
import { Task } from './models/Task';
import { Result } from './models/Result';
import { Workflow } from './models/Workflow';

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: 'data/database.sqlite',
    entities: [Task, Result, Workflow],
    // Persistence may require migrations in the future.
    synchronize: true,
    logging: false,
});
