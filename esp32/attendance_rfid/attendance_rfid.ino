/**
 * LyraCore Attendance — ESP32 + MFRC522 RFID Reader
 * =============================================================
 * Wiring (SPI):
 *   MFRC522 Pin  →  ESP32 Pin
 *   SDA (SS)     →  GPIO 5
 *   SCK          →  GPIO 18
 *   MOSI         →  GPIO 23
 *   MISO         →  GPIO 19
 *   RST          →  GPIO 22
 *   3.3V         →  3.3V
 *   GND          →  GND
 *
 * LEDs (no buzzer):
 *   Green LED    →  GPIO 12  (accepted)
 *   Red   LED    →  GPIO 14  (rejected / error)
 *
 * Provisioning button → GPIO 27
 *   Hold on boot (or press anytime) → starts WiFi setup AP
 *   Connect to "LyraCore-Setup" → open 192.168.4.1 → pick SSID + password
 *
 * Required Libraries (Arduino Library Manager):
 *   - MFRC522  by GithubCommunity
 *   - ArduinoJson
 *
 * Rules enforced on the BACKEND (not here):
 *   1st tap → IN (login)
 *   2nd tap ≥15 min after IN → OUT (logout)
 *   2nd tap  <15 min after IN → rejected (red LED)
 *   No login by 10AM → backend marks "failed to login"
 *   No logout by 6PM → backend marks "failed to logout"
 * =============================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <time.h>

// ── Pin definitions ────────────────────────────────────────────────────────────
#define SS_PIN         5
#define RST_PIN        22
#define LED_GREEN      12
#define LED_RED        14
#define PROV_BUTTON    27   // hold on boot → provisioning mode

// ── Configuration ──────────────────────────────────────────────────────────────
const char* AP_SSID      = "LyraCore-Setup";
const char* AP_PASS      = "";                // open network (no password for easy setup)
const char* SERVER_URL   = "https://lyracore.lyraenterprise.co.in/api/attendance/scan";
const char* DEVICE_ID    = "ESP32-RFID-01";
const char* NTP_SERVER   = "pool.ntp.org";
const long  GMT_OFFSET   = 19800;            // IST = UTC+5:30 = 19800 sec
const int   DAYLIGHT     = 0;

// ── Globals ───────────────────────────────────────────────────────────────────
MFRC522    rfid(SS_PIN, RST_PIN);
Preferences prefs;
WebServer   webServer(80);
DNSServer   dnsServer;

bool wifiConnected = false;

// ── LED helpers ────────────────────────────────────────────────────────────────
void ledOn(int pin)  { digitalWrite(pin, HIGH); }
void ledOff(int pin) { digitalWrite(pin, LOW);  }

void flashLED(int pin, int times, int onMs = 200, int offMs = 100) {
  for (int i = 0; i < times; i++) {
    ledOn(pin);  delay(onMs);
    ledOff(pin); if (i < times - 1) delay(offMs);
  }
}

void ledAccepted()  { flashLED(LED_GREEN, 3, 200, 100); }  // 3x green
void ledLogout()    { flashLED(LED_GREEN, 2, 300, 100); }  // 2x green (longer)
void ledRejected()  { flashLED(LED_RED,   4, 80,  60);  }  // 4x red fast
void ledError()     { ledOn(LED_RED); delay(1000); ledOff(LED_RED); }
void ledUnknown()   { flashLED(LED_RED, 1, 500); }

// ── RFID helper ────────────────────────────────────────────────────────────────
String uidToString(MFRC522::Uid uid) {
  String s = "";
  for (byte i = 0; i < uid.size; i++) {
    if (uid.uidByte[i] < 0x10) s += "0";
    s += String(uid.uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

// ── WiFi connect from saved credentials ───────────────────────────────────────
bool connectFromPrefs() {
  prefs.begin("wifi", true);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  prefs.end();

  if (ssid.isEmpty()) {
    Serial.println("No saved WiFi credentials.");
    return false;
  }

  Serial.printf("Connecting to %s ...", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(300); Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());
    // Sync time via NTP
    configTime(GMT_OFFSET, DAYLIGHT, NTP_SERVER);
    struct tm ti;
    if (getLocalTime(&ti, 5000)) {
      Serial.printf("Time synced: %02d:%02d:%02d IST\n", ti.tm_hour, ti.tm_min, ti.tm_sec);
      // Blink green once to indicate ready
      flashLED(LED_GREEN, 1, 500);
    }
    return true;
  }

  Serial.println("\nFailed to connect.");
  flashLED(LED_RED, 2);
  return false;
}

// ── HTML helpers for provisioning portal ──────────────────────────────────────
String htmlHeader(const String& title) {
  return "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
         "<meta name='viewport' content='width=device-width,initial-scale=1'>"
         "<title>" + title + "</title>"
         "<style>"
         "body{font-family:sans-serif;background:#f0f4ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}"
         ".card{background:#fff;border-radius:12px;padding:28px 24px;max-width:360px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.1)}"
         "h2{margin:0 0 20px;color:#1e40af;font-size:1.2rem}"
         "label{display:block;font-size:.8rem;font-weight:600;color:#374151;margin-bottom:4px}"
         "input,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:.95rem;margin-bottom:14px}"
         "button{width:100%;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer}"
         "button:hover{background:#1d4ed8}"
         ".note{font-size:.75rem;color:#6b7280;margin-top:14px;text-align:center}"
         "</style></head><body><div class='card'>";
}
String htmlFooter() { return "</div></body></html>"; }

// ── Provisioning portal routes ─────────────────────────────────────────────────
void handleRoot() {
  // Scan networks
  int n = WiFi.scanNetworks();
  String opts = "";
  for (int i = 0; i < n; i++) {
    String enc = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? " (Open)" : "";
    opts += "<option value='" + WiFi.SSID(i) + "'>" + WiFi.SSID(i) + " (" + String(WiFi.RSSI(i)) + " dBm)" + enc + "</option>";
  }

  String html = htmlHeader("LyraCore WiFi Setup")
    + "<h2>LyraCore WiFi Setup</h2>"
    + "<form method='POST' action='/connect'>"
    + "<label>Select Network</label>"
    + "<select name='ssid'>" + opts + "</select>"
    + "<label>Password</label>"
    + "<input type='password' name='pass' placeholder='Leave blank if open network'>"
    + "<button type='submit'>Connect</button>"
    + "</form>"
    + "<p class='note'>After connecting, the device will restart and sync time automatically.</p>"
    + htmlFooter();

  webServer.send(200, "text/html", html);
}

void handleConnect() {
  String ssid = webServer.arg("ssid");
  String pass = webServer.arg("pass");

  String html = htmlHeader("Connecting...")
    + "<h2>Connecting to " + ssid + "</h2>"
    + "<p style='color:#374151'>Please wait... The device will restart and connect to your network.</p>"
    + "<p style='color:#6b7280;font-size:.8rem'>If it fails, hold the setup button again to retry.</p>"
    + htmlFooter();
  webServer.send(200, "text/html", html);
  delay(500);

  // Save credentials
  prefs.begin("wifi", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();

  Serial.printf("Saved credentials for: %s\nRestarting...\n", ssid.c_str());
  delay(1000);
  ESP.restart();
}

void handleNotFound() {
  webServer.sendHeader("Location", "http://192.168.4.1", true);
  webServer.send(302, "text/plain", "");
}

// ── Start provisioning AP ──────────────────────────────────────────────────────
void startProvisioningMode() {
  Serial.println("Entering provisioning mode...");
  // Slow-blink red to indicate AP mode
  for (int i = 0; i < 3; i++) { flashLED(LED_RED, 1, 300); delay(300); }

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  delay(200);

  IPAddress apIP(192, 168, 4, 1);
  Serial.printf("AP started: %s  →  http://192.168.4.1\n", AP_SSID);

  // DNS catch-all → redirect all domains to portal
  dnsServer.start(53, "*", apIP);

  webServer.on("/", HTTP_GET,  handleRoot);
  webServer.on("/connect", HTTP_POST, handleConnect);
  webServer.onNotFound(handleNotFound);
  webServer.begin();

  // Steady red until user configures
  ledOn(LED_RED);

  // Block here serving the portal
  while (true) {
    dnsServer.processNextRequest();
    webServer.handleClient();
    delay(2);
  }
}

// ── RFID scan → POST to backend ───────────────────────────────────────────────
void scanRFID() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  String uid = uidToString(rfid.uid);
  Serial.printf("Tag: %s\n", uid.c_str());
  ledOff(LED_GREEN); ledOff(LED_RED);

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost, reconnecting...");
    WiFi.reconnect();
    unsigned long t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < 8000) delay(300);
    if (WiFi.status() != WL_CONNECTED) { ledError(); goto done; }
  }

  {
    WiFiClientSecure client;
    client.setInsecure(); // Accept Let's Encrypt cert without pinning
    HTTPClient http;
    http.begin(client, SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(8000);

    StaticJsonDocument<128> doc;
    doc["tag_uid"]   = uid;
    doc["device_id"] = DEVICE_ID;
    String body;
    serializeJson(doc, body);

    int code = http.POST(body);
    Serial.printf("HTTP %d\n", code);

    if (code == 200) {
      StaticJsonDocument<256> resp;
      deserializeJson(resp, http.getString());
      const char* scanType = resp["scan_type"] | "IN";
      const char* empName  = resp["employee_name"] | "?";
      bool rejected        = resp["rejected"] | false;

      Serial.printf("  %s — %s\n", empName, scanType);

      if (rejected) {
        // Too soon after login (< 15 min) — red fast blink
        Serial.println("  REJECTED: too soon after login");
        ledRejected();
      } else if (strcmp(scanType, "IN") == 0) {
        ledAccepted();   // 3x green
      } else {
        ledLogout();     // 2x green (longer)
      }

    } else if (code == 404) {
      Serial.println("  Unknown tag");
      ledUnknown();
    } else {
      Serial.printf("  Server error %d\n", code);
      ledError();
    }

    http.end();
  }

done:
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(2000); // debounce
}

// ── Setup ──────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();

  pinMode(LED_GREEN,   OUTPUT);
  pinMode(LED_RED,     OUTPUT);
  pinMode(PROV_BUTTON, INPUT_PULLUP);

  ledOff(LED_GREEN);
  ledOff(LED_RED);

  // Check if provisioning button held at boot
  if (digitalRead(PROV_BUTTON) == LOW) {
    delay(80); // debounce
    if (digitalRead(PROV_BUTTON) == LOW) {
      startProvisioningMode(); // never returns
    }
  }

  // Normal boot: connect with saved credentials
  wifiConnected = connectFromPrefs();
  if (!wifiConnected) {
    // No creds saved or failed — prompt to use provisioning
    Serial.println("Hold the SETUP button to configure WiFi.");
    ledError();
  }

  Serial.println("RFID reader ready.");
}

// ── Loop ───────────────────────────────────────────────────────────────────────
void loop() {
  // Allow provisioning button press at any time (not just boot)
  if (digitalRead(PROV_BUTTON) == LOW) {
    delay(80);
    if (digitalRead(PROV_BUTTON) == LOW) {
      startProvisioningMode(); // never returns, ESP restarts after save
    }
  }

  if (wifiConnected) {
    scanRFID();
  }

  delay(50);
}