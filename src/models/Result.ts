import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'results' })
export class Result {
    @PrimaryGeneratedColumn('uuid')
    resultId!: string;

    @Column()
    taskId!: string;

    @Column({ type: 'text', nullable: true })
    data!: string | null;
}
