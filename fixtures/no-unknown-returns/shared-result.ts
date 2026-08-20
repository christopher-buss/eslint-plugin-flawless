// Cross-file aliases for the `no-unknown-returns` spec. A syntactic rule can
// only see aliases declared in the file being linted, so moving them here would
// silence it; the type-aware rule must still report.
export type Result = unknown;

export type AsyncResult = Promise<unknown>;

export type Parsed = string;
