// Fetch the user — then cache it. Plain sentence. Another — dash here!
export const greeting = "Hello — world";
export const title = `Report — ${greeting}`;

/**
 * Formats a label.
 * Short form — long form — either works.
 */
export function format(label: string): string {
	return `${label} — done`;
}

export const view = <p>Wait — what?</p>;
