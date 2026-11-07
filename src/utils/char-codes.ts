/**
 * Whether a code unit ends a line, matching ESLint's line-break set (`\n`,
 * `\r`, U+2028, U+2029).
 *
 * @param code - A UTF-16 code unit.
 * @returns True when the code unit is a line break.
 */
export function isLineBreak(code: number): boolean {
	return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
}

/**
 * Whether a code unit is whitespace, matching the `\s` class without running a
 * regex per character.
 *
 * @param code - A UTF-16 code unit.
 * @returns True when the code unit is whitespace.
 */
export function isWhitespace(code: number): boolean {
	if (code <= 0x20) {
		return code === 0x20 || (code >= 0x09 && code <= 0x0d);
	}

	if (code < 0xa0) {
		return false;
	}

	return (
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}
