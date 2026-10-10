"""Local media encoding and a self-describing, hash-checked transfer envelope."""

import hashlib
import io
import json
import shutil
import struct
import subprocess
import tempfile
import zlib
from dataclasses import dataclass
from pathlib import Path

MAX_UPLOAD = 10 * 1024 * 1024
MAX_ENCODED = 512 * 1024


@dataclass
class EncodedMedia:
    data: bytes
    metadata: dict


def encode_text(text):
    raw = text.encode("utf-8")
    if len(raw) > MAX_ENCODED:
        raise ValueError("Text exceeds 512 KiB")
    compressed = zlib.compress(raw, level=9)
    use_zlib = len(compressed) < len(raw)
    return EncodedMedia(
        compressed if use_zlib else raw,
        {
            "media_type": "text",
            "codec": "zlib-utf8" if use_zlib else "utf8",
            "mime": "text/plain; charset=utf-8",
            "original_bytes": len(raw),
        },
    )


def encode_image(raw):
    from PIL import Image, ImageOps, UnidentifiedImageError

    if len(raw) > MAX_UPLOAD:
        raise ValueError("Image exceeds 10 MiB")
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.width * source.height > 20_000_000:
                raise ValueError("Image exceeds 20 megapixels")
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((160, 160))
            for edge, quality in ((160, 20), (128, 15), (96, 10), (64, 5)):
                image.thumbnail((edge, edge))
                output = io.BytesIO()
                image.save(output, format="WEBP", quality=quality, method=6)
                if len(output.getvalue()) <= 4096:
                    break
            if len(output.getvalue()) > 4096:
                raise ValueError("Image exceeds 4 KiB thumbnail budget")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Invalid or unsupported image") from exc
    return EncodedMedia(
        output.getvalue(),
        {
            "media_type": "image",
            "codec": "webp",
            "mime": "image/webp",
            "original_bytes": len(raw),
            "width": image.width,
            "height": image.height,
            "byte_budget": 4096,
            "quality_label": "Lossy thumbnail; maximum 160px edge",
        },
    )


def encode_voice(raw):
    """Encode the first five seconds as mono 6 kbps Opus. Never truncate file bytes."""
    if not raw or len(raw) > MAX_UPLOAD:
        raise ValueError("Audio must be nonempty and at most 10 MiB")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("Voice encoding requires FFmpeg with libopus installed")
    with tempfile.TemporaryDirectory() as directory:
        source, output = Path(directory) / "input", Path(directory) / "voice.ogg"
        source.write_bytes(raw)
        try:
            subprocess.run(
                [
                    ffmpeg,
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-i",
                    str(source),
                    "-t",
                    "5",
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "6000",
                    "-vbr",
                    "on",
                    "-application",
                    "voip",
                    "-frame_duration",
                    "60",
                    str(output),
                ],
                check=True,
                capture_output=True,
                timeout=20,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise ValueError("Unable to encode audio with FFmpeg/libopus") from exc
        encoded = output.read_bytes()
        duration = float(_probe(output).get("format", {}).get("duration", 0))
        if duration <= 0 or len(encoded) > 8192:
            raise ValueError("Audio could not fit the 8 KiB voice budget")
    return EncodedMedia(
        encoded,
        {
            "media_type": "voice",
            "codec": "opus",
            "mime": "audio/ogg",
            "original_bytes": len(raw),
            "target_bitrate_bps": 6000,
            "clip_limit_seconds": 5,
            "clip_policy": "first 5 seconds maximum",
            "duration_seconds": duration,
            "byte_budget": 8192,
            "encoded_bitrate_bps": round(len(encoded) * 8 / duration),
            "quality_label": "Lossy mono Opus; first 5 seconds maximum",
        },
    )


def pack_media(media):
    if len(media.data) > MAX_ENCODED:
        raise ValueError("Encoded media exceeds 512 KiB")
    manifest = {
        **media.metadata,
        "encoded_bytes": len(media.data),
        "sha256": hashlib.sha256(media.data).hexdigest(),
        "version": 1,
    }
    header = json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode()
    if len(header) > 4096:
        raise ValueError("Manifest too large")
    return struct.pack("!H", len(header)) + header + media.data


def unpack_media(envelope):
    if len(envelope) < 2:
        raise ValueError("Missing manifest")
    size = struct.unpack("!H", envelope[:2])[0]
    if size > 4096 or len(envelope) < size + 2:
        raise ValueError("Invalid manifest length")
    try:
        metadata = json.loads(envelope[2 : 2 + size])
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Invalid manifest") from exc
    data = envelope[2 + size :]
    if (
        not isinstance(metadata, dict)
        or metadata.get("version") != 1
        or metadata.get("encoded_bytes") != len(data)
        or len(data) > MAX_ENCODED
        or metadata.get("sha256") != hashlib.sha256(data).hexdigest()
    ):
        raise ValueError("Media integrity check failed")
    return EncodedMedia(data, metadata)


def render_media(media):
    if media.metadata["codec"] in ("zlib-utf8", "zlib-json"):
        decoder = zlib.decompressobj()
        data = decoder.decompress(media.data, MAX_ENCODED + 1)
        if len(data) > MAX_ENCODED or not decoder.eof or decoder.unused_data:
            raise ValueError("Invalid or oversized compressed text")
        data.decode("utf-8")
        return data
    return media.data


def encode_ai_message(text, request_id, *, is_response=False, conversation_id=None):
    """Transport-only AI envelope; cloud invocation belongs to the gateway service.

    request_id correlates request/reply and is the gateway's idempotency key.
    Compress exact UTF-8 JSON; never summarize or alter the user's meaning.
    """
    import uuid

    uuid.UUID(request_id)
    body = {"request_id": request_id, "text": text}
    if conversation_id is not None:
        body["conversation_id"] = conversation_id
    encoded = encode_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")))
    encoded.metadata.update(
        media_type="ai_response" if is_response else "ai_request",
        mime="application/json",
        codec="zlib-json" if encoded.metadata["codec"] == "zlib-utf8" else "json",
    )
    return encoded


def _probe(path):
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise ValueError("Media encoding requires FFmpeg and ffprobe")
    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-show_entries",
                "format=duration:stream=codec_type,width,height,nb_frames,r_frame_rate",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            timeout=15,
        )
        return json.loads(result.stdout)
    except (subprocess.SubprocessError, ValueError) as exc:
        raise ValueError("Unable to inspect media") from exc


def encode_video(raw):
    """Playable sparse-frame summary, NOT full-fidelity or real-time video."""
    if not raw or len(raw) > MAX_UPLOAD:
        raise ValueError("Video must be nonempty and at most 10 MiB")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("Video encoding requires FFmpeg with libx264")
    budget = 12 * 1024
    with tempfile.TemporaryDirectory() as directory:
        source, output = Path(directory) / "input", Path(directory) / "summary.mp4"
        source.write_bytes(raw)
        original = _probe(source)
        for edge, quality in ((128, 38), (96, 44), (64, 48)):
            try:
                subprocess.run(
                    [
                        ffmpeg,
                        "-nostdin",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-protocol_whitelist",
                        "file,pipe",
                        "-i",
                        str(source),
                        "-t",
                        "5",
                        "-map",
                        "0:v:0",
                        "-vf",
                        f"fps=1,scale={edge}:{edge}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
                        "-an",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        str(quality),
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                        "-map_metadata",
                        "-1",
                        str(output),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=30,
                )
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                raise ValueError("Unable to encode video with FFmpeg/libx264") from exc
            encoded = output.read_bytes()
            if len(encoded) <= budget:
                break
        else:
            raise ValueError("Video could not fit the 12 KiB summary budget")
        result = _probe(output)
        stream = next(
            (s for s in result["streams"] if s["codec_type"] == "video"), None
        )
        if stream is None:
            raise ValueError("No video frames were encoded; use a longer clip")
        duration = float(result.get("format", {}).get("duration", 0))
        if duration <= 0:
            raise ValueError("No playable video frames were encoded")
    return EncodedMedia(
        encoded,
        {
            "media_type": "video",
            "codec": "h264-summary",
            "mime": "video/mp4",
            "original_bytes": len(raw),
            "width": stream["width"],
            "height": stream["height"],
            "duration_seconds": duration,
            "frames_per_second": 1,
            "frame_count": int(stream.get("nb_frames", 0)),
            "audio_included": False,
            "source_duration_seconds": float(
                original.get("format", {}).get("duration", 0)
            ),
            "clip_limit_seconds": 5,
            "byte_budget": budget,
            "quality_label": "Video summary: first 5 seconds, 1 frame/second, no audio",
        },
    )
