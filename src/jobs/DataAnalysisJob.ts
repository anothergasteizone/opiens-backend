import { Job } from './Job';
import { Task } from '../models/Task';
import booleanWithin from '@turf/boolean-within';
import { Feature, Polygon } from 'geojson';
import { CountrySource } from './CountrySource';

export class DataAnalysisJob implements Job {
    constructor(private readonly countries: CountrySource) {}

    async run(task: Task): Promise<string> {
        console.log(`Running data analysis for task ${task.taskId}...`);

        try {
            const inputGeometry: Feature<Polygon> = JSON.parse(task.geoJson);

            for (const country of this.countries.getCountries()) {
                if (booleanWithin(inputGeometry, country.feature)) {
                    console.log(`The polygon is within ${country.name}`);
                    return country.name;
                }
            }
            return 'No country found';
        } catch (error) {
            throw new Error(`Invalid GeoJSON for task ${task.taskId}`, { cause: error });
        }
    }
}
