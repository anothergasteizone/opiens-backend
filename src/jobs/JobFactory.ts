import { Job } from './Job';
import { DataAnalysisJob } from './DataAnalysisJob';
import { EmailNotificationJob } from './EmailNotificationJob';
import { PolygonAreaJob } from './PolygonAreaJob';
import { ReportGenerationJob } from './ReportGenerationJob';
import { WorldDataCountrySource } from './CountrySource';

const countrySource = new WorldDataCountrySource();

const jobMap: Record<string, () => Job> = {
    analysis: () => new DataAnalysisJob(countrySource),
    notification: () => new EmailNotificationJob(),
    polygonArea: () => new PolygonAreaJob(),
    reportGeneration: () => new ReportGenerationJob(),
};

export function getJobForTaskType(taskType: string): Job {
    const jobFactory = jobMap[taskType];
    if (!jobFactory) {
        throw new Error(`No job found for task type: ${taskType}`);
    }
    return jobFactory();
}

/**
 * Whether a task type's job implicitly depends on every preceding step (i.e. it aggregates their
 * outputs). Used by the WorkflowFactory to wire those edges without hardcoding any task-type name.
 * Unknown task types return false here; they are still rejected at run time by getJobForTaskType.
 */
export function jobDependsOnPrecedingTasks(taskType: string): boolean {
    const jobFactory = jobMap[taskType];
    return jobFactory ? (jobFactory().dependsOnPrecedingTasks ?? false) : false;
}
