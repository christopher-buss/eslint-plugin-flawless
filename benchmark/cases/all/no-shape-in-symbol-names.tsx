interface UserShape {
	id: string;
}

export function draw(shape: UserShape): string {
	return shape.id;
}
