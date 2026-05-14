# Chess2

Online-Schach für mehrere Mobilgeräte, live über WebSockets. Node.js + Socket.IO + MySQL,
responsives Vanilla-Frontend, eigener Regel-Engine ohne externe Bibliotheken.

## Features

- 1v1 Partien über privaten Raumcode oder öffentliche Lobby
- **QR-Code zum Beitreten**: Im Warteraum wird ein QR-Code mit dem Beitritts-Link
  angezeigt - Gegner scannt mit dem Handy und ist sofort drin
- Live-Übertragung aller Züge per Socket.IO
- Anonymes Spielen mit Nickname **oder** Account mit Elo-Rating (MySQL)
- Zeitkontrollen Bullet/Blitz/Rapid/Eigene (Initial + Inkrement)
- Schachmatt, Patt, Remis-Angebot, Aufgabe, 50-Züge-Regel, Stellungswiederholung,
  unzureichendes Material - alles korrekt erkannt, PGN-Export
- Bauernumwandlung, Rochade, en passant
- Zuschauer-Modus (wer beitritt, wenn beide Plätze belegt sind)
- Chat im Spiel mit `/draw` und `/resign` Shortcuts
- Reconnect: wer die Seite neu lädt, kommt automatisch in seinen Sitz zurück
- Revanche mit getauschten Farben
- Mobile-first, responsives Brett (CSS Grid, Unicode-Figuren, keine Asset-Pipeline)
- Bestenliste der bewerteten Spieler

## Schnellstart lokal

```bash
cp .env.example .env
# .env editieren (DB-Zugangsdaten, JWT_SECRET)

npm install
npm run migrate    # legt Tabellen in MySQL an (optional: ohne DB läuft die App auch, nur ohne Accounts/Rating)
npm start
```

Im Browser: <http://localhost:3000>

## Deployment auf Plesk

1. **Repository hochladen.** Per Git oder per Plesk-Dateimanager nach
   `httpdocs/` (oder einem Unterordner) hochladen.
2. **MySQL einrichten.** In Plesk unter *Datenbanken* eine neue MySQL-Datenbank +
   Benutzer anlegen. Die Zugangsdaten in `.env` eintragen.
3. **`.env` anlegen.** Auf dem Server `.env.example` zu `.env` kopieren und
   anpassen. Wichtig: `JWT_SECRET` mit einem langen Zufallswert füllen
   (`openssl rand -hex 48`).
4. **Node.js-App aktivieren.** In Plesk auf der Domain den Reiter
   *Node.js* öffnen und:
   - **Application Root:** Verzeichnis, in dem `package.json` liegt.
   - **Application Startup File:** `server/index.js`
   - **Application Mode:** `production`
   - **Node.js Version:** 18 oder neuer
   - **Custom environment variables:** alternativ statt `.env` direkt setzen
     (`PORT`, `JWT_SECRET`, `DB_*`).
5. **`NPM install` ausführen** (Plesk-Button auf der Node.js-Seite).
6. **App starten/neustarten.** Plesk-Button *Restart app*. Die App lauscht auf
   dem von Plesk vorgegebenen Port; das Passenger-Frontend leitet die
   Domain darauf weiter. **Die Schema-Migration läuft automatisch beim Start**
   (idempotent, `CREATE TABLE IF NOT EXISTS`) - du musst nichts manuell
   anstoßen. `npm run migrate` existiert nur noch als optionaler manueller
   Trigger für CI/Debug.
7. **HTTPS aktivieren** (Plesk - Let's Encrypt). Socket.IO nutzt automatisch
   `wss://`, sobald die Seite über `https://` aufgerufen wird.

### Wichtige Plesk-Hinweise

- Plesk leitet eingehende Requests via Passenger an die Node-App weiter. Die App
  liest `process.env.PORT` und lauscht darauf - das ist bereits umgesetzt.
- **WebSocket-Unterstützung:** in den Plesk-Apache/nginx-Einstellungen der Domain
  sicherstellen, dass *WebSocket-Verbindungen erlaubt* sind (in den meisten
  modernen Plesk-Versionen Standard).
- Wenn die App hinter einem Reverse-Proxy mit speziellem Origin läuft, dann
  `PUBLIC_ORIGIN=https://deine-domain.de` in `.env` setzen (kommagetrennt für
  mehrere).
- Backup: die `games`-Tabelle wächst je Partie um eine Zeile (mit PGN).
  Bei Bedarf in Plesk per Cronjob alte Spiele archivieren.

## Architektur

```
server/
  index.js     Express + Socket.IO Bootstrap
  socket.js    Socket-Event-Handler (Räume, Züge, Chat, Uhr)
  rooms.js     In-Memory Raumverwaltung + öffentliche Lobby
  auth.js      REST /api/auth/{register,login,me,leaderboard}
  rating.js    Elo
  db.js        MySQL Pool
  schema.sql   Tabellen
  migrate.js   schema.sql ausführen
shared/
  chess-engine.js  Vollständiger Regel-Engine (Server + Browser)
public/
  index.html   Lobby
  game.html    Partie
  css/         Responsives Styling (CSS Grid)
  js/          Frontend-Logik (Vanilla)
```

## Endpunkte / Events

REST:

- `POST /api/auth/register` `{username, password}` -> `{token, user}`
- `POST /api/auth/login` `{username, password}` -> `{token, user}`
- `GET  /api/auth/me` -> `{user}`
- `GET  /api/auth/leaderboard` -> `{entries: [...]}`
- `GET  /api/health` -> `{ok, db}`
- `GET  /api/qr?text=<url>` -> SVG QR-Code (für Raum-Beitritts-Links)

Socket.IO (Client -> Server):

- `auth {token}`
- `lobby:list`
- `room:create {name, visibility, timeControl, rated, seat}`
- `room:join {code, name, seatToken?, spectate?}`
- `room:leave`
- `game:move {from, to, promotion?}`
- `game:resign`, `game:draw_offer`, `game:draw_accept`, `game:draw_decline`
- `game:rematch_offer`
- `chat:send {text}`

Socket.IO (Server -> Client):

- `room:state` (komplette Raum-Sicht inklusive FEN, Uhr, Spieler)
- `game:move` (einzelner Zug + neue FEN + Uhr)
- `clock:tick` (sekündliche Uhr-Aktualisierung)
- `game:end {result, termination, pgn}`
- `game:restart` (Revanche)
- `chat:message`
- `lobby:list`
- `app:error`

## Lizenz

MIT - nutze es wie du willst.
