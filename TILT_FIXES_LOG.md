# Tilt-System Fixes - Entwicklungs-Log

**Branch**: `fix-tilt-from-scratch`
**Datum**: 2025-01-02
**Status**: In Progress - Testing benötigt

---

## 🎯 Ursprüngliches Problem

**User-Report:**
- Automatisches Nachstellen der Neigung funktioniert nicht
- Beim 2× Hoch-Drücken muss man "2× 2-fach" drücken damit es funktioniert
- Tilt ON funktionierte, aber Tilt OFF bewegte sich nicht
- Jalousie fährt 3-4× hintereinander kurz beim Tilt-Nachstellen

---

## 🐛 Gefundene Bugs (in Reihenfolge der Entdeckung)

### 1. String-Type-Mismatch bei sequence_id Vergleich
**Symptom**: Script wurde fälschlicherweise als "interrupted" erkannt
```
Sequence ID aktuell: 1762097854.183873
Sequence ID erwartet: 1762097854.183873
Match: False  ← ❌ WTF?!
```

**Root Cause**: Type-Mismatch beim Vergleich (String vs Number/Float)
- `states(sequence_id_entity) == seq_id` → False (Type-Mismatch)

**Auswirkung**:
- Script wurde unterbrochen
- `tilt_current` wurde NIE gesetzt
- Blieb auf 0%
- Tilt OFF dachte "schon bei 0%" und bewegte sich nicht

**Fix**: Expliziter String-Cast bei allen Vergleichen
```yaml
{{ (states(sequence_id_entity) | string) != (seq_id | string) }}
```

**Commit**: `c1d035c` - Fix: String-Cast für sequence_id Vergleich (Critical Bug!)

**Betroffene Stellen**:
- Direkt-Methode (utilities/blinds.yaml:198)
- Referenz-Methode Step 1 (utilities/blinds.yaml:242)
- Referenz-Methode Step 2 (utilities/blinds.yaml:265)

---

### 2. Race Condition: State bereits "idle" beim Fahrtende
**Symptom**: Auto-Nachstellen funktioniert nicht
```
🛑 Fahrt beendet
State: idle  ← SCHON idle!
❌ apply_tilt NICHT aufgerufen
State Check: idle in ['moving_user', 'moving_automation'] = False
```

**Root Cause**: Timing-Race zwischen Script und Blueprint
```
T1: Script setzt State auf "idle"
T2: Script leert sequence_id
T3: Blueprint Trigger "Fahrt endet" feuert (mit 0.3s delay)
T4: Blueprint liest state_current = "idle"  ← ZU SPÄT!
T5: Condition fehlgeschlagen → apply_tilt NICHT aufgerufen
```

**Fix**: Prüfe `sequence_id` statt `state` (race-condition-safe)
```yaml
# Vorher:
state_current in ['moving_user', 'moving_automation']  ❌

# Nachher:
(states(var_sequence_id_entity_id) | string) == ''  ✅
```

**Commit**: `4762597` - Fix: Race Condition bei Auto-Nachstellen gelöst

---

### 3. Endlosschleife beim Tilt-Nachstellen
**Symptom**: Jalousie fährt 3-4× kurz hintereinander
```
Timeline:
1. Script setzt tilt_current = 75%
2. Script leert sequence_id
3. "Fahrt startet" Trigger feuert PARALLEL
4. sequence_id ist kurzzeitig leer → tilt_current wird auf 100% überschrieben!
5. Blueprint denkt: tilt_current = 100%, target = 75% → fährt nochmal
6. → Endlosschleife bis tilt_current == tilt_target
```

**Root Cause**: Timing-Race zwischen Script-Cleanup und Trigger

**Fix**: "Fahrt startet" Trigger mit IF-Check statt Condition
```yaml
# Vorher: Condition verhindert komplettes Feuern
conditions: >
  and states(var_state_entity_id) not in ['moving_tilt', 'adjusting_tilt_ref']
  and sequence_id == ''

# Nachher: Trigger feuert immer, aber IF entscheidet
conditions: > (nur Status-Check)
sequence:
  - if: State nicht Tilt UND sequence_id leer
    then: setze tilt_current
```

**Commit**: `3899b59` - Fix: Race Condition beim tilt_current Update (Endlosschleife Fix!)

---

### 4. Script setzt State zu früh auf idle
**Symptom**: Endlosschleife immer noch da (nach Fix #3)
```
✅ tilt_current gesetzt: 75.0%

🛑 Fahrt beendet
tilt_current: 100.0%  ← SCHON WIEDER ÜBERSCHRIEBEN!

▶️ Fahrt startet
State: idle  ← Script hat State schon zurückgesetzt!
Wird tilt_current gesetzt? JA  ← ❌
```

**Root Cause**: Script setzt State auf idle VOR "Fahrt startet" Trigger

**Fix**: Script setzt State NICHT mehr auf idle
- Script: Nur sequence_id leeren
- Blueprint: Setzt State auf idle (blinds.yaml:384-388)

**Commits**:
- `b94fd19` - Fix: Script setzt State NICHT mehr auf idle (kritischer Race Fix!)
- `9b8ff67` - Fix: Auch Tilt-OFF setzt State nicht mehr auf idle
- `6560797` - Fix: Auch Sequence-Interrupts setzen State nicht mehr

---

### 5. Fahrtende prüft State nicht
**Symptom**: Endlosschleife immer noch da (nach Fix #4)
```
🛑 Fahrt beendet
State: moving_tilt  ← Tilt-Fahrt!
Sequence ID: ""     ← Aber leer!
Wird apply_tilt aufgerufen? JA  ← ❌ FALSCH!
```

**Root Cause**: "Fahrt endet" Trigger prüft nur `sequence_id == ''`, nicht State

**Fix**: Doppelter Schutz auch beim Fahrtende
```yaml
and (states(var_sequence_id_entity_id) | string) == ''
and states(var_state_entity_id) not in ['moving_tilt', 'adjusting_tilt_ref']
```

**Commit**: `2a67ac4` - Fix: Fahrtende prüft jetzt auch State (Endlosschleife Final Fix!)

---

### 6. State-Cleanup unvollständig
**Symptom**: State bleibt auf `moving_tilt` hängen

**Root Cause**: Blueprint setzte nur `moving_user`/`moving_automation` auf idle
```yaml
# Vorher:
- if: "{{ states(var_state_entity_id) in ['moving_user', 'moving_automation'] }}"

# Nachher:
- if: "{{ states(var_state_entity_id) in ['moving_user', 'moving_automation', 'moving_tilt', 'adjusting_tilt_ref'] }}"
```

**Commit**: `ea90607` - Fix: State-Cleanup für ALLE Fahrt-States

---

## ✅ Implementierte Fixes - Zusammenfassung

### Architektur-Änderungen

**Vorher:**
- Script setzt State auf idle beim Cleanup
- Nur sequence_id als Schutz gegen Endlosschleife
- State-Check nur bei Fahrtstart
- Condition verhindert Trigger-Feuern

**Nachher:**
- **Script**: Setzt State NIE mehr (nur sequence_id leeren)
- **Blueprint**: Setzt State auf idle bei Fahrtende für ALLE Fahrt-States
- **Doppelter Schutz**: State UND sequence_id bei Fahrtstart UND Fahrtende
- **IF statt Condition**: Trigger feuert immer, IF entscheidet innerhalb der Sequence
- **String-Cast**: Alle sequence_id Vergleiche mit explizitem String-Cast

### Geänderte Dateien

**t0bybr/blinds.yaml** (Blueprint):
- Zeile 254: Sequence ID Condition entfernt, zu IF verschoben (Fahrtstart)
- Zeile 258-266: DEBUG Fahrtstart Notification
- Zeile 268-296: IF-Check für tilt_current Update (statt Condition)
- Zeile 361: State-Check zu Fahrtende-Condition hinzugefügt
- Zeile 384: State-Cleanup für alle Fahrt-States

**utilities/blinds.yaml** (Scripts):
- Zeile 127: State-Setting entfernt (Tilt OFF)
- Zeile 198: String-Cast für sequence_id (Direkt-Methode)
- Zeile 202: State-Setting entfernt (Interrupt)
- Zeile 240: State-Setting entfernt (Interrupt Step 1)
- Zeile 242: String-Cast für sequence_id (Referenz Step 1)
- Zeile 261: State-Setting entfernt (Interrupt Step 2)
- Zeile 265: String-Cast für sequence_id (Referenz Step 2)
- Zeile 283: State-Setting entfernt (Cleanup am Ende)

**wohnzimmer_west(1).yaml** (Cover Template):
- Zeile 230, 249, 276: moving_user State bei open/close/set_position

### Commit History (Branch: fix-tilt-from-scratch)

```
ea90607 - Fix: State-Cleanup für ALLE Fahrt-States
2a67ac4 - Fix: Fahrtende prüft jetzt auch State (Endlosschleife Final Fix!)
6560797 - Fix: Auch Sequence-Interrupts setzen State nicht mehr
9b8ff67 - Fix: Auch Tilt-OFF setzt State nicht mehr auf idle
b94fd19 - Fix: Script setzt State NICHT mehr auf idle (kritischer Race Fix!)
3899b59 - Fix: Race Condition beim tilt_current Update (Endlosschleife Fix!)
c1d035c - Fix: String-Cast für sequence_id Vergleich (Critical Bug!)
4762597 - Fix: Race Condition bei Auto-Nachstellen gelöst
d5767e0 - Fix: 3 kritische Verbesserungen für Tilt-System (erste Iteration)
```

---

## 🧪 Test-Status

### Letzter Stand (User)
- ✅ Tilt ON: funktioniert
- ⚠️ Immer noch 2× gefahren beim Test
- ❌ Tilt OFF: Boolean wechselt, aber keine Bewegung mehr
- ❓ Auto-Nachstellen Hoch: ungetestet
- ❓ Auto-Nachstellen Runter: ungetestet

**Letztes Problem (User-Report):**
```
⏸️ Kein Tilt nötig
Current = Target = 75%
```
→ tilt_current scheint nicht korrekt aktualisiert zu werden

### Nächste Test-Schritte (nach letzten Fixes)

1. **Home Assistant neu laden**
2. **Test: Tilt ON** (Jalousie auf 40%, Tilt OFF → 2× Hoch drücken)
   - Erwartung: Nur 1× fahren
   - Prüfen: ▶️ Fahrt startet mit State = moving_tilt, tilt_current nicht gesetzt
3. **Test: Tilt OFF** (Nach Tilt ON → 2× Hoch drücken)
   - Erwartung: Lamellen fahren zu 0%
   - Prüfen: tilt_current wird korrekt auf 75% gesetzt vorher
4. **Test: Auto-Nachstellen Runter** (70% → 40% mit Tilt ON)
   - Erwartung: Lamellen stellen sich automatisch nach
5. **Test: Auto-Nachstellen Hoch** (20% → 40% mit Tilt ON)
   - Erwartung: Lamellen stellen sich automatisch nach

---

## 🔍 Debug-Notifications (aktuell aktiv)

Alle wichtigen Stellen haben Debug-Logs für Troubleshooting:

**Fahrtstart** (t0bybr/blinds.yaml:258-266):
```
▶️ Fahrt startet
Status: 1 → 3
State: moving_tilt
Sequence ID: "1762099337.140634"
Wird tilt_current gesetzt? NEIN
```

**Fahrtende** (t0bybr/blinds.yaml:340-350):
```
🛑 Fahrt beendet
Position: 43%
State: moving_tilt
Tilt enabled: True
Tilt current: 0.0%
Letzte Richtung: 3 (2=runter, 3=hoch)
Sequence ID: ""
Wird apply_tilt aufgerufen? NEIN
```

**apply_tilt Entscheidung** (t0bybr/blinds.yaml:364-380):
```
✅ Rufe apply_tilt auf
Script wird jetzt gestartet (State + sequence_id OK)

ODER

❌ apply_tilt NICHT aufgerufen
Position Check: 43 < 80 = True
Tilt enabled: True
Sequence ID leer: True
State OK: False (State: moving_tilt)
```

**Script Entry** (utilities/blinds.yaml:72-79):
```
🟢 apply_tilt gestartet
Tilt enabled: True
Tilt current: 0%
Tilt target: 75%
Position: 229 ticks
```

**Wait/Sequence Check** (utilities/blinds.yaml:187-195):
```
⏱️ Wait beendet (Direkt-Methode)
Status: 1
Sequence ID aktuell: "1762097854.183873"
Sequence ID erwartet: "1762097854.183873"
Match (alt): False
Match (string): True
```

**tilt_current Update** (utilities/blinds.yaml:209-222):
```
📝 Setze tilt_current
Vorher: 0.0%, Nachher: 75%

✅ tilt_current gesetzt
Neuer Wert: 75.0%
```

**Tilt Methode** (utilities/blinds.yaml:154-161):
```
🎯 Tilt wird angewendet
Delta: 75%
Ticks needed: 11
Methode: Direkt
Position: 229 → 240
```

**Tilt OFF** (utilities/blinds.yaml:85-90):
```
🔴 Tilt DISABLED → fahre zu 0%
Current: 75%
Wird bewegen? JA
```

---

## 📝 Offene Punkte

### Sofort
1. **Test nach letzten Fixes** (`ea90607`)
   - Alle 4 Test-Szenarien durchführen
   - Verifizieren dass Endlosschleife weg ist
   - State-Cleanup funktioniert

### Falls Tests erfolgreich
2. **Debug-Logs entfernen**
   - Alle persistent_notifications raus
   - Nur echte Error-Cases behalten

3. **PR/Merge vorbereiten**
   - Branch `fix-tilt-from-scratch` → `main`
   - Clean commit history erstellen (evtl. squash)

### Langfristig
4. **tilt_current Tracking verbessern**
   - Aktuell: Pauschal 0%/100% bei Fahrtstart
   - Besser: Basierend auf gefahrenen Ticks berechnen
   - Erfordert: position_start Helper

5. **Dokumentation**
   - README.md aktualisieren
   - Kommentare im Code überprüfen
   - Kalibrierungs-Anleitung

---

## 💡 Lessons Learned

### Race Conditions in Home Assistant
1. **State kann sich zwischen Trigger-Condition und Action ändern**
   - Lösung: IF-Check in der Sequence, nicht in der Condition
2. **Trigger feuern parallel/asynchron**
   - Lösung: Doppelter Schutz (State UND Flag)
3. **Scripts laufen asynchron**
   - Lösung: sequence_id als eindeutiger Marker

### Type Safety in Templates
1. **Jinja2 Float-Precision kann Vergleiche kaputt machen**
   - Lösung: Expliziter String-Cast bei allen ID-Vergleichen
2. **states() gibt immer String zurück**
   - Aber: now().timestamp() ist Float
   - Konsequent (x | string) verwenden

### State Machine Design
1. **Klare Verantwortlichkeiten: Wer setzt welchen State?**
   - Vorher: Script UND Blueprint setzten State → Chaos
   - Nachher: NUR Blueprint setzt State → sauber
2. **Minimale Änderungen im kritischen Pfad**
   - sequence_id nur an 2 Stellen: setzen + leeren
   - State nur an 1 Stelle: Blueprint Fahrtende

---

**Erstellt**: 2025-01-02
**Letztes Update**: 2025-01-02 (Commit ea90607)
**Nächster Schritt**: User-Testing mit allen Fixes
