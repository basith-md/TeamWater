import base64
import hashlib
import hmac
import os
import uuid

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12


def hash_password(password):
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        salt_hex, digest_hex = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except ValueError:
        return False


def new_device_key():
    return os.urandom(32)


def _aad(request_id, device_id, purpose):
    return uuid.UUID(request_id).bytes + int(device_id).to_bytes(4, "big") + purpose


def seal(key, request_id, device_id, plaintext, purpose=b"Q"):
    """nonce(12) + ciphertext + tag(16). Binding the request ID stops replay under another ID."""
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, _aad(request_id, device_id, purpose))


def unseal(key, request_id, device_id, sealed, purpose=b"Q"):
    if len(sealed) < NONCE_BYTES + 16:
        raise ValueError("sealed message too short")
    return AESGCM(key).decrypt(sealed[:NONCE_BYTES], sealed[NONCE_BYTES:], _aad(request_id, device_id, purpose))


def encrypt_at_rest(master_key, data):
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(master_key).encrypt(nonce, data, b"device-key")


def decrypt_at_rest(master_key, blob):
    return AESGCM(master_key).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], b"device-key")


def sign(key, timestamp, body):
    return hmac.new(key, f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def b64e(data):
    return base64.b64encode(data).decode()


def b64d(text):
    return base64.b64decode(text.encode())
