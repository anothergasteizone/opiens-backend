import { Router } from 'express';
import { AppDataSource } from '../data-source';
import { WorkflowFactory } from '../workflows/WorkflowFactory'; // Create a folder for factories if you prefer
import { YamlWorkflowDefinitionLoader } from '../workflows/WorkflowDefinitionLoader';
import { requireClientId } from './middleware/requireClientId';
import path from 'path';

const router = Router();
const workflowFactory = new WorkflowFactory(AppDataSource, new YamlWorkflowDefinitionLoader());

router.use(requireClientId);

router.post('/', async (req, res) => {
    const { geoJson } = req.body;
    const clientId: string = res.locals.clientId;

    if (!geoJson || typeof geoJson !== 'object') {
        return res.status(400).json({ message: 'geoJson is required and must be a GeoJSON object' });
    }

    const workflowFile = path.join(__dirname, '../workflows/example_workflow.yml');

    try {
        const workflow = await workflowFactory.createWorkflow(workflowFile, clientId, JSON.stringify(geoJson));

        res.status(202).json({
            workflowId: workflow.workflowId,
            message: 'Workflow created and tasks queued from YAML definition.',
        });
    } catch (error: unknown) {
        console.error('Error creating workflow:', error);
        res.status(500).json({ message: 'Failed to create workflow' });
    }
});

export default router;
