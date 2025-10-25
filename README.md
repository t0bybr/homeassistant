# Home Assistant Jalousie-Steuerung (LOGO/MQTT)

Intelligente Jalousie-Steuerung für Siemens LOGO über MQTT mit State Machine, automatischem Tilt-Tracking und Drift-Vermeidung.

## Features

### 🎛️ State Machine
Klare Zustandsverwaltung verhindert Race Conditions:
- **idle**: Bereit für neue Befehle
- **moving_user**: Manuelle Tasterbedienung
- **moving_automation**: Automatische Fahrt (Zeit, Szene)
- **moving_wind**: Wind-Schutzfahrt
- **moving_tilt**: Einfache Tilt-Anpassung
- **adjusting_tilt_ref**: Multi-Step Tilt mit Referenzpunkt
- **recovering_position**: LOGO-Neustart, Position-Sync

### 🎚️ Tilt-System
- **Automatisches Tracking**: `tilt_current` wird bei jeder Bewegung aktualisiert
  - Hochfahren → 100% (Lamellen horizontal)
  - Runterfahren → 0% (Lamellen vertikal)
- **Intelligente Drift-Vermeidung**: Referenz-Methode bei kleinen Bewegungen
- **2× Hoch-Taste**: Toggle Tilt an/aus
- **Konfigurierbar**: Ziel-Neigung anpassbar (Standard: 75%)

### 🔘 Taster-Steuerung
- **Kurzdruck**: Cover öffnen/schließen
- **Langdruck**: Motor läuft solange Taste gedrückt
- **2× Hoch**: Tilt-Toggle
- **Sofort-Stop**: Bei laufender Bewegung stoppt jeder Tastendruck

### 🛡️ Sicherheitsfeatures
- **Sequence-ID**: Verhindert Endlosschleifen bei Multi-Step-Operationen
- **Wind-Sync**: Automatische Position-Synchronisation
- **Position-Backup**: Recovery bei LOGO-Neustart

## Dateistruktur

```
├── t0bybr/
│   └── blinds.yaml                 # Blueprint (Hauptlogik)
├── utilities/
│   └── blinds.yaml                 # Utility-Scripts
├── wohnzimmer_west(1).yaml         # Instanz-Konfiguration
└── README.md                       # Diese Datei
```

## Installation

### 1. Voraussetzungen
- Home Assistant mit MQTT-Integration
- Siemens LOGO mit MQTT-Interface
- LOGO-Programm mit folgenden Registern/Coils (Beispiel):
  - Register 535: Zielposition (Ticks)
  - Register 534: Max. Fahrweg (Limit)
  - Register 20: Position-Counter
  - Coil 8303/8304: Motor Hoch/Runter
  - Sensor für Position (Ticks)
  - Sensor für Status (0=closed, 1=idle, 2=closing, 3=opening)

### 2. Files kopieren
Kopiere alle Dateien in dein Home Assistant `config/` Verzeichnis:
```bash
config/
├── blueprints/automation/t0bybr/blinds.yaml
├── scripts/utilities/blinds.yaml
└── packages/wohnzimmer_west.yaml
```

### 3. Helper-Entitäten erstellen
Die Helper werden automatisch aus `wohnzimmer_west(1).yaml` geladen. Du brauchst:
- `input_boolean` (2): counting, tilt_enabled
- `input_select` (1): state
- `input_text` (2): sequence_id, last_direction_text
- `input_number` (11): siehe Datei
- `counter` (1): clicks

### 4. Konfiguration anpassen
In `wohnzimmer_west(1).yaml`:
```yaml
automation:
  - use_blueprint:
      path: t0bybr/blinds.yaml
      input:
        name: "living_room_west"
        floor: "0"

        # Buttons
        up_button_entity_id: binary_sensor.YOUR_UP_BUTTON
        down_button_entity_id: binary_sensor.YOUR_DOWN_BUTTON

        # Sensoren
        position_ticks_sensor_entity_id: sensor.YOUR_POSITION_SENSOR
        movement_status_sensor_entity_id: sensor.YOUR_STATUS_SENSOR

        # LOGO Register/Coils
        coil_up: 8303
        coil_down: 8304
        register_target: 535
        register_max_ticks_limit: 534
        register_counter: 20

        # Kalibrierung
        max_travel_ticks: 552
        tilt_target_default: 75
```

### 5. Home Assistant neu laden
```
Einstellungen → System → Neuladen:
- YAML-Konfiguration neu laden
- Automationen
- Skripte
```

## Kalibrierung

### Position (max_travel_ticks)
1. Fahre Jalousie manuell komplett hoch
2. Notiere Position-Sensor-Wert (z.B. 552 Ticks)
3. Setze `max_travel_ticks: 552` im Blueprint

### Tilt (tilt_ticks_close/open)
1. **Tilt Ticks Close** (0% → horizontal zu vertikal):
   - Jalousie komplett geschlossen, Lamellen horizontal
   - Fahre minimal runter bis Lamellen vertikal
   - Miss Tick-Differenz (z.B. 14 Ticks)

2. **Tilt Ticks Open** (100% → vertikal zu horizontal):
   - Jalousie komplett geschlossen, Lamellen vertikal
   - Fahre minimal hoch bis Lamellen horizontal
   - Miss Tick-Differenz (z.B. 15 Ticks)

3. Setze Werte in Helpers:
   ```yaml
   blinds_*_tilt_ticks_close: 14
   blinds_*_tilt_ticks_open: 15
   ```

### Motor-Mindestlaufzeit (min_motor_ticks)
Teste welche minimale Tick-Anzahl der Motor tatsächlich fährt:
- Starte mit 5 Ticks
- Fahre manuell kleine Schritte
- Wenn Motor nicht reagiert: Erhöhe Wert
- Wenn Motor zu ruckartig: Verringere Wert

## Bedienung

### Taster
- **1× Hoch**: Jalousie öffnen (100%)
- **1× Runter**: Jalousie schließen (0%)
- **2× Hoch**: Tilt an/aus toggeln
- **Lang Hoch/Runter**: Motor läuft bis Taste losgelassen

### Tilt
1. **Aktivieren**: 2× Hoch-Taste drücken
2. System fährt automatisch zu `tilt_target` (z.B. 75%)
3. **Deaktivieren**: Nochmal 2× Hoch drücken → fährt zu 100% (horizontal)

### Automatisch
Tilt wird automatisch angewendet:
- Nach jeder Fahrt die bei Position < 80% endet
- Wenn `tilt_enabled = true`

## Drift-Vermeidung

### Problem
Motor hat Mindestlaufzeit → zu kleine Bewegungen werden ignoriert → Position-Zähler stimmt nicht mehr

### Lösung: Referenz-Methode
Wenn Bewegung < `min_motor_ticks`:
1. Fahre erst zu 0% Tilt (Referenzpunkt, ca. 14 Ticks)
2. Dann zu Ziel-Tilt (z.B. 75% = 11 Ticks hoch)

Vorteil: Beide Bewegungen groß genug, Motor fährt sicher

## MQTT Topics

### Befehle an LOGO
```
logo/register/set/<register_target>
  Payload: <ticks>       # Zielposition
  Payload: "10000"       # Bestätigung/Stop

logo/register32/set/<register_counter>
  Payload: <ticks>       # Position-Backup schreiben

logo/coil/set/<coil_up|coil_down>
  Payload: "ON"/"OFF"    # Motor an/aus
```

### Sensoren von LOGO
```
sensor.<position_sensor>
  State: 0..max_travel_ticks

sensor.<status_sensor>
  State: 0 = closed
         1 = idle/open
         2 = closing
         3 = opening
```

## Troubleshooting

### Jalousie fährt nicht
- Prüfe MQTT-Verbindung
- Prüfe State: Muss `idle` sein
- Prüfe LOGO Register-Nummern

### Tilt funktioniert nicht
- Prüfe `tilt_enabled` Status
- Prüfe Position < 80%
- Kalibriere `tilt_ticks_close/open`

### Position stimmt nicht
- LOGO neu gestartet? → Position wird automatisch wiederhergestellt
- Prüfe `max_travel_ticks` Kalibrierung

### `.lower()` Fehler
- Wurde in v2 gefixt (floor_slug als String konvertiert)
- Reload Automations & Scripts

### Endlosschleife
- Sequence-ID System sollte das verhindern
- Prüfe `min_motor_ticks` (evtl. zu klein)

## Naming Convention

Alle Entitäten folgen dem Schema:
```
blinds_{floor}_{room}_{function}
```

Beispiele:
```yaml
input_boolean.blinds_0_living_room_west_tilt_enabled
input_number.blinds_0_living_room_west_tilt_current
input_select.blinds_0_living_room_west_state
```

Sichtbare Namen (UI):
```
"Jalousie West - [Funktion]"
```

## Changelog

### v2.0 (aktuell)
- Komplett neues Tilt-System mit State Machine
- Automatisches Tilt-Tracking (tilt_current)
- Intelligente Drift-Vermeidung (Referenz-Methode)
- Sequence-ID gegen Endlosschleifen
- Code-Cleanup: -570 Zeilen alter Code entfernt
- Konsistente Namensgebung mit Icons
- Fix: floor_slug/room_slug als String (behebt .lower() Fehler)

### v1.0
- Initiales System mit adaptiven Tilt-Schritten
- Komplexe Kalibrierungswerte pro Position

## Support

Bei Problemen erstelle ein Issue im Repository mit:
- Home Assistant Version
- Fehlermeldung aus Logs
- Relevante Konfiguration (ohne Credentials)

## License

MIT

---

🤖 Generated with Claude Code
