"""Water Connect: sign-up, groups, device keys, and the gateway relay API.

Runs standalone (uvicorn connect.app:create_app --factory) or mounted inside the mesh
service under /connect. Every link and redirect is built from the ASGI root_path, so both
work without changes.
"""

import hmac
import json
import secrets
import sqlite3
import time
import uuid
from urllib.parse import urlencode

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader, select_autoescape
from starlette.middleware.sessions import SessionMiddleware

from . import db, demo, models, pipeline, security
from .config import HERE, Settings
from .prism import make_prism
from .providers import make_provider

INVITE_TTL = 7 * 86400
TOKEN_TTL = 300
MAX_SKEW = 300
OUTCOME_BADGE = {
    "ok": ("ok", "Answered"), "general": ("warn", "General answer"), "no_grounding": ("warn", "I don't know"), "blocked": ("bad", "Blocked"),
    "over_budget": ("warn", "Over budget"), "error": ("bad", "Error"),
}


def ago(ts):
    if not ts:
        return "never"
    s = int(time.time() - ts)
    return "just now" if s < 60 else f"{s // 60} min ago" if s < 3600 else f"{s // 3600} h ago" if s < 86400 else f"{s // 86400} d ago"


def create_app(settings=None, provider=None, prism=None):
    settings = settings or Settings.from_env()
    db.init(settings.db_path)
    provider = provider or make_provider(settings)
    prism = prism or make_prism(settings)
    kb = pipeline.KnowledgeBase(settings.kb_dir, prism)
    env = Environment(loader=FileSystemLoader(HERE / "templates"), autoescape=select_autoescape())
    app = FastAPI(title="Water Connect")
    app.add_middleware(SessionMiddleware, secret_key=settings.session_secret, same_site="lax",
                       session_cookie="water_connect")
    app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
    app.state.settings, app.state.kb = settings, kb
    if settings.demo_account:
        app.state.demo = demo.seed(settings)

    def conn():
        return db.connect(settings.db_path)

    def base(request):
        return request.scope.get("root_path", "").rstrip("/")

    def go(request, path):
        return RedirectResponse(base(request) + path, 303)

    def current_user(request):
        uid = request.session.get("uid")
        if not uid:
            return None
        with conn() as c:
            return c.execute("SELECT id, email FROM users WHERE id=?", (uid,)).fetchone()

    def page(request, name, **ctx):
        ctx.setdefault("user", current_user(request))
        return HTMLResponse(env.get_template(name).render(
            base=base(request), demo=settings.demo_account and demo.CREDENTIALS, **ctx))

    def need_user(request):
        user = current_user(request)
        if not user:
            path = request.url.path[len(base(request)):] or "/"
            if request.url.query:
                path += "?" + request.url.query
            raise HTTPException(303, headers={"Location": base(request) + "/login?" + urlencode({"next": path})})
        return user

    def safe_next(url):
        return url if url.startswith("/") and not url.startswith("//") else "/"

    def member_role(c, group_id, user_id):
        row = c.execute("SELECT role FROM memberships WHERE group_id=? AND user_id=?",
                        (group_id, user_id)).fetchone()
        return row["role"] if row else None

    def user_groups(c, user_id):
        return c.execute(
            "SELECT g.id, g.name, g.default_model, g.model_set, m.role, "
            "(SELECT COUNT(*) FROM memberships x WHERE x.group_id=g.id) AS members, "
            "(SELECT COUNT(*) FROM devices d WHERE d.group_id=g.id) AS phones, "
            "(SELECT COUNT(*) FROM invites i WHERE i.group_id=g.id) AS invites "
            "FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.id",
            (user_id,)).fetchall()

    # ---------- accounts ----------
    @app.get("/", response_class=HTMLResponse)
    def home(request: Request):
        user = current_user(request)
        if not user:
            return page(request, "landing.html", user=None)
        with conn() as c:
            groups = user_groups(c, user["id"])
        first = groups[0] if groups else None
        gpath = f"/groups/{first['id']}" if first else None
        checklist = [
            dict(title="Create a group", hint="Your camp or crew", done=bool(first), href=None),
            dict(title="Invite people", hint="Share a 7-day link", done=bool(first and (first["invites"] or first["members"] > 1)), href=gpath),
            dict(title="Connect a phone", hint="Water → Settings → Enable AI", done=bool(first and first["phones"]),
                 href=f"/connect?group_id={first['id']}" if first else None),
            dict(title="Pick a default model", hint="Cost and privacy differ", done=bool(first and first["model_set"]), href=gpath),
        ]
        for s in checklist:
            if s["href"]:
                s["href"] = base(request) + s["href"]
        return page(request, "home.html", user=user, groups=groups, checklist=checklist, active="groups")

    @app.get("/signup", response_class=HTMLResponse)
    def signup_form(request: Request):
        return page(request, "auth.html", mode="signup", error=None, next=request.query_params.get("next", "/"))

    @app.post("/signup")
    def signup(request: Request, email: str = Form(...), password: str = Form(...), next: str = Form("/")):
        email = email.strip().lower()
        if "@" not in email or len(password) < 8:
            return page(request, "auth.html", mode="signup", next=next,
                        error="Use a valid email and a password of 8+ characters.")
        with conn() as c:
            try:
                cur = c.execute("INSERT INTO users(email,password_hash,created_at) VALUES(?,?,?)",
                                (email, security.hash_password(password), time.time()))
            except sqlite3.IntegrityError:
                return page(request, "auth.html", mode="signup", next=next,
                            error="That email is already registered. Log in instead.")
        request.session["uid"] = cur.lastrowid
        return go(request, safe_next(next))

    @app.get("/login", response_class=HTMLResponse)
    def login_form(request: Request):
        return page(request, "auth.html", mode="login", error=None, next=request.query_params.get("next", "/"))

    @app.post("/login")
    def login(request: Request, email: str = Form(...), password: str = Form(...), next: str = Form("/")):
        with conn() as c:
            row = c.execute("SELECT * FROM users WHERE email=?", (email.strip().lower(),)).fetchone()
        if not row or not security.verify_password(password, row["password_hash"]):
            return page(request, "auth.html", mode="login", next=next, error="Wrong email or password.")
        request.session["uid"] = row["id"]
        return go(request, safe_next(next))

    @app.post("/demo-login")
    def demo_login(request: Request, next: str = Form("/")):
        if not settings.demo_account:
            raise HTTPException(404, "Demo account is disabled")
        request.session["uid"] = app.state.demo["user_id"]
        return go(request, safe_next(next))

    @app.post("/logout")
    def logout(request: Request):
        request.session.clear()
        return go(request, "/")

    # ---------- groups ----------
    @app.post("/groups")
    def create_group(request: Request, name: str = Form(...)):
        user = need_user(request)
        with conn() as c:
            cur = c.execute("INSERT INTO groups(name,owner_id,created_at) VALUES(?,?,?)",
                            (name.strip()[:60] or "My group", user["id"], time.time()))
            c.execute("INSERT INTO memberships VALUES(?,?,?)", (cur.lastrowid, user["id"], "owner"))
        return go(request, f"/groups/{cur.lastrowid}")

    @app.get("/groups/{group_id}", response_class=HTMLResponse)
    def group_page(request: Request, group_id: int):
        user = need_user(request)
        with conn() as c:
            if not member_role(c, group_id, user["id"]):
                raise HTTPException(403, "Not a member of this group")
            g = c.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
            members = c.execute("SELECT u.email, m.role FROM memberships m JOIN users u ON u.id=m.user_id "
                                "WHERE m.group_id=? ORDER BY m.role DESC, u.email", (group_id,)).fetchall()
            devices = [dict(id=d["id"], name=d["name"], owner=d["email"], seen="last seen " + ago(d["last_seen"]))
                       for d in c.execute("SELECT d.*, u.email FROM devices d JOIN users u ON u.id=d.user_id "
                                          "WHERE d.group_id=? ORDER BY d.id", (group_id,))]
            day = time.strftime("%Y-%m-%d", time.gmtime())
            row = c.execute("SELECT calls FROM usage WHERE group_id=? AND day=?", (group_id, day)).fetchone()
        code = request.query_params.get("invite")
        invite_url = f"{str(request.base_url).rstrip('/')}{base(request)}/join/{code}" if code else None
        return page(request, "group.html", group=g, members=members, devices=devices, invite_url=invite_url,
                    usage=row["calls"] if row else 0, budget=settings.group_daily_budget,
                    models=models.public_list(), active="groups")

    @app.post("/groups/{group_id}/model")
    def set_model(request: Request, group_id: int, model_index: int = Form(...)):
        user = need_user(request)
        if not 0 <= model_index < len(models.MODELS):
            raise HTTPException(400, "Unknown model")
        with conn() as c:
            if not member_role(c, group_id, user["id"]):
                raise HTTPException(403, "Not a member of this group")
            c.execute("UPDATE groups SET default_model=?, model_set=1 WHERE id=?", (model_index, group_id))
        return go(request, f"/groups/{group_id}")

    @app.post("/groups/{group_id}/invites")
    def make_invite(request: Request, group_id: int):
        user = need_user(request)
        code = secrets.token_urlsafe(9)
        with conn() as c:
            if not member_role(c, group_id, user["id"]):
                raise HTTPException(403, "Not a member of this group")
            c.execute("INSERT INTO invites VALUES(?,?,?,NULL)", (code, group_id, time.time() + INVITE_TTL))
        return go(request, f"/groups/{group_id}?invite={code}")

    @app.get("/join/{code}")
    def join(request: Request, code: str):
        user = need_user(request)
        with conn() as c:
            inv = c.execute("SELECT * FROM invites WHERE code=?", (code,)).fetchone()
            if not inv or inv["expires_at"] < time.time():
                raise HTTPException(404, "Invite not found or expired")
            c.execute("INSERT OR IGNORE INTO memberships VALUES(?,?,?)", (inv["group_id"], user["id"], "member"))
        return go(request, f"/groups/{inv['group_id']}")

    @app.get("/models", response_class=HTMLResponse)
    def models_page(request: Request):
        need_user(request)
        return page(request, "models.html", models=models.public_list(), active="models")

    # ---------- device setup: consent, then redirect back to Water ----------
    def return_ok(request, url):
        if url.startswith("/") and not url.startswith("//"):
            return True  # our own /connected page
        return any(url.startswith(p) for p in settings.allowed_return_prefixes)

    @app.get("/connect", response_class=HTMLResponse)
    def connect_form(request: Request):
        qp = request.query_params
        back = qp.get("return", "/connected")
        if not return_ok(request, back):
            raise HTTPException(400, "Return URL not allowed")
        user = need_user(request)
        with conn() as c:
            groups = user_groups(c, user["id"])
        selected = int(qp["group_id"]) if qp.get("group_id", "").isdigit() else (groups[0]["id"] if groups else None)
        return page(request, "connect.html", user=user, groups=groups, selected=selected, back=back,
                    device_name=qp.get("device_name", "Water phone")[:40])

    @app.post("/connect")
    def connect_device(request: Request, group_id: int = Form(...), device_name: str = Form("Water phone"),
                       return_: str = Form("/connected", alias="return")):
        if not return_ok(request, return_):
            raise HTTPException(400, "Return URL not allowed")
        user = need_user(request)
        with conn() as c:
            if not member_role(c, group_id, user["id"]):
                raise HTTPException(403, "Not a member of this group")
            device_id, _ = demo.register_device(c, settings, user["id"], group_id, device_name)
            token = secrets.token_urlsafe(24)
            c.execute("INSERT INTO setup_tokens VALUES(?,?,?,0)", (token, device_id, time.time() + TOKEN_TTL))
        target = base(request) + return_ if return_.startswith("/") else return_
        sep = "&" if "?" in target else "?"
        return RedirectResponse(target + sep + urlencode({"token": token}), 303)

    @app.get("/connected", response_class=HTMLResponse)
    def connected(request: Request):
        return page(request, "connected.html", token=request.query_params.get("token", ""))

    @app.post("/v1/exchange")
    async def exchange(request: Request):
        token = (await request.json()).get("token", "")

        def work():
            with conn() as c:
                c.execute("BEGIN IMMEDIATE")
                row = c.execute("SELECT * FROM setup_tokens WHERE token=?", (token,)).fetchone()
                if not row or row["used"] or row["expires_at"] < time.time():
                    c.execute("ROLLBACK")
                    raise HTTPException(400, "Token invalid, used or expired")
                c.execute("UPDATE setup_tokens SET used=1 WHERE token=?", (token,))
                dev = c.execute("SELECT d.*, g.default_model FROM devices d JOIN groups g ON g.id=d.group_id "
                                "WHERE d.id=?", (row["device_id"],)).fetchone()
                c.execute("COMMIT")
            key = security.decrypt_at_rest(settings.master_key, dev["key_enc"])
            return dict(device_id=dev["id"], group_id=dev["group_id"], device_key=security.b64e(key),
                        models=models.public_list(), default_model=dev["default_model"])

        return await run_in_threadpool(work)

    @app.get("/v1/models")
    def list_models():
        return models.public_list()

    # ---------- gateway relay ----------
    def authenticate(c, request, body):
        try:
            dev_id = int(request.headers["X-Device-Id"])
            ts = request.headers["X-Timestamp"]
            sig = request.headers["X-Signature"]
            if abs(time.time() - float(ts)) > MAX_SKEW:
                raise ValueError
        except (KeyError, ValueError):
            raise HTTPException(401, "Missing or stale auth headers")
        dev = c.execute("SELECT * FROM devices WHERE id=?", (dev_id,)).fetchone()
        if not dev:
            raise HTTPException(401, "Unknown device")
        key = security.decrypt_at_rest(settings.master_key, dev["key_enc"])
        if not hmac.compare_digest(security.sign(key, ts, body), sig):
            raise HTTPException(401, "Bad signature")
        c.execute("UPDATE devices SET last_seen=? WHERE id=?", (time.time(), dev_id))
        return dev

    def answer_payload(row):
        return dict(request_id=row["request_id"], state="answered",
                    answer=security.b64e(row["answer_blob"]), meta=json.loads(row["answer_meta"] or "{}"))

    def handle_relay(request, body):
        with conn() as c:
            gw = authenticate(c, request, body)
            try:
                data = json.loads(body)
                request_id = str(uuid.UUID(data["request_id"]))
                asker = c.execute("SELECT * FROM devices WHERE id=?", (int(data["device_id"]),)).fetchone()
                sealed = security.b64d(data["sealed"])
            except (ValueError, KeyError, TypeError):
                raise HTTPException(400, "Malformed relay request")
            if not asker:
                raise HTTPException(404, "Unknown asker device")
            if settings.gateway_policy == "group" and gw["group_id"] != asker["group_id"]:
                raise HTTPException(403, "Gateway is not in the asker's group")

            now = time.time()
            c.execute("INSERT OR IGNORE INTO requests(request_id,device_id,group_id,ciphertext,status,created_at) "
                      "VALUES(?,?,?,?,?,?)", (request_id, asker["id"], asker["group_id"], sealed, "pending", now))
            row = c.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if row["device_id"] != asker["id"]:
                raise HTTPException(409, "Request ID belongs to another device")
            if row["status"] == "answered":
                return answer_payload(row)  # re-delivery: no second AI call
            # Atomic claim: only one UPDATE can match while the claim is live.
            cur = c.execute(
                "UPDATE requests SET claimed_by=?, claim_expires_at=?, status='claimed' "
                "WHERE request_id=? AND status IN('pending','claimed') "
                "AND (claimed_by IS NULL OR claim_expires_at < ?)",
                (gw["id"], now + settings.claim_ttl_seconds, request_id, now))
            if cur.rowcount == 0:
                row = c.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
                return dict(request_id=request_id, state="already_claimed",
                            by_you=row["claimed_by"] == gw["id"],
                            retry_after=max(0, round(row["claim_expires_at"] - now)))
            key = security.decrypt_at_rest(settings.master_key, asker["key_enc"])
            try:
                plain = security.unseal(key, request_id, asker["id"], sealed, b"Q")
                question, idx = plain[1:].decode("utf-8", "replace"), plain[0]
                result = pipeline.run(settings, c, kb, provider, asker["group_id"], question, idx, prism)
                result.meta["question"] = question
            except Exception:
                result = pipeline.Result("error", "Could not read that request.", {"error": "unseal"})
            result.meta.update(outcome=result.outcome, answer=result.text, provider=provider.name,
                               verified=False, gateway_device=gw["id"],
                               note="AI answer. Not verified." if result.outcome == "ok" else "")
            blob = security.seal(key, request_id, asker["id"], result.wire(), b"A")
            c.execute("UPDATE requests SET status='answered', answer_blob=?, answer_meta=?, answered_at=? "
                      "WHERE request_id=? AND answer_blob IS NULL",
                      (blob, json.dumps(result.meta), time.time(), request_id))
            row = c.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
            return answer_payload(row)

    @app.post("/v1/relay")
    async def relay(request: Request):
        body = await request.body()
        return await run_in_threadpool(handle_relay, request, body)

    @app.post("/v1/receipt")
    async def receipt(request: Request):
        body = await request.body()

        def work():
            with conn() as c:
                authenticate(c, request, body)
                rid = str(uuid.UUID(json.loads(body)["request_id"]))
                c.execute("UPDATE requests SET receipt_at=? WHERE request_id=? AND receipt_at IS NULL",
                          (time.time(), rid))
            return {"request_id": rid, "state": "receipt_recorded"}

        return await run_in_threadpool(work)

    @app.get("/trust", response_class=HTMLResponse)
    def trust(request: Request):
        user = need_user(request)
        with conn() as c:
            rows = c.execute(
                "SELECT r.request_id, r.status, r.answer_meta, r.receipt_at, r.created_at FROM requests r "
                "JOIN memberships m ON m.group_id=r.group_id WHERE m.user_id=? "
                "ORDER BY r.created_at DESC LIMIT 100", (user["id"],)).fetchall()
        items = []
        for r in rows:
            meta = json.loads(r["answer_meta"] or "{}")
            outcome = meta.get("outcome", "error" if r["status"] == "answered" else "pending")
            badge, label = OUTCOME_BADGE.get(outcome, ("", r["status"]))
            items.append(dict(
                id=r["request_id"][:8], when=ago(r["created_at"]), status=r["status"], receipt=bool(r["receipt_at"]),
                outcome=outcome, badge=badge, label=label, model=meta.get("model", ""),
                question=meta.get("question", ""), full=meta.get("answer", ""), sources=meta.get("sources", []),
                flagged=meta.get("guardrail", {}).get("flagged", False),
                kb_via={"prism": "PRISM knowledge base", "local-fallback": "local copy (PRISM unreachable)",
                        "local": "local field guide"}.get(meta.get("kb_via"), "n/a") if outcome != "general" else "no match · general knowledge",
                secrets=meta.get("secrets_flagged", False)))
        return page(request, "trust.html", user=user, items=items, prism_on=prism.enabled, active="trust")

    @app.exception_handler(HTTPException)
    async def http_exc(request, exc):
        if exc.status_code == 303:
            return RedirectResponse(exc.headers["Location"], 303)
        # API callers (phones, gateways) get JSON; people in a browser get a page.
        if "/v1/" in request.url.path or "text/html" not in request.headers.get("accept", ""):
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        titles = {400: "That request didn't look right", 403: "You don't have access to this",
                  404: "We couldn't find that"}
        response = page(request, "error.html", status=exc.status_code, detail=exc.detail,
                        title=titles.get(exc.status_code, "Something went wrong"))
        response.status_code = exc.status_code
        return response

    return app
