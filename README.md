# Family KBC — two-screen family quiz

A KBC-inspired family quiz web app. The TV/laptop displays the quiz while a mobile browser acts as the remote. Mobile remote controls the question flow.

## Stack
- React + Vite (client)
- Node.js + Express + Socket.IO (real-time game server)
- In-memory room state and question bank (MVP)

## Requirements
- Node.js 18+ (Node 20 LTS recommended)
- npm

## Run locally

From the project root:

```bash
npm install
npm --prefix server install
npm --prefix client install
npm run dev
```

Open the TV screen on your laptop/TV browser:

- `http://localhost:5173/tv`

Open the remote on your phone:

- On same Wi-Fi, use your laptop's LAN IPv4 address, e.g. `http://192.168.1.10:5173/remote`
- Enter the six-digit room code displayed on the TV.

The remote's default Socket.IO address is derived from the hostname with port `3001`. If client/server are deployed separately, create `client/.env` from the example below and rebuild:

```env
VITE_SERVER_URL=https://your-server.example.com
```

## Gameplay
1. TV opens `/tv` and creates a room.
2. Remote opens `/remote` and joins with the displayed six-digit code.
3. Mobile remote starts game, chooses an option, locks it, reveals the answer, and advances.
4. 30-second question timer; 15 sample family-friendly questions.
5. Lifelines: 50:50, audience poll, expert suggestion.

## Folder layout

```text
family-kbc/
├── package.json
├── README.md
├── server/
│   ├── package.json
│   └── src/
│       ├── index.js       # Socket.IO rooms, events, timer, state
│       └── questions.js   # Question bank + prize ladder
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx        # Home, TV screen, mobile remote
        └── styles.css
```

## Network notes
- For phone-to-laptop testing, both devices need to be on the same Wi-Fi/LAN.
- Allow Node.js through your laptop firewall for private networks if prompted.
- For access across different networks, deploy the server and client to public hosting and use HTTPS/WSS.
- The current MVP keeps room/game data in server memory. Restarting the server clears rooms.

## Next improvements
- Admin editor for custom question sets
- QR code to join room
- Host/remote reconnect handling and room expiry
- Optional sound design and full-screen mode
- Persistent rooms / player profiles
