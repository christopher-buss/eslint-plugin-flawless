// Coarse benchmark fixture for flawless/no-unnecessary-use-callback.
// Each useCallback wraps a trivial factory with no closure deps — the rule reports.
import { useCallback } from "react";

function U0() { const cb = useCallback(() => Number(1), []); return null; }
function U1() { const cb = useCallback(() => Number(1), []); return null; }
function U2() { const cb = useCallback(() => Number(1), []); return null; }
function U3() { const cb = useCallback(() => Number(1), []); return null; }
function U4() { const cb = useCallback(() => Number(1), []); return null; }
function U5() { const cb = useCallback(() => Number(1), []); return null; }
function U6() { const cb = useCallback(() => Number(1), []); return null; }
function U7() { const cb = useCallback(() => Number(1), []); return null; }
function U8() { const cb = useCallback(() => Number(1), []); return null; }
function U9() { const cb = useCallback(() => Number(1), []); return null; }
function U10() { const cb = useCallback(() => Number(1), []); return null; }
function U11() { const cb = useCallback(() => Number(1), []); return null; }
function U12() { const cb = useCallback(() => Number(1), []); return null; }
function U13() { const cb = useCallback(() => Number(1), []); return null; }
function U14() { const cb = useCallback(() => Number(1), []); return null; }
function U15() { const cb = useCallback(() => Number(1), []); return null; }
function U16() { const cb = useCallback(() => Number(1), []); return null; }
function U17() { const cb = useCallback(() => Number(1), []); return null; }
function U18() { const cb = useCallback(() => Number(1), []); return null; }
function U19() { const cb = useCallback(() => Number(1), []); return null; }
