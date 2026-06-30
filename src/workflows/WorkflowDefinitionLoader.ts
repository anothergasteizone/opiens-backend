import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { WorkflowDefinition } from './WorkflowDefinition';

export interface IWorkflowDefinitionLoader {
    load(source: string): WorkflowDefinition;
}

export class YamlWorkflowDefinitionLoader implements IWorkflowDefinitionLoader {
    load(filePath: string): WorkflowDefinition {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return yaml.load(fileContent) as WorkflowDefinition;
    }
}
