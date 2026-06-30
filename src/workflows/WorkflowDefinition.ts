export interface WorkflowStep {
    taskType: string;
    stepNumber: number;
    dependsOn?: number[];
}

export interface WorkflowDefinition {
    name: string;
    steps: WorkflowStep[];
}

export function validateWorkflowDefinition(def: WorkflowDefinition): void {
    if (!def || typeof def !== 'object' || !Array.isArray(def.steps)) {
        throw new Error('Workflow definition must have a "steps" array');
    }
    if (def.steps.length === 0) {
        throw new Error('Workflow definition must contain at least one step');
    }
    for (const step of def.steps) {
        if (typeof step.taskType !== 'string' || step.taskType.trim() === '') {
            throw new Error(`Each step must have a non-empty string "taskType" (got ${JSON.stringify(step.taskType)})`);
        }
        if (!Number.isInteger(step.stepNumber) || step.stepNumber < 1) {
            throw new Error(`Step "${step.taskType}" must have an integer "stepNumber" >= 1 (got ${JSON.stringify(step.stepNumber)})`);
        }
        if (step.dependsOn !== undefined && (!Array.isArray(step.dependsOn) || step.dependsOn.some(n => !Number.isInteger(n)))) {
            throw new Error(`Step ${step.stepNumber} "dependsOn" must be an array of integer step numbers`);
        }
    }
}

export function resolveStepDependencies(steps: WorkflowStep[], dependsOnPreceding: (taskType: string) => boolean): WorkflowStep[] {
    return steps.map(step => {
        const explicit = step.dependsOn ?? [];
        const implicit = dependsOnPreceding(step.taskType) ? steps.filter(s => s.stepNumber < step.stepNumber).map(s => s.stepNumber) : [];
        return { ...step, dependsOn: [...new Set([...explicit, ...implicit])] };
    });
}

/**
 * Validates that the steps have: unique step numbers,
 * dependencies that point to existing steps, and no cycles between dependencies.
 */
export function assertValidDag(steps: WorkflowStep[]): void {
    const seen = new Set<number>();
    for (const s of steps) {
        if (seen.has(s.stepNumber)) throw new Error(`Duplicate stepNumber ${s.stepNumber}`);
        seen.add(s.stepNumber);
    }

    const adj = new Map<number, number[]>(steps.map(s => [s.stepNumber, s.dependsOn ?? []]));
    const state = new Map<number, 0 | 1 | 2>(); // 0=unvisited, 1=in progress, 2=done

    const visit = (n: number): void => {
        if (state.get(n) === 1) throw new Error(`Cyclic dependency detected at step ${n}`);
        if (state.get(n) === 2) return;
        state.set(n, 1);
        for (const m of adj.get(n) ?? []) {
            if (!adj.has(m)) throw new Error(`Step ${n} depends on unknown step ${m}`);
            visit(m);
        }
        state.set(n, 2);
    };

    for (const s of steps) visit(s.stepNumber);
}
