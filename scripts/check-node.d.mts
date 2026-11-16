// types for scripts/check-node.mjs (imported by bin/agentclinic.mjs and tests/provider-optin.test.ts)
export declare const MIN_NODE: [number, number];
export declare function nodeVersionProblem(version?: string): string | null;
export declare function checkNode(): void;
