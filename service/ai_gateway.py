"""Simulated Water AI gateway on top of the mesh simulator.

One node is the internet node (the gateway). An AI question is sealed on the asker's phone,
crosses the lossy mesh to the gateway as an ``ai_request`` transfer, the gateway relays the
still-sealed bytes to Water Connect over its signed HTTP API, and the sealed answer crosses
the mesh back as an ``ai_response`` transfer. Only the asker can open either one.

Every retry reuses the request ID, so if the gateway changes mid-flight the new gateway
gets the stored answer from Water Connect: no second AI call.
"""

import asyncio
import json
import struct
import time
import uuid

import httpx

from connect import models, security

STAGES = ("waiting_for_gateway", "to_gateway", "ai_working", "answer_arriving", "answered", "failed")
MAX_ATTEMPTS = 3
GATEWAY_WAIT_SECONDS = 90
HISTORY = 30
SEP = b"\x1e"  # answer wire: outcome byte + text [+ SEP + comma-separated source ids]


def parse_answer(plain):
    outcome = {0: "ok", 1: "blocked", 2: "over_budget", 3: "no_grounding", 4: "error", 5: "general"}.get(plain[0], "error")
    text, _, sources = plain[1:].partition(SEP)
    return outcome, text.decode("utf-8", "replace"), [s for s in sources.decode().split(",") if s]


class AiGateway:
    def __init__(self, get_backend, connect_app, devices, notify, internet_node="node5"):
        self.get_backend, self.devices, self.notify = get_backend, devices, notify
        self.connect_app = connect_app
        self.internet_node = internet_node
        self.requests = {}
        self._tasks = set()

    # ---------- public ----------
    def set_internet_node(self, node_id):
        if node_id is not None and node_id not in self.get_backend().nodes:
            raise ValueError("Unknown node")
        self.internet_node = node_id
        self.notify()

    async def ask(self, src, question, model_index=models.DEFAULT_INDEX):
        question = " ".join(question.split())
        if src not in self.devices or src not in self.get_backend().nodes:
            raise ValueError("That phone is not connected to Water AI")
        if not question:
            raise ValueError("Ask a question first")
        if len(question.encode()) > 400:
            raise ValueError("Keep AI questions under 400 bytes: they travel over the radio")
        rid = str(uuid.uuid4())
        model = models.resolve(model_index)
        self.requests[rid] = dict(
            request_id=rid, asker=src, gateway=None, question=question,
            model_index=models.MODELS.index(model), model=model["id"], stage="waiting_for_gateway",
            stages=[dict(stage="waiting_for_gateway", at=time.time())], attempts=0,
            request_msg_ids=[], answer_msg_ids=[], answer=None, outcome=None, sources=[],
            receipt=False, error="", created_at=time.time(), note="")
        for old in list(self.requests)[:-HISTORY]:
            self.requests.pop(old, None)
        task = asyncio.create_task(self._run(rid))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        self.notify()
        return rid

    def state(self):
        return dict(internet_node=self.internet_node, connected_nodes=sorted(self.devices),
                    requests=list(self.requests.values()))

    async def close(self):
        for t in list(self._tasks):
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    # ---------- flow ----------
    def _stage(self, rec, stage, **fields):
        rec.update(fields, stage=stage)
        if rec["stages"][-1]["stage"] != stage:
            rec["stages"].append(dict(stage=stage, at=time.time()))
        self.notify()

    async def _gateway_for(self, rec):
        """Wait until an internet node exists that the asker can reach over the mesh."""
        deadline = time.time() + GATEWAY_WAIT_SECONDS
        while time.time() < deadline:
            gw, backend = self.internet_node, self.get_backend()
            if gw and gw in self.devices and (gw == rec["asker"] or backend._route(rec["asker"], gw)):
                return gw
            self._stage(rec, "waiting_for_gateway", gateway=None,
                        note="No internet node selected" if not gw else f"{gw} is not reachable over the mesh")
            await asyncio.sleep(0.5)
        return None

    async def _transfer(self, src, dst, data, kind, preview, ids):
        """Send over the mesh; return the bytes the destination verified, or None."""
        backend = self.get_backend()
        mid = await backend.send_message(src, dst, data, media_type=kind, preview=preview, metadata={
            "codec": "water-sealed", "mime": "application/octet-stream", "original_bytes": len(data)})
        ids.append(mid)
        self.notify()
        await backend.wait_message(mid)
        media = backend.received_media.get(mid)
        return (media.data if media is not None else None), backend.messages[mid].status

    async def _call_connect(self, path, gw, payload):
        device_id, key = self.devices[gw]
        body = json.dumps(payload).encode()
        ts = str(time.time())
        headers = {"X-Device-Id": str(device_id), "X-Timestamp": ts, "X-Signature": security.sign(key, ts, body),
                   "Content-Type": "application/json"}
        transport = httpx.ASGITransport(app=self.connect_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://water-connect", timeout=60) as client:
            r = await client.post(path, content=body, headers=headers)
        r.raise_for_status()
        return r.json()

    async def _run(self, rid):
        rec = self.requests[rid]
        asker_dev, asker_key = self.devices[rec["asker"]]
        sealed_q = security.seal(asker_key, rid, asker_dev, bytes([rec["model_index"]]) + rec["question"].encode(), b"Q")
        envelope = uuid.UUID(rid).bytes + struct.pack("!I", asker_dev) + sealed_q
        try:
            while rec["attempts"] < MAX_ATTEMPTS:
                rec["attempts"] += 1
                gw = await self._gateway_for(rec)
                if gw is None:
                    return self._stage(rec, "failed", error="No reachable internet node. Nothing was sent to the AI.")
                handover = rec["gateway"] not in (None, gw)
                rec["gateway"] = gw

                # 1. question over the mesh (skipped when the asker itself has internet)
                if gw != rec["asker"]:
                    self._stage(rec, "to_gateway", note=f"Sealed question → {gw}" + (" (new gateway)" if handover else ""))
                    received, status = await self._transfer(rec["asker"], gw, envelope, "ai_request",
                                                            "Sealed AI question", rec["request_msg_ids"])
                    if received is None:
                        rec["note"] = f"Question did not reach {gw} ({status}); retrying"
                        continue
                else:
                    received = envelope

                # 2. gateway relays the still-sealed bytes; it cannot read them
                self._stage(rec, "ai_working", note=f"{gw} relayed it to Water Connect")
                rid_bytes, dev = received[:16], struct.unpack("!I", received[16:20])[0]
                try:
                    resp = await self._call_connect("/v1/relay", gw, dict(
                        request_id=str(uuid.UUID(bytes=rid_bytes)), device_id=dev, sealed=security.b64e(received[20:])))
                except httpx.HTTPError as exc:
                    rec["note"] = f"Water Connect unreachable from {gw}: {type(exc).__name__}"
                    await asyncio.sleep(1)
                    continue
                if resp["state"] == "already_claimed":
                    rec["note"] = "Another gateway is answering; waiting"
                    rec["attempts"] -= 1
                    await asyncio.sleep(min(5, resp.get("retry_after", 2)))
                    continue
                rec["server_view"] = {k: resp["meta"].get(k) for k in ("model", "kb_via", "guardrail", "sources")}
                sealed_a = security.b64d(resp["answer"])

                # 3. sealed answer back over the mesh
                if gw != rec["asker"]:
                    self._stage(rec, "answer_arriving", note=f"{gw} → {rec['asker']}")
                    got, status = await self._transfer(gw, rec["asker"], rid_bytes + sealed_a, "ai_response",
                                                       "Sealed AI answer", rec["answer_msg_ids"])
                    if got is None:
                        rec["note"] = f"Answer lost on the way back ({status}); asking again (no new AI call)"
                        continue
                    sealed_a = got[16:]

                # 4. only the asker can open it
                outcome, text, sources = parse_answer(security.unseal(asker_key, rid, asker_dev, sealed_a, b"A"))
                self._stage(rec, "answered", answer=text, outcome=outcome, sources=sources, note="")
                try:
                    await self._call_connect("/v1/receipt", gw, dict(request_id=rid))
                    rec["receipt"] = True
                    self.notify()
                except httpx.HTTPError:
                    pass
                return
            self._stage(rec, "failed", error=f"Gave up after {MAX_ATTEMPTS} attempts. {rec['note']}")
        except asyncio.CancelledError:
            self._stage(rec, "failed", error="Simulation was reset")
            raise
        except Exception as exc:  # never leave the phone spinning
            self._stage(rec, "failed", error=f"{type(exc).__name__}: {exc}")
