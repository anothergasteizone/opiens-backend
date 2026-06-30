import { PolygonAreaJob } from '../../../src/jobs/PolygonAreaJob';
import { Task } from '../../../src/models/Task';
import { validPolygonJson } from '../../helpers/fixtures';

function taskWithGeoJson(geoJson: string): Task {
    const task = new Task();
    task.taskId = 'task-1';
    task.geoJson = geoJson;
    return task;
}

// Challenge task A.1: compute the polygon area and handle invalid GeoJSON gracefully.
describe('PolygonAreaJob', () => {
    it('returns the area in square meters for a valid polygon', async () => {
        const result = (await new PolygonAreaJob().run(taskWithGeoJson(validPolygonJson))) as { calculatedArea: number; unit: string };

        expect(result.unit).toBe('square_meters');
        expect(result.calculatedArea).toBeGreaterThan(0);
    });

    it('throws on invalid GeoJSON so the runner can mark the task as failed', async () => {
        await expect(new PolygonAreaJob().run(taskWithGeoJson('this is not json'))).rejects.toThrow(/Invalid GeoJSON for task task-1/);
    });
});
