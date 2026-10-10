"""Upload the reference docs to the PRISM knowledge base, one document per fact.

Run: python -m connect.kb_sync        (re-run after editing connect/kb/*.md)
One fact per document keeps citations precise: a search hit points at one claim.
Only matching field-guide documents are replaced. Removed local facts and unrelated
remote documents require explicit deletion in PRISM; absence is not proof of ownership.
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
    existing = client.kb_list_documents(agent_id=AGENT_FIELD_GUIDE) or []
    wanted = dict(facts(settings.kb_dir))
    for name, text in wanted.items():
        # The SDK has upload/delete, not update. Upload first so a failed replacement
        # never destroys the currently usable reference.
        r = client.kb_upload(name, text, agent_id=AGENT_FIELD_GUIDE,
                             description="Verified Water reference fact")
        if not r or not r.get("id"):
            sys.exit(f"Upload failed for {name}; existing reference preserved")
        for doc in existing:
            if doc["name"] == name and doc["id"] != r["id"]:
                if not client.kb_delete_document(doc["id"]):
                    sys.exit(f"Uploaded {name}, but could not remove its older copy {doc['id']}")
        print("uploaded", name, "->", r.get("status", "uploaded"))
    print(f"{len(wanted)} reference facts in PRISM KB")


if __name__ == "__main__":
    main()
