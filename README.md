# Home Assistant Jalousie-Steuerung (LOGO/MQTT)

## Inhaltsverzeichnis
- [Überblick](#überblick)
- [Architektur & Komponenten](#architektur--komponenten)
- [State Machine](#state-machine)
- [Tilt-System](#tilt-system)
- [Kalibrierung](#kalibrierung)
- [Neue Jalousie einrichten](#neue-jalousie-einrichten)
- [MQTT/LOGO Integration](#mqttlogo-integration)
- [Troubleshooting](#troubleshooting)
- [Technische Details](#technische-details)

---

## Überblick

Dieses System steuert Jalousien über ein **Siemens LOGO PLC** via **MQTT**. Es bietet:

- ✅ **Tastersteuerung** (Kurz-/Langdruck, Mehrfachklicks)
- ✅ **Intelligentes Tilt-System** mit automatischer Drift-Vermeidung
- ✅ **State Machine** für klare Zustandsverwaltung
- ✅ **Sequence-ID** gegen Race-Conditions
- ✅ **Wind-Schutz** & **Position-Backup**

### Dateien-Struktur

```
/home/user/homeassistant/
├── t0bybr/
│   └── blinds.yaml              # Blueprint (Hauptautomation)
├── utilities/
│   └── blinds.yaml              # Utility-Scripts (Tilt, Langdruck, etc.)
├── wohnzimmer_west(1).yaml      # Beispiel-Konfiguration
└── README.md                    # Diese Datei
```

---

## Architektur & Komponenten

### 1. Blueprint (`t0bybr/blinds.yaml`)

Die **zentrale Automation** mit allen Triggern und Logik:
- Taster-Events (hoch/runter)
- Status-Wechsel (Fahrt beginnt/endet)
- Tilt-Controller (Toggle, Auto-Disable, Auto-Korrektur)
- Wind-Sync & Position-Backup

### 2. Utility-Scripts (`utilities/blinds.yaml`)

Wiederverwendbare Scripts:
- `util_blinds_apply_tilt`: Tilt anwenden (Direkt/Referenz-Methode)
- `util_blinds_longpress`: Coil halten (Langdruck)
- `util_blinds_counter_click`: Klickzähler
- `util_blinds_counter_window`: Zählfenster-Auswertung

### 3. Raum-Konfiguration (`wohnzimmer_west(1).yaml`)

Für jede Jalousie:
- **Helper-Entitäten** (input_boolean, input_number, etc.)
- **Template-Cover** (MQTT → LOGO)
- **Blueprint-Verwendung** (Inputs)

---

## State Machine

Die State Machine verhindert Race-Conditions und sorgt für klare Zustandsverwaltung.

### States

| State | Bedeutung | Wer setzt? |
|-------|-----------|------------|
| `idle` | Bereit für neue Befehle | Blueprint (nach Fahrt-Ende) |
| `moving_user` | Manuelle Tasterbedienung | Taster-Handler |
| `moving_automation` | Automatische Fahrt (Szene, Zeit) | Blueprint (Fallback) |
| `moving_wind` | Wind-Schutzfahrt | Wind-Trigger |
| `moving_tilt` | Einfache Tilt-Anpassung | apply_tilt Script |
| `adjusting_tilt_ref` | Multi-Step Tilt (Referenz-Methode) | apply_tilt Script |
| `recovering_position` | LOGO-Neustart, Position-Sync | Position-Recovery |

### State-Flow

```
idle → moving_user (Taster gedrückt)
     → moving_tilt (Tilt-Anpassung direkt)
     → adjusting_tilt_ref (Tilt über Referenzpunkt)
     → moving_automation (Szene/Automation)

     → idle (nach Fahrt-Ende)
```

**WICHTIG**: Während Tilt-States (`moving_tilt`, `adjusting_tilt_ref`) werden `movement_ended_tilt` Trigger **ignoriert** (verhindert Race-Condition, siehe [Technische Details](#race-condition-fix)).

---

## Tilt-System

Das Tilt-System neigt die Lamellen automatisch nach jeder Fahrt.

### Grundkonzept

- **0%** = Vertikal geschlossen (Lamellen zu, kein Lichteinfall)
- **100%** = Horizontal offen (Lamellen ganz geöffnet, max. Lichteinfall)
- **75%** = Standard-Ziel (konfigurierbar)

### Aktivierung

**2× Hoch-Taste** → Tilt Toggle
- ON: Lamellen werden nach jeder Fahrt auf 75% geneigt
- OFF: Lamellen bleiben vertikal (0%)

### Auto-Disable

Ab **≥80% Position** wird Tilt automatisch deaktiviert.
- Grund: Bei hohen Positionen können Lamellen nicht sinnvoll geneigt werden

### Direkt vs. Referenz-Methode

Das System nutzt **2 Methoden** zur Tilt-Anpassung:

#### 1. DIREKT-Methode (einfach)

**Wann?** Delta groß genug (≥ min_motor_ticks) UND positiv (hoch fahren)

```
current_pos + delta_ticks → Ziel
```

**Beispiel**: Von 50% auf 75%
- Delta: 25%
- Ticks: 25% × 15 = 3.75 ≈ 4 Ticks
- Bewegung: Direkt +4 Ticks hoch

#### 2. REFERENZ-Methode (präzise)

**Wann?** Delta zu klein ODER negativ (runter fahren)

```
Schritt 1: current_pos - tilt_ticks_close → 0% (vertikal)
Schritt 2: 0% + (target% × tilt_ticks_open) → Ziel
```

**Beispiel**: Von 100% auf 75%
- Schritt 1: -14 Ticks → 0%
- **2s Pause** (Motor braucht Zeit für Richtungswechsel!)
- Schritt 2: +11 Ticks (75% × 15 = 11.25 ≈ 11) → 75%

**Warum?**
- ✅ Konsistente Position (immer relativ zu 0%)
- ✅ Vermeidet Drift (`tilt_ticks_close` ≠ `tilt_ticks_open`)
- ✅ Motor-Präzision bei kleinen Bewegungen

### Lookahead

Vor jeder Tilt-Anpassung prüft das System:
- Würde die Bewegung Position ≥ 80% machen?
- → Wenn ja: Tilt wird **nicht** ausgeführt

Dies verhindert Fehler bei Referenz-Methode (2-Schritt-Bewegung könnte über 80% gehen).

---

## Kalibrierung

### Schritt 1: Fahrweg messen (`max_travel_ticks`)

1. Jalousie ganz runterfahren (0%)
2. In LOGO: Positionswert notieren (sollte ≈0 sein)
3. Jalousie ganz hochfahren (100%)
4. In LOGO: Positionswert notieren
5. Differenz = `max_travel_ticks`

**Beispiel**: 0 → 552 Ticks ⇒ `max_travel_ticks: 552`

### Schritt 2: Tilt-Ticks messen

#### `tilt_ticks_close` (horizontal → vertikal)

1. Jalousie bei 50% Position stoppen
2. Lamellen ganz horizontal öffnen (100% Tilt, manuell)
3. Position notieren (z.B. 276)
4. Lamellen ganz vertikal schließen (0% Tilt, manuell)
5. Position notieren (z.B. 262)
6. Differenz = `tilt_ticks_close`

**Beispiel**: 276 - 262 = 14 Ticks ⇒ `tilt_ticks_close: 14`

#### `tilt_ticks_open` (vertikal → horizontal)

1. Jalousie bei 50% Position stoppen
2. Lamellen ganz vertikal schließen (0% Tilt, manuell)
3. Position notieren (z.B. 262)
4. Lamellen ganz horizontal öffnen (100% Tilt, manuell)
5. Position notieren (z.B. 277)
6. Differenz = `tilt_ticks_open`

**Beispiel**: 277 - 262 = 15 Ticks ⇒ `tilt_ticks_open: 15`

**WICHTIG**: Die Werte sind oft **unterschiedlich** (z.B. 14 vs. 15)!
- Mechanik des Motors
- System nutzt **nur** `tilt_ticks_open` für Ziel-Berechnung (konsistente Positionen)

### Schritt 3: Minimale Motorlaufzeit (`min_motor_ticks`)

Kleinste Bewegung, die der Motor **zuverlässig** ausführt.

**Test**:
1. Jalousie bei 50% stoppen
2. MQTT: Zielposition +3 Ticks setzen
3. Fährt der Motor? → Wenn nein: zu klein
4. Wiederhole mit +4, +5, ... bis Motor zuverlässig fährt

**Typisch**: `min_motor_ticks: 5`

---

## Neue Jalousie einrichten

### Schritt 1: Datei kopieren

```bash
cp wohnzimmer_west(1).yaml schlafzimmer_ost.yaml
```

### Schritt 2: Entity-Namen anpassen

**Suche & Ersetze** in `schlafzimmer_ost.yaml`:
- `blinds_0_living_room_west` → `blinds_0_bedroom_east`
- `living_room_west` → `bedroom_east`

**Achtung**: `floor: "0"` ggf. anpassen (Stockwerk)

### Schritt 3: TODO-Markierungen abarbeiten

In `schlafzimmer_ost.yaml` nach **`TODO:`** suchen und anpassen:

#### A) MQTT Sensoren

```yaml
# TODO: MQTT SENSOREN - Sensor-IDs anpassen
position_ticks_sensor_entity_id: sensor.mosquitto_broker_mqtt_logo_hr_105_position_raw
movement_status_sensor_entity_id: sensor.mosquitto_broker_mqtt_logo_hr_105_status
up_button_entity_id: binary_sensor.mosquitto_broker_mqtt_logo_coil_11
down_button_entity_id: binary_sensor.mosquitto_broker_mqtt_logo_coil_10
```

**Wo finde ich die Werte?**
- Developer Tools → States → Nach `mqtt` oder `logo` filtern

#### B) LOGO Register & Coils

```yaml
# TODO: LOGO REGISTER - Register-Nummern
register_target: 536
register_max_ticks_limit: 535
register_counter: 21

# TODO: LOGO COILS - Coil-Nummern für Motor
coil_up: 8305
coil_down: 8306
```

**Wo finde ich die Werte?**
- LOGO-Programm (TIA Portal oder LOGO! Soft Comfort)
- Mqtt-Topic-Liste (z.B. MQTT Explorer)

#### C) Kalibrierung

Siehe [Kalibrierung](#kalibrierung)

```yaml
# TODO: KALIBRIERUNG
max_travel_ticks: 548
tilt_ticks_close: 13
tilt_ticks_open: 14
min_motor_ticks: 5
```

#### D) Tilt-Konfiguration

```yaml
# TODO: TILT-KONFIGURATION
tilt_target_default: 75        # Standard-Neigung beim Toggle (0-100%)
tilt_position_threshold_pct: 80  # Max. Position für Tilt
```

### Schritt 4: Datei in Home Assistant laden

```yaml
# In configuration.yaml
homeassistant:
  packages:
    blinds_bedroom_east: !include schlafzimmer_ost.yaml
```

Oder wenn du schon `!include_dir_merge_named packages/` nutzt:
```bash
mv schlafzimmer_ost.yaml packages/
```

### Schritt 5: Home Assistant neu starten

Settings → System → Restart

### Schritt 6: Testen

1. **Taster testen**: Hoch/Runter Kurz-/Langdruck
2. **Tilt testen**: 2× Hoch → Jalousie runterfahren → Prüfen ob Lamellen auf 75% stehen
3. **Kalibrierung prüfen**: Stimmen die Positionen? Wenn nicht: Werte anpassen

---

## MQTT/LOGO Integration

### Topics

#### 1. Register setzen (Befehle)

```
Topic: logo/register/set/<register_number>
Payload: <ticks> oder "10000"
```

**Beispiele**:
- `logo/register/set/535` → `300` (Fahre zu 300 Ticks)
- `logo/register/set/535` → `10000` (Bestätigung, Motor-Stop)

#### 2. Coil setzen (Langdruck)

```
Topic: logo/coil/set/<coil_number>
Payload: "ON" oder "OFF"
```

**Beispiel**:
- `logo/coil/set/8303` → `ON` (Motor hoch an)
- `logo/coil/set/8303` → `OFF` (Motor aus)

#### 3. Sensoren (Status lesen)

**Position**:
```
Topic: logo/hr/<register_number>
Payload: <current_ticks>
Entity: sensor.mosquitto_broker_mqtt_logo_hr_104_position_raw
```

**Status**:
```
Topic: logo/hr/<register_number>
Payload: 0/1/2/3
Entity: sensor.mosquitto_broker_mqtt_logo_hr_104_status

0 = closed (geschlossen, unten)
1 = idle/open (offen, steht)
2 = closing (fährt runter)
3 = opening (fährt hoch)
```

### LOGO-Programm Anforderungen

Das LOGO-Programm muss folgendes bereitstellen:

1. **Register** für Zielposition (liest MQTT `register/set/<X>`)
2. **Register** für Max-Limit (liest MQTT `register/set/<Y>`)
3. **Register** für Counter-Backup (liest MQTT `register32/set/<Z>`)
4. **Coils** für Motor hoch/runter (liest MQTT `coil/set/<A/B>`)
5. **Status-Register** (publiziert nach MQTT `hr/<X>`, Werte 0-3)
6. **Positions-Register** (publiziert nach MQTT `hr/<Y>`, Ticks)

**Verhalten bei Payload `10000`**:
- LOGO interpretiert als "Bestätigung" → Motor-Stop

---

## Troubleshooting

### Problem 1: Tilt funktioniert nicht

**Symptome**: Nach Fahrt stehen Lamellen vertikal (0%), obwohl Tilt aktiv

**Lösungen**:
1. Prüfen: `input_boolean.blinds_0_living_room_west_tilt_enabled` = ON?
2. Prüfen: Position < 80%? (sonst Auto-Disable)
3. Logs prüfen: Gibt es "Auto-Disable" Meldungen?
4. `tilt_lock` prüfen: `input_boolean.blinds_0_living_room_west_tilt_lock` = OFF?
   - Wenn ON: Script hängt, Lock manuell zurücksetzen

### Problem 2: Endlosschleife / Tilt togglet ständig

**Symptome**: `tilt_enabled` schaltet ständig ON/OFF/ON

**Ursache**: Auto-Disable bei ≥80%

**Lösung**: Position < 80% fahren, dann Tilt aktivieren

### Problem 3: Inkonsistente Lamellen-Positionen

**Symptome**: Nach Runterfahren stehen Lamellen anders als nach Hochfahren

**Ursache**: Falsche Kalibrierung

**Lösungen**:
1. `tilt_ticks_close` und `tilt_ticks_open` **neu messen** (siehe [Kalibrierung](#kalibrierung))
2. Werte in `input_number` Entitäten anpassen
3. Testen: Mehrmals hoch/runter fahren → Sollte jetzt konsistent sein

### Problem 4: Motor reagiert nicht bei Tilt

**Symptome**: Tilt wird ausgeführt, aber Motor fährt nicht

**Lösungen**:
1. Prüfen: `min_motor_ticks` zu groß?
   - Delta-Bewegung < `min_motor_ticks` → Referenz-Methode wird genutzt
   - Wenn Referenz auch nicht fährt: MQTT-Verbindung prüfen
2. MQTT Logs prüfen: Werden Topics publiziert?
3. LOGO-Programm prüfen: Reagiert auf MQTT?

### Problem 5: "Sequence interrupted" in Logs

**Symptome**: Tilt wird abgebrochen mit "Sequence interrupted at step 1/2"

**Ursache**: Neue Tilt-Operation gestartet während Referenz-Methode läuft

**Lösung**:
- Normal, wenn User während Tilt-Operation Button drückt
- Falls häufig: `tilt_lock` Logic prüfen (sollte parallel Starts verhindern)

### Problem 6: Race-Condition / tilt_current wird überschrieben

**Symptome**: Nach Tilt steht `tilt_current` nicht auf Ziel, sondern auf 0% oder 100%

**Ursache**: `movement_ended_tilt` Trigger feuert nach Script-Ende

**Lösung**:
- **Bereits gefixt** durch verzögerten State-Reset (2s) in `util_blinds_apply_tilt`
- Wenn trotzdem auftritt: Delay in `utilities/blinds.yaml:262` erhöhen (z.B. auf 3s)

---

## Technische Details

### Race-Condition-Fix

**Problem**:
1. `util_blinds_apply_tilt` setzt `tilt_current = 75%`
2. Script endet, `state → idle`
3. DANACH triggert `movement_ended_tilt` (Fahrt endet)
4. Blueprint überschreibt `tilt_current` basierend auf Fahrtrichtung (0% oder 100%)
5. ❌ `tilt_current` ist falsch!

**Lösung** (3-teilig):

#### 1. State-Check in Conditions-Block (Blueprint)

```yaml
# t0bybr/blinds.yaml:455-459
- conditions:
    - "{{ trigger.id == 'movement_ended_tilt' }}"
    - "{{ states(var_state_entity_id) not in ['moving_tilt', 'adjusting_tilt_ref'] }}"
```

Filtert `movement_ended_tilt` wenn Tilt-Operation läuft.

**Warum nicht im Trigger?**
- HA unterstützt **keine** `condition:` im Trigger
- Nur `conditions:` im action-Block

#### 2. Verzögerter State-Reset (Utility-Script)

```yaml
# utilities/blinds.yaml:262-265
- delay: "00:00:02"  # 2 Sekunden warten
- action: input_select.select_option
  data: { option: "idle" }
```

Während dieser 2s bleibt State in `moving_tilt`/`adjusting_tilt_ref`.
→ Alle `movement_ended_tilt` Trigger werden **ignoriert**.
→ Nach 2s sind alle Trigger durch → State wird `idle`.

**Warum 2s?**
- Getestet: 1s manchmal zu kurz
- 2s ist sicher für alle Trigger-Verarbeitung

#### 3. tilt_lock verhindert parallele Starts

```yaml
# utilities/blinds.yaml:73-74
- action: input_boolean.turn_on
  target: { entity_id: "{{ tilt_lock_entity }}" }
```

Wenn Tilt-Operation läuft:
- `tilt_lock = ON`
- Neue Tilt-Requests werden abgelehnt
- Lock wird am Ende freigegeben

### Sequence-ID (Interrupt-Detection)

Bei **Referenz-Methode** (2 Schritte):

**Problem**: User drückt Button während Schritt 1 → Neue Fahrt startet → Schritt 2 würde trotzdem laufen (Zombie)

**Lösung**: Sequence-ID

```yaml
# utilities/blinds.yaml:154-158
- variables:
    seq_id: "{{ now().timestamp() | string }}"
- action: input_text.set_value
  data: { value: "{{ seq_id }}" }
```

Nach jedem Schritt:
```yaml
# utilities/blinds.yaml:187-194
- if: "{{ (states(sequence_id_entity) | string) != (seq_id | string) }}"
  then:
    - stop: "Sequence interrupted"
```

Wenn neue Operation startet → Sequence-ID wird überschrieben → Alter Schritt bricht ab.

### Motor-Pause (2s Delay)

**Problem**: Motor braucht mechanische Zeit für Richtungswechsel.

**Symptome bei zu kurzer Pause**:
- Motor springt nicht an
- Unvorhersehbares Verhalten
- Tick-Zähler stimmt nicht

**Getestete Werte**:
- 0.5s: ❌ Zu kurz, Motor reagiert nicht
- 1.5s: ⚠️ Manchmal zu kurz
- 2.0s: ✅ Funktioniert zuverlässig

**Wo verwendet?**:
- Referenz-Methode: Zwischen Schritt 1 (runter) und Schritt 2 (hoch)
- Tilt-Disable: Nach Fahrt zu 0%

```yaml
# utilities/blinds.yaml:219
- delay: "00:00:02"
```

### Lookahead-Berechnung

**Ziel**: Verhindert Tilt-Operationen die Position ≥80% machen würden.

**Challenge**: Referenz-Methode macht 2 Schritte:
1. Runter zu 0%: `-tilt_ticks_close` (z.B. -14)
2. Hoch zu target%: `+target_ticks` (z.B. +11)

**Netto-Bewegung**: `-14 + 11 = -3 Ticks`

**Berechnung** (Blueprint):
```yaml
# t0bybr/blinds.yaml:506-519
tilt_ticks_needed: >
  {% if delta_pct > 0 %}
    {# Direkt-Methode: Einfach delta Ticks #}
    {{ (delta_pct / 100.0 * tilt_ticks_open) | round(0) | int }}
  {% elif delta_pct < 0 %}
    {# Referenz-Methode: Netto-Bewegung #}
    {% set tilt_ticks_close = ... %}
    {% set target_ticks = (tilt_target / 100.0 * tilt_ticks_open) | round(0) | int %}
    {{ -tilt_ticks_close + target_ticks }}
  {% endif %}

position_after_tilt: "{{ position + tilt_ticks_needed }}"
```

Wenn `position_after_tilt >= 80%` → Tilt wird **nicht** ausgeführt.

---

## Änderungshistorie (Wichtige Bugs)

### Bug #1: Endlosschleife bei Restorefahrt
**Symptom**: Jalousie fährt zu 100% statt 75%, `movement_ended_tilt` überschreibt `tilt_current`.

**Fix**: State-Check in conditions-Block + 2s verzögerter State-Reset.

**Commit**: `b972115` - "fix: Verzögerter State-Reset verhindert Race Condition"

---

### Bug #2: Endlosschleife bei >=80%
**Symptom**: `tilt_enabled` togglet ON/OFF/ON/OFF...

**Fix**: Early-exit in `tilt_toggle` wenn Auto-Disable ausgelöst hat.

**Commit**: `cc97346` - "fix: Endlosschleife bei >=80%"

---

### Bug #3: Inkonsistente Tilt-Positionen
**Symptom**: Nach Runterfahren stehen Lamellen steiler als nach Hochfahren.

**Root Cause**: Verwendung beider `tilt_ticks_close` (14) und `tilt_ticks_open` (15) für selbe Ziel-Position.

**Fix**: Immer nur `tilt_ticks_open` für Ziel-Berechnung, Referenz-Methode bei negativem Delta.

**Commit**: `37e6948` - "fix: Konsistente Tilt-Positionen durch Referenz-Kalibrierung"

---

### Bug #4: Referenz-Methode stoppt nach Schritt 1
**Symptom**: Nur runter zu 0%, dann nicht hoch zu target%.

**Fix**: Umfangreiche Debug-Notifications (später entfernt), funktionierte dann (vermutlich Timing-Issue).

**Commit**: `508e48f` - "debug: Umfangreiche Debug-Notifications für Referenz-Methode"

---

### Bug #5: Motor zu langsam für Richtungswechsel
**Symptom**: Motor springt nicht an bei Richtungswechsel.

**Fix**: Delay erhöht: 0.5s → 1.5s → 2s (final).

**Commit**: `ed38685` - "cleanup: Entferne Debug-Notifications und erhöhe Motor-Pause auf 2s"

---

## Support & Weiterentwicklung

### Logs aktivieren

In `configuration.yaml`:
```yaml
logger:
  default: info
  logs:
    homeassistant.components.automation: debug
    homeassistant.components.script: debug
```

### Nützliche Developer Tools

**States**: Alle Entitäten prüfen
- `input_number.blinds_0_living_room_west_tilt_current`
- `input_select.blinds_0_living_room_west_state`
- `sensor.mosquitto_broker_mqtt_logo_hr_104_position_raw`

**Services**: Manuell Tilt triggern
```yaml
service: script.util_blinds_apply_tilt
data:
  floor_slug: "0"
  room_slug: "living_room_west"
```

**MQTT**: Topics monitoren (MQTT Explorer oder HA Developer Tools → MQTT)

---

## Lizenz & Credits

Entwickelt von **t0bybr** für Home Assistant mit Siemens LOGO Integration.

**Technologien**:
- Home Assistant
- Siemens LOGO PLC
- MQTT (Mosquitto)
- YAML Blueprints

**Branch**: `claude/tilt-controller-refactor-011CUvpfEFQQYCWQLVrrULX3`

---

*Letzte Aktualisierung: 2025-11-09*
