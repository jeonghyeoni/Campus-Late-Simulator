# Campus Late Simulator

Campus Late Simulator is a Vite + Vanilla JS first-person campus running simulator.
The browser plays the video and RNBO audio patch, while an optional public VPS bridge receives TDInput UDP/OSC sensor data and forwards it to the correct browser room over WebSocket.

## Architecture

```text
TDInput app
  -> public VPS UDP port 8001-8050
  -> Node.js bridge server
  -> WebSocket TCP 8080
  -> Cloudflare Pages web app
  -> runIntensity / heartRate
  -> RNBO parameters
```

The browser cannot receive UDP directly, so the Node bridge owns UDP. Each TDInput session gets one room and one UDP port. UDP packets are forwarded only to that room's WebSocket client, never broadcast to every browser.

## Local Development

Install dependencies:

```sh
npm install
```

Run the web app:

```sh
npm run dev
```

Run the bridge server in a second terminal:

```sh
npm run bridge
```

Local defaults:

- WebSocket bridge: `ws://127.0.0.1:8080`
- UDP ports: `8001-8050`
- Health check: `http://127.0.0.1:8080/health`

Open the app, choose `Smartphone (TDInput)` or `Apple Watch (TDInput)`, then use the displayed Room ID, Server IP / Hostname, and UDP Port. For local testing on the same machine, the server host is usually `127.0.0.1`. For a phone or watch on the same LAN, use the computer's LAN IP instead.

## Bridge Configuration

Server environment variables:

```sh
BRIDGE_BIND_HOST=0.0.0.0
BRIDGE_WS_PORT=8080
BRIDGE_UDP_HOST=0.0.0.0
BRIDGE_UDP_PORT_START=8001
BRIDGE_UDP_PORT_END=8050
BRIDGE_PUBLIC_HOST=your.vps.ip.or.hostname
BRIDGE_ALLOWED_ORIGINS=https://your-pages-site.pages.dev,https://your-domain.com
```

Frontend environment variable:

```sh
VITE_BRIDGE_WS_URL=ws://your.vps.ip.or.hostname:8080
```

For HTTPS frontends such as Cloudflare Pages, use WSS. The app defaults to the local bridge on localhost and to the production WSS bridge on deployed hosts:

```sh
VITE_BRIDGE_WS_URL=wss://168.110.110.59.sslip.io
```

When using your own TLS reverse proxy or domain, change only the frontend value:

```sh
VITE_BRIDGE_WS_URL=wss://bridge.example.com
```

On Cloudflare Pages, set `VITE_BRIDGE_WS_URL` in the Pages project environment variables and redeploy.

## Oracle Cloud / Ubuntu VPS Deployment

Install Node.js LTS:

```sh
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

Clone and install:

```sh
git clone <your-repo-url>
cd <your-repo-directory>
npm install
```

Run once:

```sh
BRIDGE_PUBLIC_HOST=<PUBLIC_VPS_IP_OR_HOSTNAME> npm run bridge
```

Keep it running with pm2:

```sh
sudo npm install -g pm2
BRIDGE_PUBLIC_HOST=<PUBLIC_VPS_IP_OR_HOSTNAME> pm2 start server/bridge.js --name campus-late-bridge
pm2 save
pm2 startup
```

If you want explicit port/origin settings with pm2:

```sh
BRIDGE_PUBLIC_HOST=<PUBLIC_VPS_IP_OR_HOSTNAME> \
BRIDGE_ALLOWED_ORIGINS=https://your-pages-site.pages.dev,https://your-domain.com \
pm2 start server/bridge.js --name campus-late-bridge
```

For production, the more reliable pattern is an ecosystem file or shell environment that exports:

```sh
export BRIDGE_PUBLIC_HOST=<PUBLIC_VPS_IP_OR_HOSTNAME>
export BRIDGE_ALLOWED_ORIGINS=https://your-pages-site.pages.dev,https://your-domain.com
pm2 restart campus-late-bridge --update-env
```

Open firewall ports in both Ubuntu and the cloud console security list:

- TCP `8080`
- UDP `8001-8050`

Ubuntu `ufw` example:

```sh
sudo ufw allow 8080/tcp
sudo ufw allow 8001:8050/udp
sudo ufw reload
```

Oracle Cloud also requires matching ingress rules in the VCN security list or network security group.

## TDInput Setup

1. Open the deployed web app.
2. Select `Smartphone (TDInput)` or `Apple Watch (TDInput)`.
3. Wait for the connection panel to show:
   - Room ID
   - Server IP / Hostname
   - UDP Port
4. Open TDInput.
5. Enter the displayed Server IP / Hostname and UDP Port.
6. Start streaming sensor data.

The bridge logs raw UDP packet text/hex and parsed OSC values. Expected TDInput OSC channels include `/phone/accel/x`, `/phone/accel/y`, `/phone/accel/z`, `/watch/accel/x`, `/watch/accel/y`, `/watch/accel/z`, and `/watch/heart/bpm`.

## Multi-user Test

1. Open the web app in two browsers or devices.
2. Select a TDInput mode in each browser.
3. Confirm each browser receives a different UDP Port.
4. Configure phone A to browser A's UDP Port, and phone B to browser B's UDP Port.
5. Move phone A and confirm only browser A changes run intensity.
6. Move phone B and confirm only browser B changes run intensity.

If a browser disconnects, its room is kept briefly for reconnect. After the grace period or idle timeout, the bridge cleans the room and releases the UDP port.
