"""PRISM (Block Convey) wiring. Every method degrades to a no-op so the app still works
when PRISM or the network is down; callers record that fact in the answer metadata."""

import threading
import time

AGENT_GATEWAY = "teamwater-gateway"
AGENT_SUMMARIZER = "teamwater-summarizer"
AGENT_FIELD_GUIDE = "teamwater-field-guide"


class Prism:
    def __init__(self, client=None):
        self.client = client

    @property
    def enabled(self):
        return self.client is not None

    def kb_search(self, query, limit=3):
        """Returns [{source, text, score}] or None if PRISM could not be reached."""
        if not self.enabled:
            return None
        try:
            hits = self.client.kb_search(query, agent_id=AGENT_FIELD_GUIDE, limit=limit)
        except Exception:
            return None
        return [dict(source=h.get("doc_name", "?"), text=h.get("content", ""),
                     score=h.get("relevance_score") or 0.0) for h in hits or []]

    def trace_call(self, agent_id, model, question, answer, started, meta=None):
        """One LLM call, recorded under a stable agent_id. Fire-and-forget."""
        if not self.enabled:
            return
        latency = int((time.time() - started) * 1000)
        threading.Thread(target=self._send, daemon=True, args=(agent_id, model, question, answer, latency, meta)).start()

    def _send(self, agent_id, model, question, answer, latency, meta):
        try:
            self.client.trace_llm(
                model=model, input_messages=[{"role": "user", "content": question}], output=answer,
                latency_ms=latency, agent_id=agent_id, agent_name=agent_id, metadata=meta or {})
            self.client.flush()
        except Exception:
            pass

    def evaluate_shortening(self, full, short, model):
        """Submit full->short as a trajectory so a PRISM evaluator can score fact retention.
        Returns the trajectory id, or None."""
        if not self.enabled:
            return None
        try:
            res = self.client.submit_trajectory(
                [
                    dict(step_type="reasoning", label="Full model answer", output_summary=full[:2000]),
                    dict(step_type="final_answer", label="Shortened to <=300 bytes for radio", output_summary=short),
                ],
                agent_name=AGENT_SUMMARIZER, agent_id=AGENT_SUMMARIZER, model=model)
            return (res or {}).get("id") or (res or {}).get("trajectory_id")
        except Exception:
            return None

    def evaluation(self, trajectory_id):
        if not (self.enabled and trajectory_id):
            return None
        try:
            return self.client.get_trajectory_evaluation(trajectory_id)
        except Exception:
            return None


def make_prism(settings):
    if not (settings.prism_api_key and settings.prism_project_id):
        return Prism(None)
    from prismtrace import PRISMtrace

    return Prism(PRISMtrace(api_key=settings.prism_api_key, host=settings.prism_host,
                            project_id=settings.prism_project_id, timeout=30))
