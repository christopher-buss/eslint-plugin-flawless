// Coarse benchmark fixture for flawless/no-trivial-functions.
// Every function only reads a parameter's property or forwards its parameters,
// and each is referenced fewer times than the default minimum of five.
function getName0(user: { name: string }) {
	return user.name;
}
const parse0 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName0({ name: "a" });
parse0("b");
function getName1(user: { name: string }) {
	return user.name;
}
const parse1 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName1({ name: "a" });
parse1("b");
function getName2(user: { name: string }) {
	return user.name;
}
const parse2 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName2({ name: "a" });
parse2("b");
function getName3(user: { name: string }) {
	return user.name;
}
const parse3 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName3({ name: "a" });
parse3("b");
function getName4(user: { name: string }) {
	return user.name;
}
const parse4 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName4({ name: "a" });
parse4("b");
function getName5(user: { name: string }) {
	return user.name;
}
const parse5 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName5({ name: "a" });
parse5("b");
function getName6(user: { name: string }) {
	return user.name;
}
const parse6 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName6({ name: "a" });
parse6("b");
function getName7(user: { name: string }) {
	return user.name;
}
const parse7 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName7({ name: "a" });
parse7("b");
function getName8(user: { name: string }) {
	return user.name;
}
const parse8 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName8({ name: "a" });
parse8("b");
function getName9(user: { name: string }) {
	return user.name;
}
const parse9 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName9({ name: "a" });
parse9("b");
function getName10(user: { name: string }) {
	return user.name;
}
const parse10 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName10({ name: "a" });
parse10("b");
function getName11(user: { name: string }) {
	return user.name;
}
const parse11 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName11({ name: "a" });
parse11("b");
function getName12(user: { name: string }) {
	return user.name;
}
const parse12 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName12({ name: "a" });
parse12("b");
function getName13(user: { name: string }) {
	return user.name;
}
const parse13 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName13({ name: "a" });
parse13("b");
function getName14(user: { name: string }) {
	return user.name;
}
const parse14 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName14({ name: "a" });
parse14("b");
function getName15(user: { name: string }) {
	return user.name;
}
const parse15 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName15({ name: "a" });
parse15("b");
function getName16(user: { name: string }) {
	return user.name;
}
const parse16 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName16({ name: "a" });
parse16("b");
function getName17(user: { name: string }) {
	return user.name;
}
const parse17 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName17({ name: "a" });
parse17("b");
function getName18(user: { name: string }) {
	return user.name;
}
const parse18 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName18({ name: "a" });
parse18("b");
function getName19(user: { name: string }) {
	return user.name;
}
const parse19 = (value: string, ...rest: Array<string>) => parseValue(value, ...rest);
getName19({ name: "a" });
parse19("b");

declare function parseValue(value: string, ...rest: Array<string>): number;
