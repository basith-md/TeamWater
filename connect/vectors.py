"""Wire-format test vectors shared with the phone module (shippable/water-ai).

Run `python -m connect.vectors` to regenerate shippable/water-ai/test-vectors.json.
tests/test_connect.py checks the committed file still matches this server code, and the
TypeScript tests check the phone module reproduces every byte, so the two cannot drift apart.
"""

import json
import struct
import uuid
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import security
from .pipeline import OUTCOME, Result

OUT = Path(__file__).resolve().parent.parent / "shippable" / "water-ai" / "test-vectors.json"


def _seal_fixed(key, request_id, device_id, plaintext, purpose, nonce):
    return nonce + AESGCM(key).encrypt(nonce, plaintext, security._aad(request_id, device_id, purpose))


def build():
    key = bytes(range(32))
    rid, dev = "7d5e5b2c-3a8f-4d6e-9b1c-2f0a6e4d8c11", 42
    question, model_index = "How fast is Long Fast?", 3
    q_nonce, a_nonce = bytes(range(100, 112)), bytes(range(200, 212))
    sealed_q = _seal_fixed(key, rid, dev, bytes([model_index]) + question.encode(), b"Q", q_nonce)
    answer = Result("ok", "About 1.07 kbps.", {"sources": [{"source": "field_guide-01.md"}]})
    sealed_a = _seal_fixed(key, rid, dev, answer.wire(), b"A", a_nonce)
    general = Result("general", "France won.", {})
    sealed_g = _seal_fixed(key, rid, dev, general.wire(), b"A", a_nonce)
    body = json.dumps({"request_id": rid, "device_id": dev, "sealed": security.b64e(sealed_q)}).encode()
    return {
        "key_hex": key.hex(), "request_id": rid, "device_id": dev,
        "question": question, "model_index": model_index,
        "question_nonce_hex": q_nonce.hex(), "sealed_question_hex": sealed_q.hex(),
        "request_frame_hex": (uuid.UUID(rid).bytes + struct.pack("!I", dev) + sealed_q).hex(),
        "answer_nonce_hex": a_nonce.hex(), "answer_frame_hex": (uuid.UUID(rid).bytes + sealed_a).hex(),
        "answer": {"outcome": "ok", "text": "About 1.07 kbps.", "sources": ["field_guide-01"]},
        "general_answer_frame_hex": (uuid.UUID(rid).bytes + sealed_g).hex(),
        "general_answer": {"outcome": "general", "text": "France won.", "sources": []},
        "outcome_codes": {name: code for name, code in OUTCOME.items()},
        "relay_body": body.decode(), "relay_timestamp": "1791700000.5",
        "relay_signature_hex": security.sign(key, "1791700000.5", body),
    }


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=2) + "\n", encoding="utf-8")
    print("wrote", OUT)
