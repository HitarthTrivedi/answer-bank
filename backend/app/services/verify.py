"""Numerical verification: the model must show its computation as a bare arithmetic
expression; we evaluate it with SymPy under a strict character allowlist and compare
against its own declared FINAL value. Catches arithmetic slips — the classic LLM
failure on numericals.

Never blocks an answer: verification is a badge (True/False/None), not a gate.
"""
import re

_ALLOWED = re.compile(r"^[0-9a-zA-Z_+\-*/^().,\s]{1,300}$")
_FORBIDDEN = ("__", "lambda", "import", "eval", "exec", "open")

_SAFE_LOCALS_NAMES = [
    "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
    "log", "exp", "sqrt", "pi", "E", "Abs", "factorial", "Rational",
]


def safe_eval(expr: str) -> float | None:
    """Evaluate a pure-arithmetic expression. Returns None on anything suspicious or unparseable."""
    expr = expr.strip().replace("^", "**")
    if not _ALLOWED.match(expr.replace("**", "")):
        return None
    low = expr.lower()
    if any(bad in low for bad in _FORBIDDEN):
        return None
    try:
        import sympy

        locals_map = {name: getattr(sympy, name) for name in _SAFE_LOCALS_NAMES}
        val = sympy.sympify(expr, locals=locals_map, evaluate=True)
        return float(val.evalf())
    except Exception:
        return None


_FINAL = re.compile(r"^\s*\**FINAL:?\**\s*(.+)$", re.MULTILINE)
_VERIFY_FENCE = re.compile(r"```verify\s*\n(.*?)```", re.DOTALL)
_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?")


def check_numerical(answer_md: str) -> tuple[bool | None, str]:
    """Compare the FINAL: value with the evaluated ```verify expression."""
    final_m = _FINAL.search(answer_md)
    fence_m = _VERIFY_FENCE.search(answer_md)
    if not final_m or not fence_m:
        return None, "no FINAL/verify block to check"

    num_m = _NUMBER.search(final_m.group(1))
    if not num_m:
        return None, "FINAL line has no numeric value"
    declared = float(num_m.group(0).replace(",", ""))

    computed = safe_eval(fence_m.group(1))
    if computed is None:
        return None, "verify expression not safely evaluable"

    tol = max(abs(declared) * 1e-3, 1e-6)  # forgive display rounding
    if abs(computed - declared) <= tol:
        return True, f"recomputed {computed:g} ≈ declared {declared:g}"
    return False, f"MISMATCH: recomputed {computed:g} vs declared {declared:g}"
