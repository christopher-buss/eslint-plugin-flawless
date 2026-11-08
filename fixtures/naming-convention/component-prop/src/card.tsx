import * as React from "react";

import type { CardProps } from "./shared-props";

export function Card({ title }: CardProps): React.JSX.Element {
	return <div className={title} />;
}
