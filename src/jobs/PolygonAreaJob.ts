import type { Job } from './Job';
import { Task } from '../models/Task';
import area from '@turf/area';

export class PolygonAreaJob implements Job {
    async run(task: Task): Promise<{ calculatedArea: number; unit: string }> {
        console.log(`Running polygon area calculation for task ${task.taskId}...`);
        try {
            const geometry = JSON.parse(task.geoJson);
            const calculatedArea = area(geometry);
            console.log(`Area: ${calculatedArea} square meters`);
            return { calculatedArea, unit: 'square_meters' };
        } catch (error) {
            throw new Error(`Invalid GeoJSON for task ${task.taskId}`, { cause: error });
        }
    }
}
