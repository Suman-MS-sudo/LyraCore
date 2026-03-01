/**
 * LyraCore Attendance — ESP32 + MFRC522 RFID Reader
 * =============================================================
 * Wiring (SPI):
 *   MFRC522 Pin  →  ESP32 Pin
 *   ─────────────────────────
 *   SDA (SS)     →  GPIO 5
 *   SCK          →  GPIO 18
 *   MOSI         →  GPIO 23
 *   MISO         →  GPIO 19
 *   RST          →  GPIO 22
 *   3.3V         →  3.3V
 *   GND          →  GND
 *
 * Optional:
 *   Buzzer       →  GPIO 13
 *   Green LED    →  GPIO 12  (IN)
 *   Red LED      →  GPIO 14  (OUT)
 *
 * Required Libraries (install via Arduino Library Manager):
 *   - MFRC522  by GithubCommunity
 *   - ArduinoJson
 *
 * Steps to get started:
 *   1. Flash this sketch to your ESP32.
 *   2. Open Serial Monitor at 115200 baud.
 *   3. Scan a new RFID card — copy the UID from Serial Monitor.
 *   4. Go to LyraCore → Attendance → Employees → Add Employee.
 *   5. Paste the UID into the "RFID Tag UID" field.
 * =============================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>

// ── Configuration ─────────────────────────────────────────────────────────────

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Backend URL — use local IP if ESP32 and server are on the same network
// e.g. "http://192.168.1.100:5000/api/attendance/scan"
const char* SERVER_URL    = "http://192.168.1.100:5000/api/attendance/scan";

const char* DEVICE_ID     = "ESP32-RFID-01";  // change per device

// ── Pin Definitions ───────────────────────────────────────────────────────────

#define SS_PIN    5
#define RST_PIN   22
#define BUZZER    13
#define LED_GREEN 12
#define LED_RED   14

MFRC522 rfid(SS_PIN, RST_PIN);

// ── Helpers ───────────────────────────────────────────────────────────────────

String uidToString(MFRC522::Uid uid) {
  String result = "";
  for (byte i = 0; i < uid.size; i++) {
    if (uid.uidByte[i] < 0x10) result += "0";
    result += String(uid.uidByte[i], HEX);
  }
  result.toUpperCase();
  return result;
}

void buzz(int times, int onMs = 100, int offMs = 80) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER, HIGH);
    delay(onMs);
    digitalWrite(BUZZER, LOW);
    if (i < times - 1) delay(offMs);
  }
}

void flashLED(int pin, int times = 2, int delayMs = 150) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH);
    delay(delayMs);
    digitalWrite(pin, LOW);
    if (i < times - 1) delay(80);
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();

  pinMode(BUZZER,    OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED,   OUTPUT);

  // Connect WiFi
  Serial.printf("\nConnecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());

  // Ready signal: 2 short beeps
  buzz(2);
  Serial.println("RFID reader ready. Scan a card...");
}

// ── Main Loop ──────────────────────────────────────────────────────────────────

void loop() {
  // Wait for card
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    delay(100);
    return;
  }

  String uid = uidToString(rfid.uid);
  Serial.printf("Card detected: %s\n", uid.c_str());

  // ── POST to backend ──────────────────────────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, reconnecting...");
    WiFi.reconnect();
    delay(3000);
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  // Build JSON body
  StaticJsonDocument<256> doc;
  doc["tag_uid"]   = uid;
  doc["device_id"] = DEVICE_ID;
  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  if (httpCode == 200 || httpCode == 201) {
    String response = http.getString();
    StaticJsonDocument<512> resp;
    deserializeJson(resp, response);

    const char* empName  = resp["employee_name"] | "Unknown";
    const char* scanType = resp["scan_type"]     | "??";

    Serial.printf("OK | %s | %s\n", empName, scanType);

    // Green for IN, Red for OUT
    if (String(scanType) == "IN") {
      buzz(1, 80);
      flashLED(LED_GREEN, 3);
    } else {
      buzz(2, 60, 60);
      flashLED(LED_RED, 2);
    }

  } else if (httpCode == 404) {
    Serial.printf("Unknown tag: %s\n", uid.c_str());
    // Fast triple beep for unknown tag
    buzz(3, 50, 50);
    flashLED(LED_RED, 1);

  } else {
    Serial.printf("Server error: HTTP %d\n", httpCode);
    buzz(1, 500);
  }

  http.end();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(2000);  // debounce — wait 2s before next scan
}
