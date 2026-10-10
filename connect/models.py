"""Hardcoded Nicrron chat-model catalog (snapshot of https://nicrron.ai/docs/models).

Phones send a 1-byte index into MODELS, never a model name, so the server stays in
control of what it will pay for. The order is a wire contract: append only.
Prices are USD per million tokens (input, output); context is in thousands of tokens.
"""

PRIVACY = {
    "A": ("ok", "Not trained on by default; retained for abuse monitoring"),
    "D": ("avoid", "Treated as trained on and retained; processed in China"),
    "K": ("avoid", "Content may be used for model improvement"),
    "M": ("ok", "Nicrron opted out of training"),
    "X": ("unknown", "No published training or retention statement"),
    "Z": ("unknown", "No published privacy information"),
}

# (id, input $/M, output $/M, context k, privacy code)
_ROWS = [
    ("mistral/ministral-8b", 0.15, 0.15, 262, "M"),  # index 0 = default
    ("mistral/ministral-3b", 0.10, 0.10, 131, "M"),
    ("mistral/ministral-14b", 0.20, 0.20, 262, "M"),
    ("mistral/mistral-small-4", 0.15, 0.60, 262, "M"),
    ("mistral/mistral-large-3", 0.50, 1.50, 262, "M"),
    ("mistral/mistral-medium-3.5", 1.50, 7.50, 262, "M"),
    ("mistral/codestral", 0.30, 0.90, 256, "M"),
    ("mistral/glm-5.2", 1.40, 4.40, 1049, "M"),
    ("anthropic/claude-fable-5-1", 10.00, 50.00, 1000, "A"),
    ("anthropic/claude-fable-5", 10.00, 50.00, 1000, "A"),
    ("anthropic/claude-sonnet-5", 2.00, 10.00, 1000, "A"),
    ("anthropic/claude-opus-5", 5.00, 25.00, 1000, "A"),
    ("anthropic/claude-haiku-4-5", 1.00, 5.00, 200, "A"),
    ("anthropic/claude-opus-4-8", 5.00, 25.00, 1000, "A"),
    ("anthropic/claude-opus-4-7", 5.00, 25.00, 1000, "A"),
    ("anthropic/claude-opus-4-6", 5.00, 25.00, 1000, "A"),
    ("anthropic/claude-sonnet-4-6", 3.00, 15.00, 1000, "A"),
    ("anthropic/claude-opus-4-5", 5.00, 25.00, 200, "A"),
    ("anthropic/claude-sonnet-4-5", 3.00, 15.00, 200, "A"),
    ("openai/gpt-5.6-sol", 5.00, 30.00, 272, "A"),
    ("openai/gpt-5.6-terra", 2.00, 12.00, 272, "A"),
    ("openai/gpt-5.6-luna", 0.20, 1.20, 272, "A"),
    ("openai/gpt-5.5", 5.00, 30.00, 272, "A"),
    ("openai/gpt-5.4", 2.50, 15.00, 272, "A"),
    ("openai/gpt-5.4-mini", 0.75, 4.50, 400, "A"),
    ("openai/gpt-5.4-nano", 0.20, 1.25, 400, "A"),
    ("openai/gpt-5.2", 1.75, 14.00, 400, "A"),
    ("openai/gpt-5.1", 1.25, 10.00, 400, "A"),
    ("openai/gpt-5", 1.25, 10.00, 400, "A"),
    ("openai/gpt-5-mini", 0.25, 2.00, 400, "A"),
    ("openai/gpt-5-nano", 0.05, 0.40, 400, "A"),
    ("openai/gpt-4.1", 2.00, 8.00, 1048, "A"),
    ("openai/gpt-4.1-mini", 0.40, 1.60, 1048, "A"),
    ("openai/gpt-4.1-nano", 0.10, 0.40, 1048, "A"),
    ("openai/gpt-4o", 2.50, 10.00, 128, "A"),
    ("openai/gpt-4o-mini", 0.15, 0.60, 128, "A"),
    ("openai/o1", 15.00, 60.00, 200, "A"),
    ("openai/o3-mini", 1.10, 4.40, 200, "A"),
    ("openai/o3", 2.00, 8.00, 200, "A"),
    ("openai/o4-mini", 1.10, 4.40, 200, "A"),
    ("deepseek/deepseek-v4-flash", 0.44, 1.32, 1000, "D"),
    ("deepseek/deepseek-v4-pro", 1.32, 3.96, 1000, "D"),
    ("moonshot/kimi-k3", 3.00, 15.00, 1049, "K"),
    ("moonshot/kimi-k2.7-code", 0.95, 4.00, 262, "K"),
    ("moonshot/kimi-k2.7-code-highspeed", 1.90, 8.00, 262, "K"),
    ("moonshot/kimi-k2.6", 0.95, 4.00, 262, "K"),
    ("xai/grok-4.6", 2.00, 6.00, 200, "X"),
    ("xai/grok-4.5", 2.00, 6.00, 200, "X"),
    ("xai/grok-4.3", 1.25, 2.50, 200, "X"),
    ("xai/grok-4.20", 1.25, 2.50, 200, "X"),
    ("xai/grok-4.20-non-reasoning", 1.25, 2.50, 200, "X"),
    ("xai/grok-code-fast-1", 1.00, 2.00, 200, "X"),
    ("z-ai/glm-5.3", 1.40, 4.40, 1049, "Z"),
    ("z-ai/glm-5.3-flash", 0.15, 0.50, 1049, "Z"),
    ("z-ai/glm-5.2", 1.40, 4.40, 1049, "Z"),
    ("z-ai/glm-5.1", 1.40, 4.40, 205, "Z"),
    ("z-ai/glm-5-turbo", 1.20, 4.00, 203, "Z"),
    ("z-ai/glm-5", 1.00, 3.20, 205, "Z"),
    ("z-ai/glm-4.7", 0.60, 2.20, 205, "Z"),
    ("z-ai/glm-4.6", 0.60, 2.20, 205, "Z"),
    ("z-ai/glm-4.5", 0.60, 2.20, 131, "Z"),
    ("z-ai/glm-4.5-air", 0.20, 1.10, 131, "Z"),
]


def _tier(output_price):
    return "$" if output_price < 1 else "$$" if output_price < 5 else "$$$" if output_price < 15 else "$$$$"


def _entry(row):
    model_id, price_in, price_out, context_k, code = row
    provider, name = model_id.split("/", 1)
    level, note = PRIVACY[code]
    return dict(id=model_id, provider=provider, label=name, price_in=price_in, price_out=price_out,
                context_k=context_k, tier=_tier(price_out), privacy=note, privacy_level=level)


MODELS = [_entry(r) for r in _ROWS]
DEFAULT_INDEX = 0


def public_list():
    return [dict(index=i, **m) for i, m in enumerate(MODELS)]


def resolve(index):
    """Unknown or out-of-range indexes fall back to the default model."""
    return MODELS[index] if 0 <= index < len(MODELS) else MODELS[DEFAULT_INDEX]
