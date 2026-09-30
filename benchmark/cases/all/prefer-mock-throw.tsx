// Coarse benchmark fixture for flawless/prefer-mock-throw.
// Every implementation only throws a stable value, so the rule reports and
// fixes each one; the `let` binding exercises the scope checks without a report.
const message = "boom";
let mutable = new Error("mutable");
const error0 = new Error(`${message} 0`);
it("t0", () => {
	mock0.mockImplementation(() => { throw error0; });
	mock0.mockImplementationOnce(() => { throw new TypeError(message, { cause: error0 }); });
	mock0.mockImplementation(() => { throw mutable; });
});
const error1 = new Error(`${message} 1`);
it("t1", () => {
	mock1.mockImplementation(() => { throw error1; });
	mock1.mockImplementationOnce(() => { throw new TypeError(message, { cause: error1 }); });
	mock1.mockImplementation(() => { throw mutable; });
});
const error2 = new Error(`${message} 2`);
it("t2", () => {
	mock2.mockImplementation(() => { throw error2; });
	mock2.mockImplementationOnce(() => { throw new TypeError(message, { cause: error2 }); });
	mock2.mockImplementation(() => { throw mutable; });
});
const error3 = new Error(`${message} 3`);
it("t3", () => {
	mock3.mockImplementation(() => { throw error3; });
	mock3.mockImplementationOnce(() => { throw new TypeError(message, { cause: error3 }); });
	mock3.mockImplementation(() => { throw mutable; });
});
const error4 = new Error(`${message} 4`);
it("t4", () => {
	mock4.mockImplementation(() => { throw error4; });
	mock4.mockImplementationOnce(() => { throw new TypeError(message, { cause: error4 }); });
	mock4.mockImplementation(() => { throw mutable; });
});
const error5 = new Error(`${message} 5`);
it("t5", () => {
	mock5.mockImplementation(() => { throw error5; });
	mock5.mockImplementationOnce(() => { throw new TypeError(message, { cause: error5 }); });
	mock5.mockImplementation(() => { throw mutable; });
});
const error6 = new Error(`${message} 6`);
it("t6", () => {
	mock6.mockImplementation(() => { throw error6; });
	mock6.mockImplementationOnce(() => { throw new TypeError(message, { cause: error6 }); });
	mock6.mockImplementation(() => { throw mutable; });
});
const error7 = new Error(`${message} 7`);
it("t7", () => {
	mock7.mockImplementation(() => { throw error7; });
	mock7.mockImplementationOnce(() => { throw new TypeError(message, { cause: error7 }); });
	mock7.mockImplementation(() => { throw mutable; });
});
const error8 = new Error(`${message} 8`);
it("t8", () => {
	mock8.mockImplementation(() => { throw error8; });
	mock8.mockImplementationOnce(() => { throw new TypeError(message, { cause: error8 }); });
	mock8.mockImplementation(() => { throw mutable; });
});
const error9 = new Error(`${message} 9`);
it("t9", () => {
	mock9.mockImplementation(() => { throw error9; });
	mock9.mockImplementationOnce(() => { throw new TypeError(message, { cause: error9 }); });
	mock9.mockImplementation(() => { throw mutable; });
});
const error10 = new Error(`${message} 10`);
it("t10", () => {
	mock10.mockImplementation(() => { throw error10; });
	mock10.mockImplementationOnce(() => { throw new TypeError(message, { cause: error10 }); });
	mock10.mockImplementation(() => { throw mutable; });
});
const error11 = new Error(`${message} 11`);
it("t11", () => {
	mock11.mockImplementation(() => { throw error11; });
	mock11.mockImplementationOnce(() => { throw new TypeError(message, { cause: error11 }); });
	mock11.mockImplementation(() => { throw mutable; });
});
const error12 = new Error(`${message} 12`);
it("t12", () => {
	mock12.mockImplementation(() => { throw error12; });
	mock12.mockImplementationOnce(() => { throw new TypeError(message, { cause: error12 }); });
	mock12.mockImplementation(() => { throw mutable; });
});
const error13 = new Error(`${message} 13`);
it("t13", () => {
	mock13.mockImplementation(() => { throw error13; });
	mock13.mockImplementationOnce(() => { throw new TypeError(message, { cause: error13 }); });
	mock13.mockImplementation(() => { throw mutable; });
});
const error14 = new Error(`${message} 14`);
it("t14", () => {
	mock14.mockImplementation(() => { throw error14; });
	mock14.mockImplementationOnce(() => { throw new TypeError(message, { cause: error14 }); });
	mock14.mockImplementation(() => { throw mutable; });
});
const error15 = new Error(`${message} 15`);
it("t15", () => {
	mock15.mockImplementation(() => { throw error15; });
	mock15.mockImplementationOnce(() => { throw new TypeError(message, { cause: error15 }); });
	mock15.mockImplementation(() => { throw mutable; });
});
const error16 = new Error(`${message} 16`);
it("t16", () => {
	mock16.mockImplementation(() => { throw error16; });
	mock16.mockImplementationOnce(() => { throw new TypeError(message, { cause: error16 }); });
	mock16.mockImplementation(() => { throw mutable; });
});
const error17 = new Error(`${message} 17`);
it("t17", () => {
	mock17.mockImplementation(() => { throw error17; });
	mock17.mockImplementationOnce(() => { throw new TypeError(message, { cause: error17 }); });
	mock17.mockImplementation(() => { throw mutable; });
});
const error18 = new Error(`${message} 18`);
it("t18", () => {
	mock18.mockImplementation(() => { throw error18; });
	mock18.mockImplementationOnce(() => { throw new TypeError(message, { cause: error18 }); });
	mock18.mockImplementation(() => { throw mutable; });
});
const error19 = new Error(`${message} 19`);
it("t19", () => {
	mock19.mockImplementation(() => { throw error19; });
	mock19.mockImplementationOnce(() => { throw new TypeError(message, { cause: error19 }); });
	mock19.mockImplementation(() => { throw mutable; });
});
