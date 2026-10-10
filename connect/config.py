"""Settings from environment / connect/.env. Secrets never leave the server."""

import base64
import os
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_env_file(path):
    values = {}
    if Path(path).exists():
        for line in Path(path).read_text().splitlines():
            line = line.split("#", 1)[0].strip()
            if "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip()
    return values


@dataclass
class Settings:
    session_secret: str = "dev-session-secret-change-me"
    master_key: bytes = b"\x00" * 32
    nicrron_api_key: str = ""
    nicrron_base_url: str = "https://api.nicrron.ai/v1"
    prism_api_key: str = ""
    prism_project: str = "TeamWater"
    prism_host: str = "https://prism.blockconvey.com"
    prism_project_id: str = ""
    prism_evaluate: bool = False  # each evaluator run costs PRISM credits
    demo_account: bool = False  # shared TeamWater account with every simulated node connected
    ai_provider: str = "mock"
    gateway_policy: str = "group"
    claim_ttl_seconds: int = 120
    group_daily_budget: int = 50
    db_path: str = str(HERE / "water_connect.db")
    kb_dir: str = str(HERE / "kb")
    require_grounding: bool = True
    allowed_return_prefixes: tuple = ("water://", "http://localhost", "http://127.0.0.1")

    @classmethod
    def from_env(cls):
        env = {**load_env_file(HERE / ".env"), **os.environ}
        s = cls()
        s.session_secret = env.get("WATER_SESSION_SECRET") or s.session_secret
        if env.get("WATER_MASTER_KEY"):
            s.master_key = base64.urlsafe_b64decode(env["WATER_MASTER_KEY"])
        s.nicrron_api_key = env.get("NICRRON_API_KEY", "")
        s.nicrron_base_url = env.get("NICRRON_BASE_URL") or s.nicrron_base_url
        s.prism_api_key = env.get("PRISM_API_KEY", "")
        s.prism_project = env.get("PRISM_PROJECT") or s.prism_project
        s.prism_host = env.get("PRISM_HOST") or s.prism_host
        s.prism_project_id = env.get("PRISM_PROJECT_ID", "")
        s.prism_evaluate = env.get("PRISM_EVALUATE", "0") == "1"
        s.demo_account = env.get("WATER_DEMO", "1") == "1"
        # 1 = field-guide answers only ("I don't know" otherwise); 0 = fall back to the model's own knowledge.
        s.require_grounding = env.get("REQUIRE_GROUNDING", "0") == "1"
        s.ai_provider = env.get("AI_PROVIDER", s.ai_provider)
        s.gateway_policy = env.get("GATEWAY_POLICY", s.gateway_policy)
        s.claim_ttl_seconds = int(env.get("CLAIM_TTL_SECONDS", s.claim_ttl_seconds))
        s.group_daily_budget = int(env.get("GROUP_DAILY_BUDGET", s.group_daily_budget))
        if env.get("WATER_DB_PATH"):
            s.db_path = env["WATER_DB_PATH"]
        if env.get("ALLOWED_RETURN_SCHEMES"):
            s.allowed_return_prefixes = tuple(
                p if "://" in p else p + "://" for p in env["ALLOWED_RETURN_SCHEMES"].split(",")
            )
        return s
