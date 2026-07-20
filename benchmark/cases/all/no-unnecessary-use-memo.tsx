// Coarse benchmark fixture for flawless/no-unnecessary-use-memo.
// Each useMemo returns a constant with no real computation — the rule reports.
import { useMemo } from "react";

function M0() { const bar = useMemo(() => "foo", []); return null; }
function M1() { const bar = useMemo(() => "foo", []); return null; }
function M2() { const bar = useMemo(() => "foo", []); return null; }
function M3() { const bar = useMemo(() => "foo", []); return null; }
function M4() { const bar = useMemo(() => "foo", []); return null; }
function M5() { const bar = useMemo(() => "foo", []); return null; }
function M6() { const bar = useMemo(() => "foo", []); return null; }
function M7() { const bar = useMemo(() => "foo", []); return null; }
function M8() { const bar = useMemo(() => "foo", []); return null; }
function M9() { const bar = useMemo(() => "foo", []); return null; }
function M10() { const bar = useMemo(() => "foo", []); return null; }
function M11() { const bar = useMemo(() => "foo", []); return null; }
function M12() { const bar = useMemo(() => "foo", []); return null; }
function M13() { const bar = useMemo(() => "foo", []); return null; }
function M14() { const bar = useMemo(() => "foo", []); return null; }
function M15() { const bar = useMemo(() => "foo", []); return null; }
function M16() { const bar = useMemo(() => "foo", []); return null; }
function M17() { const bar = useMemo(() => "foo", []); return null; }
function M18() { const bar = useMemo(() => "foo", []); return null; }
function M19() { const bar = useMemo(() => "foo", []); return null; }
