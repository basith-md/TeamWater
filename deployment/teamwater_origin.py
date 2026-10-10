"""Server-only origin guard; expose create_app through uvicorn --factory.

The authenticated edge proxy must replace X-TeamWater-Origin with its own
server-side token for both HTTP and WebSocket requests. Never ship that token
to the frontend or attach the tunnel to an unguarded backend port.
"""

import hmac
import os


class ProtectOrigin:
    def __init__(self, app, token: str):
        if not isinstance(token, str) or not token.strip():
            raise ValueError("Origin token must be nonempty.")
        self._app = app
        self._token = token.encode("utf-8")

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind in ("http", "websocket"):
            values = [value for name, value in scope.get("headers", ()) if name.lower() == b"x-teamwater-origin"]
            authorized = len(values) == 1 and hmac.compare_digest(values[0], self._token)
            if not authorized:
                if kind == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    body = b'{"detail":"Forbidden"}'
                    await send({
                        "type": "http.response.start",
                        "status": 403,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode("ascii")),
                        ],
                    })
                    await send({"type": "http.response.body", "body": body})
                return
        await self._app(scope, receive, send)


def create_app():
    """Load the teammate backend only after validating server configuration."""
    token = os.environ.get("TEAMWATER_ORIGIN_TOKEN", "")
    if not token.strip():
        raise RuntimeError("TEAMWATER_ORIGIN_TOKEN must be configured before startup.")
    from service.service import app

    return ProtectOrigin(app, token)
