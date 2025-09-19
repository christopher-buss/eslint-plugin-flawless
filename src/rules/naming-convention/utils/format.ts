import { PredefinedFormat, type PredefinedFormatType } from "./enums";

//
// These format functions are taken from
// `tslint-consistent-codestyle/naming-convention`: https://github.com/ajafff/tslint-consistent-codestyle/blob/ab156cc8881bcc401236d999f4ce034b59039e81/rules/namingConventionRule.ts#L603-L645
//
// The license for the code can be viewed here:
// https://github.com/ajafff/tslint-consistent-codestyle/blob/ab156cc8881bcc401236d999f4ce034b59039e81/LICENSE
//

//
// Why not regex here? Because it's actually really, really difficult to create a
// regex to handle all of the unicode cases, and we have many non-english users
// that use non-english characters. https://gist.github.com/mathiasbynens/6334847
//

function hasStrictCamelHumps(name: string, isUpper: boolean): boolean {
	if (name.startsWith("_")) {
		return false;
	}

	for (let index = 1; index < name.length; ++index) {
		// eslint-disable-next-line ts/no-non-null-assertion -- Controlled loop
		const char = name[index]!;
		if (char === "_") {
			return false;
		}

		if (isUpper === isUppercaseChar(char)) {
			if (isUpper) {
				return false;
			}
		} else {
			isUpper = !isUpper;
		}
	}

	return true;
}

function isCamelCase(name: string): boolean {
	return name.length === 0 || (name[0] === name[0]?.toLowerCase() && !name.includes("_"));
}

function isPascalCase(name: string): boolean {
	return name.length === 0 || (name[0] === name[0]?.toUpperCase() && !name.includes("_"));
}

function isSnakeCase(name: string): boolean {
	return name.length === 0 || (name === name.toLowerCase() && validateUnderscores(name));
}

function isStrictCamelCase(name: string): boolean {
	return (
		name.length === 0 ||
		(name[0] === name[0]?.toLowerCase() && hasStrictCamelHumps(name, false))
	);
}

function isStrictPascalCase(name: string): boolean {
	return (
		name.length === 0 || (name[0] === name[0]?.toUpperCase() && hasStrictCamelHumps(name, true))
	);
}

function isUpperCase(name: string): boolean {
	return name.length === 0 || (name === name.toUpperCase() && validateUnderscores(name));
}

function isUppercaseChar(char: string): boolean {
	return char === char.toUpperCase() && char !== char.toLowerCase();
}

/**
 * Check for leading trailing and adjacent underscores.
 * @param name - The name to check.
 * @returns True if the underscores are valid.
 */
function validateUnderscores(name: string): boolean {
	if (name.startsWith("_")) {
		return false;
	}

	let wasUnderscore = false;
	for (let index = 1; index < name.length; ++index) {
		if (name[index] === "_") {
			if (wasUnderscore) {
				return false;
			}

			wasUnderscore = true;
		} else {
			wasUnderscore = false;
		}
	}

	return !wasUnderscore;
}

export const FormatCheckersMap: Readonly<Record<PredefinedFormatType, (name: string) => boolean>> =
	{
		[PredefinedFormat.camelCase]: isCamelCase,
		[PredefinedFormat.PascalCase]: isPascalCase,
		[PredefinedFormat.snake_case]: isSnakeCase,
		[PredefinedFormat.strictCamelCase]: isStrictCamelCase,
		[PredefinedFormat.StrictPascalCase]: isStrictPascalCase,
		[PredefinedFormat.UPPER_CASE]: isUpperCase,
	};
