// Props declared apart from the component that uses them: `src/card.tsx` takes
// `CardProps` as its props, and `CardProps` inherits `BaseProps`. Test cases
// lint this file with the same declarations supplied inline.
export interface BaseProps {
	readonly visible?: boolean;
}

export interface CardProps extends BaseProps {
	readonly title: string;
}

export interface CardHookResult {
	readonly InputBegan?: () => void;
}
