export declare function read(): string;
export declare function run(use: (value: string) => string): void;

export interface TreeNode<T> {
	readonly left?: TreeNode<T>;
	readonly value: T;
}
