import 'reflect-metadata';

// Jobs and the runner log progress to stdout/stderr on every step. Silence it so the
// test output stays readable; tests assert on behaviour, not on log lines. Runs in
// `setupFiles` (before the framework), so it is done at module top level rather than
// in a beforeAll hook.
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
