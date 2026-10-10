"""Upload the reference docs to the PRISM knowledge base, one document per fact.

Run: python -m connect.kb_sync        (idempotent; re-run after editing connect/kb/*.md)
One fact per document keeps citations precise: a search hit points at one claim.
"""

import re
import sys
from pathlib import Path

from .config import HERE, Settings
from .prism import AGENT_FIELD_GUIDE, make_prism


def facts(kb_dir):
    for path in sorted(Path(kb_dir).glob("*.md")):
        n = 0
        for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8")):
            block = block.strip()
            if block and not block.startswith("#"):
                n += 1
                yield f"{path.stem}-{n:02d}.md", block


def main():
    settings = Settings.from_env()
    prism = make_prism(settings)
    if not prism.enabled:
        sys.exit("PRISM is not configured (PRISM_API_KEY / PRISM_PROJECT_ID)")
    client = prism.client
    existing = {d["name"]: d for d in client.kb_list_documents() or []}
    wanted = dict(facts(settings.kb_dir))
    for name, doc in existing.items():
        if name not in wanted:  # stale, e.g. the old single-chunk upload
            client.kb_delete_document(doc["id"])
            print("deleted", name)
    for name, text in wanted.items():
        if name in existing:
            continue
        r = client.kb_upload(name, text, agent_id=AGENT_FIELD_GUIDE,
                             description="Verified Water reference fact")
        print("uploaded", name, "->", (r or {}).get("status", "FAILED"))
    print(f"{len(wanted)} reference facts in PRISM KB")


if __name__ == "__main__":
    main()
