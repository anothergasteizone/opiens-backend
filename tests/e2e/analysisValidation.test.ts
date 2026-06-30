import express from 'express';
import request from 'supertest';
import analysisRoutes from '../../src/routes/analysisRoutes';

// The validation paths under test return BEFORE any database access, so the route can
// be exercised over HTTP without an initialized DataSource.
function buildApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.use('/analysis', analysisRoutes);
    return app;
}

// Error detection on POST /analysis: missing client id and a missing or non-object
// geoJson must return a clear 400, never an opaque 500. Deeper GeoJSON validity is the
// jobs' responsibility (an invalid polygon fails the task), not the route's.
describe('POST /analysis — input validation', () => {
    const app = buildApp();

    it('returns 400 when the X-Client-Id header is missing', async () => {
        const res = await request(app)
            .post('/analysis')
            .send({ geoJson: { type: 'Polygon', coordinates: [] } });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/X-Client-Id/);
    });

    it('returns 400 when geoJson is missing', async () => {
        const res = await request(app).post('/analysis').set('X-Client-Id', 'client-1').send({});

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/geoJson/);
    });

    it('returns 400 when geoJson is not an object', async () => {
        const res = await request(app).post('/analysis').set('X-Client-Id', 'client-1').send({ geoJson: 'a-raw-string' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/geoJson/);
    });
});
