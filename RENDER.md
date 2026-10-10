# Render Deployment

## Quick Deploy (recommended)

1. Go to https://dashboard.render.com
2. Click **New +** → **Web Service**
3. Connect the GitHub repo: `shravanthi-m/TeamWater` (or your fork)
4. Settings:
   - **Root Directory**: leave blank (or `.`)
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn service.service:app --host 0.0.0.0 --port $PORT`
5. Click **Create Web Service**

Render will give you a URL like `https://chrp-mesh-backend.onrender.com`.

## Test endpoints

Once live:

```bash
# Health / nodes
curl https://YOUR-SERVICE.onrender.com/nodes

# Full state
curl https://YOUR-SERVICE.onrender.com/state

# Send a text message
curl -X POST https://YOUR-SERVICE.onrender.com/send/text \
  -F "src=node0" \
  -F "dst=node4" \
  -F "text=Hello from Render"
```

## Notes
- Free tier spins down after inactivity (first request may be slow).
- WebSocket endpoint is at `wss://YOUR-SERVICE.onrender.com/ws`.
- The mesh simulation runs in-process; state is not persisted across restarts.
