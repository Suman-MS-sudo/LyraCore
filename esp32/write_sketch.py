import os

content = r'''/**
 * LyraCore Attendance — ESP32 + MFRC522 RFID Reader
 * =============================================================
 * Wiring:
 *   MFRC522 SDA(SS) → GPIO 5   SCK → 18   MOSI → 23
 *   MFRC522 MISO    → GPIO 19  RST → 22
 *   Green LED       → GPIO 12  (login/logout OK)
 *   Red LED         → GPIO 14  (rejected / error)
 *   Provision btn   → GPIO 4   (hold on boot OR press anytime)
 *                               connect other end to GND
 *
 * Required libraries (Arduino Library Manager):
 *   - MFRC522  by GithubCommunity
 *   - ArduinoJson
 *   (WebServer, WiFi, Preferences — built-in ESP32 core)
 *
 * WiFi Provisioning:
 *   Press the PROV button → ESP creates hotspot "LyraCore-Setup"
 *   Connect phone/laptop to that hotspot → open 192.168.4.1
 *   Choose your WiFi, enter password, hit Connect
 *   Credentials saved to flash; ESP reboots and connects
 *
 * Attendance rules:
 *   1st tap   → IN  (login)  → green 3×
 *   2nd tap ≥ 15 min → OUT (logout) → green 2×
 *   2nd tap < 15 min → REJECTED    → red 3× fast
 *   Unknown tag                    → red 1×
 *   No login by 10:00 IST          → server marks "missed IN"
 *   No logout by 18:00 IST         → server marks "missed OUT"
 * =============================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <time.h>

// ── Pins ──────────────────────────────────────────────────────────────────────
#define SS_PIN      5
#define RST_PIN     22
#define LED_GREEN   12
#define LED_RED     14
#define PROV_BTN    4     // provisioning button — hold to enter setup mode

// ── Config ───────────────────────────────────────────────────────────────────
const char* SERVER_URL  = "https://lyracore.lyraenterprise.co.in/api/attendance/scan";
const char* DEVICE_ID   = "ESP32-RFID-01";
const char* AP_SSID     = "LyraCore-Setup";   // provisioning hotspot name
const char* AP_PASSWORD = "";                  // open network (no password)
const char* NTP_SERVER  = "pool.ntp.org";
const long  GMT_OFFSET  = 19800;               // IST = UTC+5:30 = 19800 sec
const int   DST_OFFSET  = 0;

// ── Globals ───────────────────────────────────────────────────────────────────
MFRC522     rfid(SS_PIN, RST_PIN);
WebServer   server(80);
Preferences prefs;
bool        provMode   = false;
bool        timesynced = false;

// ── LED helpers ───────────────────────────────────────────────────────────────
void flashLED(int pin, int times, int onMs = 150, int offMs = 80) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH); delay(onMs);
    digitalWrite(pin, LOW);
    if (i < times - 1) delay(offMs);
  }
}

void altBlink(int times = 3) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_GREEN, HIGH); delay(200); digitalWrite(LED_GREEN, LOW);
    delay(50);
    digitalWrite(LED_RED,   HIGH); delay(200); digitalWrite(LED_RED,   LOW);
    delay(50);
  }
}

// ── RFID UID helper ───────────────────────────────────────────────────────────
String uidToString(MFRC522::Uid uid) {
  String s = "";
  for (byte i = 0; i < uid.size; i++) {
    if (uid.uidByte[i] < 0x10) s += "0";
    s += String(uid.uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

// ── NTP sync ──────────────────────────────────────────────────────────────────
void syncTime() {
  configTime(GMT_OFFSET, DST_OFFSET, NTP_SERVER);
  Serial.print("Syncing time");
  struct tm t;
  for (int i = 0; i < 20; i++) {
    if (getLocalTime(&t)) {
      timesynced = true;
      Serial.printf("\nTime synced: %04d-%02d-%02d %02d:%02d:%02d IST\n",
        t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
        t.tm_hour, t.tm_min, t.tm_sec);
      return;
    }
    delay(500); Serial.print(".");
  }
  Serial.println("\nTime sync failed (will retry)");
}

// =============================================================================
//  PROVISIONING WEB SERVER
// =============================================================================

void handleRoot() {
  String html = R"HTMLSTART(<!DOCTYPE html>
<html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>LyraCore WiFi Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;
     min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#1e293b;border-radius:16px;padding:28px 24px;
      width:100%;max-width:380px;box-shadow:0 20px 60px #0005}
h2{font-size:20px;font-weight:700;margin-bottom:4px}
p.sub{color:#94a3b8;font-size:13px;margin-bottom:20px}
label{display:block;font-size:12px;font-weight:600;color:#94a3b8;
      text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}
input,select{width:100%;padding:10px 12px;background:#0f172a;
             border:1px solid #334155;border-radius:8px;
             color:#f1f5f9;font-size:14px;margin-bottom:14px;outline:none}
input:focus,select:focus{border-color:#3b82f6}
button{width:100%;padding:11px;background:#3b82f6;color:#fff;border:none;
       border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
button:hover{background:#2563eb}
button.sec{background:#334155;margin-top:10px}
button.sec:hover{background:#475569}
#status{margin-top:14px;padding:10px 12px;border-radius:8px;font-size:13px;
        text-align:center;display:none}
.ok{background:#14532d;color:#86efac}
.err{background:#7f1d1d;color:#fca5a5}
.info{background:#1e3a5f;color:#93c5fd}
.net{display:flex;justify-content:space-between;align-items:center;
     padding:9px 12px;background:#0f172a;border:1px solid #334155;
     border-radius:8px;margin-bottom:7px;cursor:pointer;transition:.15s}
.net:hover{border-color:#3b82f6;background:#1e3a5f}
.net .ssid{font-size:14px;font-weight:500}
.net .rssi{font-size:11px;color:#64748b}
.net .lock{font-size:11px;color:#64748b;margin-left:6px}
.spinner{display:inline-block;width:16px;height:16px;
         border:2px solid #334155;border-top-color:#3b82f6;
         border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class='card'>
<h2>&#x1F4F6; LyraCore WiFi Setup</h2>
<p class='sub'>Connect your RFID reader to the internet</p>
<div id='netlist'>
  <div style='text-align:center;padding:20px'>
    <div class='spinner'></div>
  </div>
</div>
<button class='sec' onclick='scanNets()'>&#x21BB; Rescan Networks</button>
<form onsubmit='doConnect(event)' style='margin-top:18px'>
  <div id='pwdbox' style='display:none'>
    <label>Selected Network</label>
    <input id='ssid' name='ssid' readonly style='color:#94a3b8'>
    <label>Password</label>
    <input id='pwd' name='pwd' type='password' placeholder='Enter WiFi password'>
  </div>
  <button type='submit'>&#x1F517; Connect</button>
</form>
<div id='status'></div>
<script>
function showStatus(msg,type){
  var s=document.getElementById('status');
  s.className=type;s.innerText=msg;s.style.display='block';
}
function selectNet(ssid){
  document.getElementById('ssid').value=ssid;
  document.getElementById('pwdbox').style.display='block';
  document.getElementById('pwd').focus();
}
function scanNets(){
  var c=document.getElementById('netlist');
  c.innerHTML='<div style="text-align:center;padding:20px"><div class=spinner></div><p style="margin-top:8px;color:#64748b;font-size:13px">Scanning...</p></div>';
  fetch('/scan').then(function(r){return r.json();}).then(function(nets){
    if(!nets.length){
      c.innerHTML='<p style="color:#64748b;font-size:13px;text-align:center;padding:12px">No networks found. <a href="#" onclick="scanNets();return false" style="color:#3b82f6">Retry</a></p>';
      return;
    }
    c.innerHTML='';
    nets.forEach(function(n){
      var d=document.createElement('div');
      d.className='net';
      var bars=n.rssi>-60?'&#x2582;&#x2584;&#x2586;&#x2588;':n.rssi>-75?'&#x2582;&#x2584;&#x2586;_':n.rssi>-85?'&#x2582;&#x2584;__':'&#x2582;___';
      d.innerHTML='<span class=ssid>'+n.ssid+'</span><span><span class=rssi>'+bars+'</span>'+(n.enc?'<span class=lock>&#x1F512;</span>':'')+'</span>';
      d.onclick=function(){selectNet(n.ssid);};
      c.appendChild(d);
    });
  }).catch(function(){
    c.innerHTML='<p style="color:#fca5a5;font-size:13px;text-align:center">Scan failed. <a href="#" onclick="scanNets();return false" style="color:#3b82f6">Retry</a></p>';
  });
}
function doConnect(e){
  e.preventDefault();
  var ssid=document.getElementById('ssid').value.trim();
  var pwd=document.getElementById('pwd').value;
  if(!ssid){showStatus('Select a network first','err');return;}
  showStatus('Connecting...','info');
  document.querySelector('button[type=submit]').disabled=true;
  fetch('/connect',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'ssid='+encodeURIComponent(ssid)+'&pwd='+encodeURIComponent(pwd)
  }).then(function(r){return r.json();}).then(function(d){
    if(d.ok){
      showStatus('Connected! IP: '+d.ip+' — Device will restart in 3s...','ok');
    } else {
      showStatus('Failed to connect. Check the password and try again.','err');
      document.querySelector('button[type=submit]').disabled=false;
    }
  }).catch(function(){
    showStatus('Error — please try again','err');
    document.querySelector('button[type=submit]').disabled=false;
  });
}
window.onload=scanNets;
</script>
</div></body></html>)HTMLSTART";
  server.send(200, "text/html", html);
}

void handleScan() {
  int n = WiFi.scanNetworks();
  String json = "[";
  for (int i = 0; i < n; i++) {
    if (i) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\","
            "\"rssi\":" + String(WiFi.RSSI(i)) + ","
            "\"enc\":" + (WiFi.encryptionType(i) != WIFI_AUTH_OPEN ? "true" : "false") + "}";
  }
  json += "]";
  WiFi.scanDelete();
  server.send(200, "application/json", json);
}

void handleConnect() {
  if (!server.hasArg("ssid")) {
    server.send(400, "application/json", "{\"ok\":false}");
    return;
  }
  String ssid = server.arg("ssid");
  String pwd  = server.arg("pwd");

  Serial.printf("Provisioning: connecting to '%s'...\n", ssid.c_str());

  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(ssid.c_str(), pwd.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    digitalWrite(LED_GREEN, !digitalRead(LED_GREEN));
    delay(300);
  }
  digitalWrite(LED_GREEN, LOW);

  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    Serial.printf("Connected! IP: %s\n", ip.c_str());

    prefs.begin("wifi", false);
    prefs.putString("ssid", ssid);
    prefs.putString("pwd",  pwd);
    prefs.end();

    server.send(200, "application/json", "{\"ok\":true,\"ip\":\"" + ip + "\"}");
    flashLED(LED_GREEN, 3, 200);
    delay(3000);
    ESP.restart();
  } else {
    Serial.println("Connection failed.");
    flashLED(LED_RED, 3, 100, 60);
    server.send(200, "application/json", "{\"ok\":false}");
    WiFi.mode(WIFI_AP);
  }
}

// ── Enter provisioning mode ───────────────────────────────────────────────────
void startProvisioningMode() {
  provMode = true;
  Serial.println("\n[PROV] Starting provisioning hotspot...");

  WiFi.disconnect(true);
  delay(200);
  WiFi.mode(WIFI_AP);
  bool ok = WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.printf("[PROV] AP %s  IP: %s\n",
    ok ? "OK" : "FAILED",
    WiFi.softAPIP().toString().c_str());

  server.on("/",        handleRoot);
  server.on("/scan",    handleScan);
  server.on("/connect", HTTP_POST, handleConnect);
  server.onNotFound([]() {
    server.sendHeader("Location", "http://192.168.4.1", true);
    server.send(302, "text/plain", "");
  });
  server.begin();
  Serial.println("[PROV] Web server started.");
  Serial.println("[PROV] Connect to 'LyraCore-Setup' → open 192.168.4.1");
}

// ── Normal WiFi connect using saved credentials ───────────────────────────────
bool connectSavedWiFi() {
  prefs.begin("wifi", true);
  String ssid = prefs.getString("ssid", "");
  String pwd  = prefs.getString("pwd",  "");
  prefs.end();

  if (ssid.isEmpty()) {
    Serial.println("No saved WiFi credentials.");
    return false;
  }

  Serial.printf("Connecting to saved WiFi: %s", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pwd.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500); Serial.print(".");
    digitalWrite(LED_GREEN, !digitalRead(LED_GREEN));
  }
  digitalWrite(LED_GREEN, LOW);

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  Serial.println("\nFailed to connect to saved WiFi.");
  return false;
}

// =============================================================================
//  SETUP
// =============================================================================
void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();

  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED,   OUTPUT);
  pinMode(PROV_BTN,  INPUT_PULLUP);

  altBlink(1);

  // Check if provisioning button held at boot
  if (digitalRead(PROV_BTN) == LOW) {
    altBlink(2);
    startProvisioningMode();
    return;
  }

  // Try connecting with saved WiFi credentials
  bool connected = connectSavedWiFi();
  if (!connected) {
    Serial.println("No WiFi — entering provisioning mode automatically.");
    altBlink(3);
    startProvisioningMode();
    return;
  }

  // Sync time via NTP (IST)
  syncTime();

  flashLED(LED_GREEN, 3, 150, 80);
  Serial.println("Ready. Scan RFID card...");
}

// =============================================================================
//  MAIN LOOP
// =============================================================================
void loop() {

  // ── Provisioning mode: handle web server + slow LED blink ──────────────────
  if (provMode) {
    server.handleClient();
    static unsigned long lastBlink = 0;
    static bool blinkState = false;
    if (millis() - lastBlink > 800) {
      lastBlink = millis();
      blinkState = !blinkState;
      digitalWrite(LED_GREEN, blinkState);
      digitalWrite(LED_RED,   !blinkState);
    }
    return;
  }

  // ── PROV button pressed during normal operation ────────────────────────────
  if (digitalRead(PROV_BTN) == LOW) {
    delay(50);
    if (digitalRead(PROV_BTN) == LOW) {
      Serial.println("Provisioning button pressed — entering setup mode...");
      altBlink(3);
      startProvisioningMode();
      return;
    }
  }

  // ── Reconnect if WiFi dropped ──────────────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting...");
    WiFi.reconnect();
    delay(3000);
    if (WiFi.status() != WL_CONNECTED) {
      flashLED(LED_RED, 2, 200);
      return;
    }
    syncTime();
  }

  // ── Retry NTP if not yet synced ────────────────────────────────────────────
  if (!timesynced) syncTime();

  // ── RFID scan ─────────────────────────────────────────────────────────────
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    delay(100);
    return;
  }

  String uid = uidToString(rfid.uid);
  Serial.printf("Card: %s\n", uid.c_str());

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["tag_uid"]   = uid;
  doc["device_id"] = DEVICE_ID;
  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  if (httpCode == 200 || httpCode == 201) {
    String resp = http.getString();
    Serial.println(resp);

    StaticJsonDocument<512> r;
    DeserializationError err = deserializeJson(r, resp);

    if (!err) {
      bool rejected = r["rejected"] | false;
      bool success  = r["success"]  | false;

      if (rejected) {
        int mins = r["minutes_since_login"] | 0;
        Serial.printf("REJECTED — %d min since login (<15)\n", mins);
        flashLED(LED_RED, 3, 80, 60);

      } else if (success) {
        const char* scanType = r["scan_type"] | "?";
        Serial.printf("OK | %s | %s\n",
          (const char*)(r["employee_name"] | "?"), scanType);
        if (String(scanType) == "IN") {
          flashLED(LED_GREEN, 3, 200, 80);
        } else {
          flashLED(LED_GREEN, 2, 200, 80);
        }
      } else {
        flashLED(LED_RED, 2, 150);
      }

    } else {
      flashLED(LED_RED, 1, 500);
    }

  } else if (httpCode == 404) {
    Serial.printf("Unknown tag: %s\n", uid.c_str());
    flashLED(LED_RED, 1, 400);

  } else {
    Serial.printf("HTTP error: %d\n", httpCode);
    digitalWrite(LED_RED, HIGH); delay(800); digitalWrite(LED_RED, LOW);
  }

  http.end();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(2000);
}
'''

out_path = os.path.join(os.path.dirname(__file__), 'attendance_rfid', 'attendance_rfid.ino')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(content)
print(f"Written: {out_path} ({len(content)} bytes)")
