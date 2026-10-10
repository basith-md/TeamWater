import importlib.util
import io
import contextlib
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "packet_ledger", Path(__file__).resolve().parents[1] / "scripts/packet-ledger.py"
)
ledger_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger_module)


def event(sequence, kind="packet_tx", **fields):
    return {"sequence": sequence, "type": kind, "msg_id": "abc", "simulation_time": 1.25,
            "source": "node0", "destination": "node4", "chunk": 2, **fields}


class PacketLedgerTests(unittest.TestCase):
    def test_merges_overlapping_real_snapshots_without_duplicate_rows(self):
        ledger = ledger_module.PacketLedger(limit=3)
        ledger.apply({"events": [event(1, frame_bytes=230), event(2, "packet_rx")], "messages": {"abc": {}}})
        ledger.apply({"events": [event(2, "packet_rx"), event(3, "packet_dropped"), event(4, "packet_retry")], "messages": {"abc": {}}})
        self.assertEqual([row["sequence"] for row in ledger.events], [2, 3, 4])

    def test_reset_clears_history_and_accepts_reused_sequence_numbers(self):
        ledger = ledger_module.PacketLedger()
        ledger.apply({"events": [event(20)], "messages": {"abc": {}}})
        ledger.apply({"events": [], "messages": {}})
        self.assertEqual(ledger.events, [])
        ledger.apply({"events": [event(1, "receipt_verified")], "messages": {"abc": {}}})
        self.assertEqual([row["sequence"] for row in ledger.events], [1])
        ledger.apply({"events": [event(1, "packet_tx", msg_id="new")], "messages": {"new": {}}})
        self.assertEqual(ledger.events[0]["msg_id"], "new")

    def test_formatter_reports_measured_bytes_and_leaves_unknown_unavailable(self):
        text = ledger_module.format_event(event(1, frame_bytes=230), {"node0": "Malcome", "node4": "Basith"})
        for value in ["1.25", "abc", "#2", "Malcome", "Basith", "230", "TX"]:
            self.assertIn(value, text)
        received = ledger_module.format_event(event(2, "packet_rx"), {})
        self.assertIn("—", received)
        self.assertNotIn("0 B", received)

    def test_dashboard_shows_all_nodes_connection_and_fits_terminal(self):
        ledger = ledger_module.PacketLedger()
        nodes = [{"id": f"node{i}", "name": name, "online": i != 5} for i, name in enumerate(
            ["Malcome", "Shravanthi", "Lucas", "Dave", "Basith", "Frank"])]
        ledger.apply({"nodes": nodes, "events": [event(i) for i in range(1, 30)], "messages": {"abc": {}}})
        text = ledger.render(width=70, height=20, status="Reconnecting")
        for node in nodes:
            self.assertIn(node["name"], text)
        self.assertIn("OFFLINE", text)
        self.assertIn("Reconnecting", text)
        self.assertLessEqual(len(text.splitlines()), 20)
        self.assertTrue(all(len(line) <= 70 for line in text.splitlines()))

    def test_terminal_redraw_keeps_header_without_a_scrolling_newline(self):
        class TerminalOutput(io.StringIO):
            def isatty(self):
                return True
        output = TerminalOutput()
        with contextlib.redirect_stdout(output):
            ledger_module.draw(ledger_module.PacketLedger(), "Connected")
        rendered = output.getvalue()
        self.assertTrue(rendered.startswith("\033[2J\033[H"))
        self.assertIn("WATER CONNECT", rendered)
        self.assertFalse(rendered.endswith("\n"))


if __name__ == "__main__":
    unittest.main()
