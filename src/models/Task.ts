import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany, JoinTable } from 'typeorm';
import { Workflow } from './Workflow';
import { TaskStatus } from '../workers/taskStatus';

@Entity({ name: 'tasks' })
export class Task {
    @PrimaryGeneratedColumn('uuid')
    taskId!: string;

    @Column()
    clientId!: string;

    @Column('text')
    geoJson!: string;

    @Column()
    status!: TaskStatus;

    @Column({ nullable: true, type: 'text' })
    progress?: string | null;

    @Column({ nullable: true })
    resultId?: string;

    @Column()
    taskType!: string;

    @Column({ default: 1 })
    stepNumber!: number;

    @ManyToOne(() => Workflow, workflow => workflow.tasks)
    workflow!: Workflow;

    @ManyToMany(() => Task, { cascade: ['insert'] })
    @JoinTable({
        name: 'task_dependencies',
        joinColumn: { name: 'taskId', referencedColumnName: 'taskId' },
        inverseJoinColumn: { name: 'dependsOnTaskId', referencedColumnName: 'taskId' },
    })
    dependencies!: Task[];
}
