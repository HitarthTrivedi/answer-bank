"""Graph + math rendering from declarative specs. No model-generated code is ever
executed — expressions pass the same allowlist as verify.py and are lambdified
through SymPy. Output is PNG bytes."""
import hashlib
import io
import json
import re

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from .verify import _ALLOWED, _FORBIDDEN  # same expression hygiene everywhere

GRAPHSPEC_FENCE = re.compile(r"```graphspec\s*\n(.*?)```", re.DOTALL)
MERMAID_FENCE = re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL)

MAX_EXPRESSIONS = 5
MAX_POINTS = 20


def spec_key(spec_text: str) -> str:
    """Stable key tying a fence in the markdown to its rendered asset."""
    return hashlib.sha256(spec_text.strip().encode()).hexdigest()[:16]


def parse_graphspec(spec_text: str) -> dict | None:
    try:
        spec = json.loads(spec_text)
    except json.JSONDecodeError:
        return None
    if not isinstance(spec, dict):
        return None
    xr = spec.get("xrange", [-10, 10])
    if (
        not isinstance(xr, list) or len(xr) != 2
        or not all(isinstance(v, (int, float)) for v in xr) or xr[0] >= xr[1]
        or xr[1] - xr[0] > 1e6
    ):
        return None
    exprs = spec.get("expressions", [])
    if not isinstance(exprs, list) or not (0 < len(exprs) <= MAX_EXPRESSIONS):
        return None
    for e in exprs:
        expr = str(e.get("expr", ""))
        cleaned = expr.replace("**", "")
        if not _ALLOWED.match(cleaned) or any(bad in expr.lower() for bad in _FORBIDDEN):
            return None
    return spec


def render_graphspec(spec_text: str) -> bytes | None:
    spec = parse_graphspec(spec_text)
    if spec is None:
        return None
    try:
        import numpy as np
        import sympy

        x = sympy.Symbol("x")
        xs = np.linspace(float(spec["xrange"][0]), float(spec["xrange"][1]), 500)

        fig, ax = plt.subplots(figsize=(7, 4.2), dpi=110)
        plotted = False
        for e in spec["expressions"][:MAX_EXPRESSIONS]:
            try:
                sym = sympy.sympify(str(e["expr"]).replace("^", "**"))
                fn = sympy.lambdify(x, sym, modules=["numpy"])
                with np.errstate(all="ignore"):
                    ys = np.asarray(fn(xs), dtype=float)
                if ys.shape != xs.shape:  # constant expression
                    ys = np.full_like(xs, float(ys))
                ys[~np.isfinite(ys)] = np.nan
                ax.plot(xs, ys, linewidth=2, label=str(e.get("label", e["expr"]))[:40])
                plotted = True
            except Exception:
                continue
        if not plotted:
            plt.close(fig)
            return None

        for p in (spec.get("points") or [])[:MAX_POINTS]:
            try:
                ax.scatter([float(p["x"])], [float(p["y"])], zorder=5, color="#dc2626")
                if p.get("label"):
                    ax.annotate(str(p["label"])[:30], (float(p["x"]), float(p["y"])),
                                textcoords="offset points", xytext=(6, 6), fontsize=8)
            except Exception:
                continue

        ax.set_title(str(spec.get("title", ""))[:80])
        ax.set_xlabel(str(spec.get("xlabel", "x"))[:40])
        ax.set_ylabel(str(spec.get("ylabel", "y"))[:40])
        ax.grid(True, alpha=0.3)
        ax.axhline(0, color="black", linewidth=0.6)
        ax.axvline(0, color="black", linewidth=0.6)
        if len(spec["expressions"]) > 1 or any(e.get("label") for e in spec["expressions"]):
            ax.legend(fontsize=9)
        fig.tight_layout()

        buf = io.BytesIO()
        fig.savefig(buf, format="png")
        plt.close(fig)
        return buf.getvalue()
    except Exception:
        return None


def render_mathtext(latex: str) -> bytes | None:
    """Display-math → PNG for DOCX export, via matplotlib's mathtext (LaTeX subset)."""
    try:
        fig = plt.figure(figsize=(0.1, 0.1), dpi=200)
        t = fig.text(0, 0, f"${latex.strip()}$", fontsize=13)
        fig.canvas.draw()
        bbox = t.get_window_extent()
        fig.set_size_inches(bbox.width / 200 + 0.15, bbox.height / 200 + 0.1)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0.05, transparent=True)
        plt.close(fig)
        return buf.getvalue()
    except Exception:
        plt.close("all")
        return None
