"""One shared TeamWater account for the demo, with every simulated node's phone already
connected. Enabled by WATER_DEMO=1 (default for now); turn it off for real deployments."""

import os
import time

from . import db, security

DEMO_NODES = [f"node{i}" for i in range(6)]
CREDENTIALS = dict(email="team@water.demo", password=os.environ.get("WATER_DEMO_PASSWORD", "teamwater"),
                   group="TeamWater")


def register_device(c, settings, user_id, group_id, name):
    key = security.new_device_key()
    cur = c.execute("INSERT INTO devices(user_id,group_id,name,key_enc,created_at) VALUES(?,?,?,?,?)",
                    (user_id, group_id, name[:40], security.encrypt_at_rest(settings.master_key, key), time.time()))
    return cur.lastrowid, key


def seed(settings, nodes=DEMO_NODES):
    """Idempotent. Returns {user_id, group_id, devices: {node_id: (device_id, key)}}."""
    with db.connect(settings.db_path) as c:
        c.execute("BEGIN IMMEDIATE")
        user = c.execute("SELECT id FROM users WHERE email=?", (CREDENTIALS["email"],)).fetchone()
        if user:
            uid = user["id"]
        else:
            uid = c.execute("INSERT INTO users(email,password_hash,created_at) VALUES(?,?,?)",
                            (CREDENTIALS["email"], security.hash_password(CREDENTIALS["password"]), time.time())).lastrowid
        group = c.execute("SELECT id FROM groups WHERE owner_id=? AND name=?", (uid, CREDENTIALS["group"])).fetchone()
        if group:
            gid = group["id"]
        else:
            gid = c.execute("INSERT INTO groups(name,owner_id,created_at) VALUES(?,?,?)",
                            (CREDENTIALS["group"], uid, time.time())).lastrowid
            c.execute("INSERT INTO memberships VALUES(?,?,?)", (gid, uid, "owner"))
        devices = {}
        for node in nodes:
            row = c.execute("SELECT d.id, d.key_enc FROM demo_nodes n JOIN devices d ON d.id=n.device_id "
                            "WHERE n.node_id=?", (node,)).fetchone()
            if row:
                devices[node] = (row["id"], security.decrypt_at_rest(settings.master_key, row["key_enc"]))
            else:
                did, key = register_device(c, settings, uid, gid, f"{node} phone")
                c.execute("INSERT INTO demo_nodes VALUES(?,?)", (node, did))
                devices[node] = (did, key)
        c.execute("COMMIT")
    return dict(user_id=uid, group_id=gid, devices=devices)
