// Coarse benchmark fixture for flawless/no-trivial-functions.
// Every function only reads a parameter's property or forwards its parameters.
// scaling.ts repeats this file, merging same-named bindings: the unreferenced
// functions report at every size, while the called ones walk the counting path
// (and stop reporting once the merged calls reach the default minimum of five).
function getName0(user: { name: string }) {
	return user.name;
}
const parse0 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName1(user: { name: string }) {
	return user.name;
}
const parse1 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName2(user: { name: string }) {
	return user.name;
}
const parse2 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName3(user: { name: string }) {
	return user.name;
}
const parse3 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName4(user: { name: string }) {
	return user.name;
}
const parse4 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName5(user: { name: string }) {
	return user.name;
}
const parse5 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName6(user: { name: string }) {
	return user.name;
}
const parse6 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName7(user: { name: string }) {
	return user.name;
}
const parse7 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName8(user: { name: string }) {
	return user.name;
}
const parse8 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName9(user: { name: string }) {
	return user.name;
}
const parse9 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName10(user: { name: string }) {
	return user.name;
}
const parse10 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName11(user: { name: string }) {
	return user.name;
}
const parse11 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName12(user: { name: string }) {
	return user.name;
}
const parse12 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName13(user: { name: string }) {
	return user.name;
}
const parse13 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName14(user: { name: string }) {
	return user.name;
}
const parse14 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName15(user: { name: string }) {
	return user.name;
}
const parse15 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName16(user: { name: string }) {
	return user.name;
}
const parse16 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName17(user: { name: string }) {
	return user.name;
}
const parse17 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName18(user: { name: string }) {
	return user.name;
}
const parse18 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
function getName19(user: { name: string }) {
	return user.name;
}
const parse19 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
const read0 = (list: Array<number>) => list[0];
read0([1]);
const read1 = (list: Array<number>) => list[0];
read1([1]);
const read2 = (list: Array<number>) => list[0];
read2([1]);
const read3 = (list: Array<number>) => list[0];
read3([1]);
const read4 = (list: Array<number>) => list[0];
read4([1]);
const read5 = (list: Array<number>) => list[0];
read5([1]);
const read6 = (list: Array<number>) => list[0];
read6([1]);
const read7 = (list: Array<number>) => list[0];
read7([1]);
const read8 = (list: Array<number>) => list[0];
read8([1]);
const read9 = (list: Array<number>) => list[0];
read9([1]);

declare function parseValue(value: string, ...rest: Array<string>): number;
