import { Feature, MultiPolygon, Polygon } from 'geojson';
import countryMapping from '../data/world_data.json';

export interface CountryFeature {
    name: string;
    feature: Feature<Polygon | MultiPolygon>;
}

export interface CountrySource {
    getCountries(): CountryFeature[];
}

export class WorldDataCountrySource implements CountrySource {
    private cache?: CountryFeature[];

    getCountries(): CountryFeature[] {
        if (!this.cache) {
            this.cache = countryMapping.features
                .filter(f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
                .map(f => ({
                    name: f.properties?.name ?? 'Unknown country',
                    feature: f as Feature<Polygon | MultiPolygon>,
                }));
        }
        return this.cache;
    }
}
