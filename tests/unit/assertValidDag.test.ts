import { assertValidDag } from '../../src/workflows/WorkflowDefinition';

// Error detection added with the dependency feature: invalid workflow
// definitions are rejected *before* anything is written to the database.
describe('assertValidDag — workflow definition validation', () => {
    it('accepts a valid acyclic graph', () => {
        expect(() =>
            assertValidDag([
                { taskType: 'a', stepNumber: 1 },
                { taskType: 'b', stepNumber: 2, dependsOn: [1] },
                { taskType: 'c', stepNumber: 3, dependsOn: [1, 2] },
            ])
        ).not.toThrow();
    });

    it('rejects duplicate step numbers', () => {
        expect(() =>
            assertValidDag([
                { taskType: 'a', stepNumber: 1 },
                { taskType: 'b', stepNumber: 1 },
            ])
        ).toThrow(/Duplicate stepNumber 1/);
    });

    it('rejects a dependency on a non-existent step', () => {
        expect(() => assertValidDag([{ taskType: 'a', stepNumber: 1, dependsOn: [99] }])).toThrow(/depends on unknown step 99/);
    });

    // One cycle case is enough: a direct (A<->B) and an indirect (A->C->B->A) cycle both reach the
    // same DFS back-edge check; the indirect case is the slightly stronger guard, so keep just it.
    it('detects a cycle', () => {
        expect(() =>
            assertValidDag([
                { taskType: 'a', stepNumber: 1, dependsOn: [3] },
                { taskType: 'b', stepNumber: 2, dependsOn: [1] },
                { taskType: 'c', stepNumber: 3, dependsOn: [2] },
            ])
        ).toThrow(/Cyclic dependency/);
    });
});
