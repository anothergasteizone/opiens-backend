import { AppDataSource } from '../data-source';
import { TaskRunner } from './taskRunner';
import { TaskRepository } from '../repositories/TaskRepository';
import { WorkflowCompletionService } from '../services/WorkflowCompletionService';
import type { Task } from '../models/Task';

export async function taskWorker() {
    const taskRepository = new TaskRepository(AppDataSource);
    const workflowCompletion = new WorkflowCompletionService(taskRepository);
    const taskRunner = new TaskRunner(taskRepository, workflowCompletion);

    // Startup recovery.
    // Requeue tasks.
    await taskRepository.requeueInterruptedTasks();
    // Reconcile workflows.
    for (const workflowId of await taskRepository.findUnfinishedWorkflowIds()) {
        await workflowCompletion.updateStatus(workflowId);
    }

    while (true) {
        let task: Task | null = null;
        try {
            task = await taskRepository.findNextRunnable();

            if (task) {
                try {
                    await taskRunner.run(task);
                } catch (error) {
                    console.error('Task execution failed. Task status has already been updated by TaskRunner.');
                    console.error(error);
                }
            }
        } catch (error) {
            console.error('Task worker poll failed; retrying after the next interval.');
            console.error(error);
        }

        if (!task) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}
