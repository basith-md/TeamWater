import httpx


class ProviderError(Exception):
    pass


class MockProvider:
    """Offline stand-in: echoes the grounded context so tests and demos need no keys."""

    name = "mock"

    def complete(self, model, system, user):
        context = user.split("Context:", 1)[-1].split("Question:", 1)[0].strip()
        return f"[mock:{model}] " + (context.splitlines()[0] if context else "No context.")


class NicrronProvider:
    name = "nicrron"

    def __init__(self, api_key, base_url, timeout=30):
        if not api_key:
            raise ProviderError("NICRRON_API_KEY is not set")
        self.api_key, self.base_url, self.timeout = api_key, base_url.rstrip("/"), timeout

    def complete(self, model, system, user):
        try:
            r = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "max_tokens": 160,
                    "temperature": 0,
                },
                timeout=self.timeout,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            raise ProviderError(f"Nicrron call failed: {type(exc).__name__}") from exc


def make_provider(settings):
    if settings.ai_provider == "nicrron":
        return NicrronProvider(settings.nicrron_api_key, settings.nicrron_base_url)
    return MockProvider()
