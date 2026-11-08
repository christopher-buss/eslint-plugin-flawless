// Coarse benchmark fixture for flawless/cognitive-complexity.
// With { threshold: 2 } (passed in coarse.ts) the functions with nested
// branches report. The many small arrows keep the cost linear in file size:
// the report location is found only for a function that reports.
export function nested(a: number, b: number): number {
	if (a > 0) {
		for (let index = 0; index < a; index += 1) {
			if (b > index && a > b) {
				return index;
			}
		}
	} else if (b < 0) {
		return b > -10 ? -1 : -2;
	}

	return 0;
}

export function view(items: Array<string>, open: boolean): JSX.Element {
	return <ul>{open && items.length > 0 && items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

export const handler = (event: { kind: string; value?: number }): number => {
	switch (event.kind) {
		case "add": {
			return event.value === undefined ? 0 : event.value;
		}
		case "skip": {
			return (event.value ?? 0) > 0 && event.kind.length > 1 ? 1 : 0;
		}
		default: {
			return -1;
		}
	}
};
export const arrow0 = (value: number): number => value + 0;
export const arrow1 = (value: number): number => value + 1;
export const arrow2 = (value: number): number => value + 2;
export const arrow3 = (value: number): number => value + 3;
export const arrow4 = (value: number): number => value + 4;
export const arrow5 = (value: number): number => value + 5;
export const arrow6 = (value: number): number => value + 6;
export const arrow7 = (value: number): number => value + 7;
export const arrow8 = (value: number): number => value + 8;
export const arrow9 = (value: number): number => value + 9;
export const arrow10 = (value: number): number => value + 10;
export const arrow11 = (value: number): number => value + 11;
export const arrow12 = (value: number): number => value + 12;
export const arrow13 = (value: number): number => value + 13;
export const arrow14 = (value: number): number => value + 14;
export const arrow15 = (value: number): number => value + 15;
export const arrow16 = (value: number): number => value + 16;
export const arrow17 = (value: number): number => value + 17;
export const arrow18 = (value: number): number => value + 18;
export const arrow19 = (value: number): number => value + 19;
export const arrow20 = (value: number): number => value + 20;
export const arrow21 = (value: number): number => value + 21;
export const arrow22 = (value: number): number => value + 22;
export const arrow23 = (value: number): number => value + 23;
export const arrow24 = (value: number): number => value + 24;
export const arrow25 = (value: number): number => value + 25;
export const arrow26 = (value: number): number => value + 26;
export const arrow27 = (value: number): number => value + 27;
export const arrow28 = (value: number): number => value + 28;
export const arrow29 = (value: number): number => value + 29;
export const arrow30 = (value: number): number => value + 30;
export const arrow31 = (value: number): number => value + 31;
export const arrow32 = (value: number): number => value + 32;
export const arrow33 = (value: number): number => value + 33;
export const arrow34 = (value: number): number => value + 34;
export const arrow35 = (value: number): number => value + 35;
export const arrow36 = (value: number): number => value + 36;
export const arrow37 = (value: number): number => value + 37;
export const arrow38 = (value: number): number => value + 38;
export const arrow39 = (value: number): number => value + 39;
