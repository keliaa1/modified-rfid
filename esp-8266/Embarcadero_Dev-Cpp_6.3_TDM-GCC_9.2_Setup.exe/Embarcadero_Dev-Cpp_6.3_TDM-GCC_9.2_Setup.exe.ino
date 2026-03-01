#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <MFRC522.h>

// WiFi Configuration
const char* ssid = "EdNet";
const char* password = "Huawei@123";

// MQTT Configuration
const char* mqtt_server = "157.173.101.159";
const int mqtt_port = 1883;
const char* team_id = "keliateam";  // Change to your team ID

// MQTT Topics
String card_status_topic = String("rfid/") + team_id + "/card/status";
String topup_cmd_topic = String("rfid/") + team_id + "/card/topup";
String pay_cmd_topic = String("rfid/") + team_id + "/card/pay";
String balance_update_topic = String("rfid/") + team_id + "/card/balance";

// RFID Pins
#define SS_PIN D1  // SDA pin
#define RST_PIN D2

MFRC522 rfid(SS_PIN, RST_PIN);
WiFiClient espClient;
PubSubClient client(espClient);

// Store last card UID and balance
String lastUID = "";
int currentBalance = 0;
unsigned long lastCardRead = 0;
const unsigned long cardReadDelay = 2000; // Delay between reads

void setup() {
  Serial.begin(115200);
  
  // Initialize SPI
  SPI.begin();
  
  // Initialize RFID
  rfid.PCD_Init();
  
  // Connect to WiFi
  setup_wifi();
  
  // Set MQTT server
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("WiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  
  String message;
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.println(message);

  // Parse JSON message
  // Note: You'll need a JSON library for proper parsing
  // This is simplified for the example
  
  if (String(topic) == topup_cmd_topic) {
    // Handle top-up command
    Serial.println("Top-up command received");
    // Update display or buzzer for confirmation
  }
  else if (String(topic) == pay_cmd_topic) {
    // Handle payment command
    Serial.println("Payment command received");
    // Update display or buzzer for confirmation
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    
    String clientId = "ESP8266-";
    clientId += String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str())) {
      Serial.println("connected");
      
      // Subscribe to command topics
      client.subscribe(topup_cmd_topic.c_str());
      client.subscribe(pay_cmd_topic.c_str());
      
      Serial.println("Subscribed to:");
      Serial.println(topup_cmd_topic);
      Serial.println(pay_cmd_topic);
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

String readRFID() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    return "";
  }

  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  
  // Halt PICC
  rfid.PICC_HaltA();
  
  return uid;
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Check for new RFID card
  String uid = readRFID();
  
  if (uid.length() > 0 && uid != lastUID) {
    unsigned long now = millis();
    if (now - lastCardRead > cardReadDelay) {
      lastUID = uid;
      lastCardRead = now;
      
      Serial.print("Card detected: ");
      Serial.println(uid);
      
      // Publish card status
      String payload = "{\"uid\":\"" + uid + "\",\"balance\":" + String(currentBalance) + "}";
      client.publish(card_status_topic.c_str(), payload.c_str());
      Serial.println("Published to " + card_status_topic);
    }
  }

  delay(100);
}