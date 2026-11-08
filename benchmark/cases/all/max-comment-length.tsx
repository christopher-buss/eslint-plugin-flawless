// Coarse benchmark fixture for flawless/max-comment-length.
// This leading group is the file header, so it is exempt.
export const base = 1;

// Short note.
export const a = base + 1;

// This line comment group runs well past the word limit that config.ts sets
// for this fixture, so the rule reports it once as a single joined group of
// adjacent line comments that sit on consecutive lines.
export const b = a + 1;

/* A block comment that also holds far more words than the configured maximum allows here. */
export const c = b + 1;

/**
 * JSDoc is exempt by default, even when it holds many more words than the
 * configured maximum allows for an ordinary comment.
 */
export function format(label: string): string {
	// Trailing explanation that keeps going and going with words past the limit.
	return `${label}!`;
}

export const view = <p>{/* JSX comment that is long enough to report here as well, yes. */}</p>;
