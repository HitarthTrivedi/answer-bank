"""Stands in for the Chrome extension.

The server answers nothing on its own any more, so any test that needs a finished
question bank has to play the extension's part: pull work, post an answer, repeat. That
means these tests exercise the real extension API surface rather than a shortcut.
"""

# Type-appropriate answers, so verification and rendering are still genuinely tested —
# the fake stands in for the model, not for the pipeline around it.
_ANSWERS = {
    "numerical": "**Given** u=0, a=2, t=5\n\nv = u + at\n\nFINAL: 10 m/s\n\n```verify\n0 + 2*5\n```",
    "code": "**Approach**\n\nWalk the list, reversing links.\n\n"
            "```python\ndef reverse(head):\n    prev = None\n    return prev\n```\n\n"
            "**Complexity**: O(n) time, O(1) space.",
    "graph": "The curve rises monotonically.\n\n"
             '```graphspec\n{"title": "y = e^x", "xlabel": "x", "ylabel": "y",'
             ' "xrange": [-3, 3], "expressions": [{"expr": "exp(x)", "label": "e^x"}]}\n```',
    "diagram": "Three tiers, top to bottom.\n\n"
               "```mermaid\nflowchart TD\n  A[Client] --> B[Server] --> C[(DB)]\n```",
    "theory": "**Definition:** the term describes how the system organizes its data.\n\n"
              "- First point\n- Second point\n\n**Takeaway:** it reduces redundancy.",
}


def fake_answer(qtype: str) -> str:
    return _ANSWERS.get(qtype, _ANSWERS["theory"])


def answer_via_extension(client, auth, project_id, limit=100) -> int:
    """Drain a project's work queue the way the real extension does. Returns the count."""
    answered = 0
    for _ in range(limit):
        work = client.get(f"/api/extension/work?project_id={project_id}", headers=auth).json()
        if work.get("done"):
            break
        r = client.post(f"/api/questions/{work['question_id']}/assist",
                        json={"content_md": fake_answer(work["qtype"])}, headers=auth)
        assert r.status_code == 200, r.text
        answered += 1
    return answered


def wait_for(client, auth, project_id, predicate, tries=80):
    """Poll a project until `predicate(project_dict)` holds. Returns the last snapshot.

    The sleep is load-bearing: without it all the tries burn off in milliseconds, before
    the worker's idle tick (3s) ever fires — so any state that only the worker's periodic
    pass repairs would silently never be waited for. 80 × 50ms comfortably spans a tick.
    """
    import time

    p = None
    for _ in range(tries):
        p = client.get(f"/api/projects/{project_id}", headers=auth).json()
        if predicate(p):
            break
        time.sleep(0.05)
    return p
