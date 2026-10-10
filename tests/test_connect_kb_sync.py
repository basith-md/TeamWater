import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from connect import kb_sync
from connect.prism import AGENT_FIELD_GUIDE


class MemoryKnowledgeBase:
    def __init__(self, fail_upload=False):
        self.fail_upload = fail_upload
        self.documents = {
            "old": dict(id="old", name="guide-01.md", content="Outdated fact", agent_id=AGENT_FIELD_GUIDE),
            "other": dict(id="other", name="unrelated.md", content="Keep this", agent_id="another-agent"),
            "same-name": dict(id="same-name", name="guide-01.md", content="Other agent's fact", agent_id="another-agent"),
            "manual": dict(id="manual", name="manual-reference.md", content="Keep too", agent_id=AGENT_FIELD_GUIDE),
        }

    def kb_list_documents(self, agent_id=None):
        return [dict(doc) for doc in self.documents.values() if agent_id is None or doc["agent_id"] == agent_id]

    def kb_upload(self, filename, content, *, agent_id=None, description=None):
        if self.fail_upload:
            return None
        doc = dict(id="replacement", name=filename, content=content, agent_id=agent_id)
        self.documents[doc["id"]] = doc
        return dict(doc)

    def kb_delete_document(self, doc_id):
        self.documents.pop(doc_id)
        return True


class KnowledgeSyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.kb_dir = Path(self.tmp.name)
        (self.kb_dir / "guide.md").write_text("# Guide\n\nUpdated field fact.\n")

    def sync(self, client):
        with patch.object(kb_sync.Settings, "from_env", return_value=SimpleNamespace(kb_dir=self.kb_dir)), \
                patch.object(kb_sync, "make_prism", return_value=SimpleNamespace(enabled=True, client=client)), \
                contextlib.redirect_stdout(io.StringIO()):
            kb_sync.main()

    def test_sync_preserves_documents_it_does_not_own(self):
        client = MemoryKnowledgeBase()
        self.sync(client)
        self.assertTrue({"other", "same-name", "manual"}.issubset(client.documents))

    def test_sync_replaces_existing_fact_after_content_changes(self):
        client = MemoryKnowledgeBase()
        self.sync(client)
        owned = [doc for doc in client.documents.values()
                 if doc["agent_id"] == AGENT_FIELD_GUIDE and doc["name"] == "guide-01.md"]
        self.assertEqual([doc["content"] for doc in owned], ["Updated field fact."])

    def test_failed_replacement_preserves_old_reference_and_reports_failure(self):
        client = MemoryKnowledgeBase(fail_upload=True)
        with self.assertRaises(SystemExit):
            self.sync(client)
        self.assertEqual(client.documents["old"]["content"], "Outdated fact")
        self.assertEqual(len(client.documents), 4)


if __name__ == "__main__":
    unittest.main()
