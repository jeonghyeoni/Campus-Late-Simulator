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

The browser cannot receive UDP directly, so the Node bridge owns UDP for TDInput. Each TDInput session gets one room and one UDP port. Smartphone Motion uses the same room system without UDP: the phone browser joins the room over WSS and sends DeviceMotion samples only to that room's PC browser. Sensor packets are never broadcast to every browser.

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

Open the app and choose one input mode:

- `Keyboard (Spacebar)` uses the keyboard.
- `Smartphone (TDInput)` and `Apple Watch (TDInput)` show the TDInput room, host, and UDP port.
- `Smartphone Motion` shows a QR code for the browser controller.

For local Smartphone Motion testing from a real phone, set `VITE_CONTROLLER_BASE_URL` to a URL the phone can reach, such as your LAN IP or a tunnel URL.

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
VITE_CONTROLLER_BASE_URL=https://your-pages-site.pages.dev
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

## Smartphone Motion Setup

Smartphone Motion does not need TDInput or any app install.

1. Open the deployed web app on the PC.
2. Select `Smartphone Motion`.
3. Scan the QR code with the phone.
4. On the controller page, tap `Enable Motion`.
5. Allow motion sensor access if the browser asks.
6. Move the phone to run.

The QR URL uses this shape:

```text
https://<frontend-domain>/controller?room=4821
```

iPhone notes:

- Use Safari or another browser that supports DeviceMotion.
- Motion permission must be granted from the `Enable Motion` tap.
- If the browser never asks, check iOS Settings for Motion & Orientation Access.

Android notes:

- Chrome usually starts DeviceMotion after the `Enable Motion` tap.
- Keep the controller tab visible. The page requests Screen Wake Lock when available, but some browsers still throttle background tabs.

The controller debug panel shows magnitude, local smoothed intensity, and WebSocket latency. The PC browser performs the final run intensity smoothing before updating heart rate and RNBO parameters.

## Multi-user Test

1. Open the web app in two browsers or devices.
2. Select a TDInput mode or `Smartphone Motion` in each browser.
3. For TDInput, confirm each browser receives a different UDP Port.
4. For Smartphone Motion, scan each browser's QR code with a different phone.
5. Move phone A and confirm only browser A changes run intensity.
6. Move phone B and confirm only browser B changes run intensity.

If a browser disconnects, its room is kept briefly for reconnect. After the grace period or idle timeout, the bridge cleans the room and releases the UDP port.
