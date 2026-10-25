# Werkstattlager

Digitales Lager für Kleinteile und Filament – gebaut für Konstruktion und 3D-Druck.
Jedes Teil kennt seine Normmaße und pro Maß die **3D-Druck-Passungen** (Presssitz, Snap-Fit, lose).
Über die **MCP-Schnittstelle** können Claude und andere KI-Systeme beim Konstruieren direkt nachsehen,
was vorrätig ist und welche Maße ins CAD gehören.

- Organizer-Ansicht im Look der echten Boxen: Mini-Systainer (15 gedruckte Behälter), Tanos-Organizer (22 Boxen) oder freies Raster
- 3D-Vorschau jedes Teils, erzeugt aus den Normmaßen
- Normkatalog: DIN 912, ISO 7380, DIN 7991, DIN 934, DIN 985, DIN 125, Kugellager, Einschmelzmuttern, Magnete, eigene Teile
- Passungstabelle pro Teil, Messwerte direkt in der Tabelle eintragen
- Bezugsquellen pro Teil: Link zur Produktseite einfügen, Titel, Preis und Bild werden automatisch gelesen – so bleibt nachvollziehbar, wo ein Teil gekauft wurde
- Foto-Erfassung: Fotos landen im Eingang und werden von Claude (per MCP) oder optional von einem lokalen Vision-Modell ausgewertet
- Filamentregal mit Restmengen und AMS-Slots
- QR-Etiketten pro Organizer (62 × 29 mm), die direkt die passende Ansicht öffnen
- Läuft als ein Docker-Container mit SQLite, Daten liegen in `./data`

## Starten

```bash
git clone https://github.com/Bman-99/werkstattlager.git
cd werkstattlager
# PUBLIC_URL in compose.yaml anpassen (Adresse für die QR-Etiketten)
docker compose up -d
```

Danach ist die Oberfläche unter `http://<heimserver>:8420` erreichbar.
Zum Ausprobieren mit Beispieldaten `SEED_DEMO: "1"` setzen (wirkt nur, solange noch keine Teile existieren).

**Dockge:** neuen Stack anlegen und den Inhalt von `compose.yaml` einfügen. Das Image
`ghcr.io/bman-99/werkstattlager:latest` wird bei jedem Push auf `main` von GitHub Actions für `amd64` und `arm64` gebaut.

| Variable | Bedeutung |
|---|---|
| `PORT` | Port im Container (Standard `8420`) |
| `PUBLIC_URL` | Basis-URL für die QR-Codes, z. B. `http://heimserver:8420` |
| `MCP_TOKEN` | optional: verlangt `Authorization: Bearer <Token>` an `/mcp` |
| `VISION_URL` | optional: OpenAI-kompatibler Endpunkt für die Foto-Erkennung, z. B. `http://ollama:11434/v1` |
| `VISION_MODEL` | Modell dafür, Standard `qwen2.5vl:7b` |
| `VISION_API_KEY` | optional, falls der Endpunkt einen Schlüssel braucht |
| `SEED_DEMO` | `1` = Beispieldaten anlegen |

Healthcheck: `GET /healthz`. Backup: den Ordner `./data` sichern (SQLite-Datenbank und Fotos).

## MCP-Schnittstelle

Endpunkt: `http://<heimserver>:8420/mcp` (Streamable HTTP).

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "werkstattlager": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://heimserver:8420/mcp", "--allow-http"]
    }
  }
}
```

Mit `MCP_TOKEN` zusätzlich `"--header", "Authorization: Bearer <Token>"` anhängen.

**Claude Code:** `claude mcp add --transport http werkstattlager http://heimserver:8420/mcp`

| Tool | Zweck |
|---|---|
| `search_parts` | Suche nach Text, Typ, Gewinde, Länge, Bestand |
| `get_part` | Alle Maße, Passungen, Ort und letzte Buchungen eines Teils |
| `get_fit` | CAD-Werte für eine Passung (press / snap / loose) |
| `check_parts` | Stückliste gegen den Bestand prüfen |
| `list_catalog` | Teiletypen und Normgrößen |
| `add_part` / `update_part` | Teil anlegen (mit automatischer Fachwahl) bzw. ändern, optional mit Links |
| `add_part_link` / `remove_part_link` | Bezugsquelle an ein oder mehrere Teile hängen (z. B. Sortimentbox) bzw. entfernen |
| `adjust_stock` | Bestand buchen (z. B. nach einem Projekt) |
| `record_fit_measurement` | gemessenen Passungswert speichern |
| `list_containers` | Organizer mit Fächern und Belegung |
| `list_spools` / `update_spool` | Filament |
| `list_intake` / `get_intake_photo` / `resolve_intake` | Fotos aus dem Eingang ansehen und als Teil anlegen |

## Bezugsquellen

Jedes Teil kann beliebig viele Links zu Produktseiten haben. In der Oberfläche den Link ins Feld unter „Bezugsquellen“ einfügen –
der Server liest Titel, Preis und Vorschaubild von der Seite (Open Graph / JSON-LD). Amazon- und AliExpress-Links werden auf die
Produkt-URL gekürzt, Kurzlinks (`amzn.eu/d/…`) aufgelöst und Tracking-Parameter entfernt. Manche Shops liefern keine Daten an
Server aus; dann bleibt der Link erhalten und Titel/Preis lassen sich von Hand ergänzen.

Per MCP erscheinen die Links in `get_part` und `search_parts` (Feld `links`), die Freitextsuche findet auch Shopnamen.
Mit `add_part_link` hängt Claude einen Link an mehrere Teile auf einmal, z. B. das Sortiment an alle enthaltenen Schrauben.

## Passungen

Die Werte in der Tabelle sind direkt die **CAD-Maße** für das gedruckte Gegenstück.
Startwerte relativ zum Nennmaß (FDM, 0,4-mm-Düse), überschreibbar durch Messwerte pro Teil:

| Gedrucktes Merkmal | Press | Snap-Fit | Lose |
|---|---|---|---|
| Bohrung / Tasche für das Teil (z. B. Lagersitz, Magnet) | +0,05 | +0,15 | +0,35 |
| Taschentiefe | ±0 | +0,10 | +0,30 |
| Zapfen in einer Bohrung des Teils (z. B. Lagerinnenring) | +0,05 | −0,05 | −0,20 |
| Schraubendurchgang (Press = selbstfurchend) | −0,40 | +0,20 | +0,40 |
| Kopfsenkung | +0,10 | +0,25 | +0,50 |
| Mutternfalle (Schlüsselweite) | +0,05 | +0,15 | +0,35 |
| Einschmelzmutter | Bohrung laut Hersteller, Tiefe = Länge + 0,5 | – | – |

## Entwicklung

```bash
npm install
npm run dev   # mit Beispieldaten in ./data-dev
```

Aufbau: `src/` Server (Express, SQLite, MCP), `public/` Oberfläche ohne Build-Schritt,
`public/shared/catalog.js` Normkatalog und Passungsregeln (von Server und Browser genutzt),
`public/shared/geom.js` 3D-Darstellung.

## Changelog

- **1.1.0** (2026-10-25): Bezugsquellen – Links zu Produktseiten pro Teil mit automatisch gelesenem Titel, Preis und Bild,
  bearbeiten und neu einlesen in der Oberfläche; MCP-Tools `add_part_link` und `remove_part_link`, Links in `get_part`/`search_parts`
  und als Option bei `add_part`, `update_part`, `resolve_intake`. Bestehende Datenbanken werden beim Start automatisch erweitert.
- **1.0.0** (2026-10-25): Erste Version – Organizer (Mini-Systainer, Tanos, Raster), Normkatalog, Passungen mit Messwerten,
  Foto-Eingang, Filament, QR-Etiketten, MCP-Schnittstelle, Docker-Image.
