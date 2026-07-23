// Coarse benchmark fixture for flawless/react-namespace.
// Each function accesses a runtime value through the React namespace (reported
// and rewritten to a named import); the type aliases use bare named type
// imports (reported and qualified to `React.<name>`).
import React from "react";
import type { ReactNode } from "react";

type N0 = ReactNode;
type N1 = ReactNode;
type N2 = ReactNode;
type N3 = ReactNode;
type N4 = ReactNode;

function M0() { return React.useMemo(() => "foo", []); }
function M1() { return React.useMemo(() => "foo", []); }
function M2() { return React.useMemo(() => "foo", []); }
function M3() { return React.useMemo(() => "foo", []); }
function M4() { return React.useMemo(() => "foo", []); }
function M5() { return React.useMemo(() => "foo", []); }
function M6() { return React.useMemo(() => "foo", []); }
function M7() { return React.useMemo(() => "foo", []); }
function M8() { return React.useMemo(() => "foo", []); }
function M9() { return React.useMemo(() => "foo", []); }
function M10() { return React.useMemo(() => "foo", []); }
function M11() { return React.useMemo(() => "foo", []); }
function M12() { return React.useMemo(() => "foo", []); }
function M13() { return React.useMemo(() => "foo", []); }
function M14() { return React.useMemo(() => "foo", []); }
