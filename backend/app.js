const express = require("express");
const mqtt = require("mqtt");
const sqlite3 = require("sqlite3").verbose();
const WebSocket = require("ws");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs"); // Add this line
const path = require("path"); // Add this line
require("dotenv").config();

// Create database directory if it doesn't exist
const dbDir = path.join(__dirname, "database");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log("Created database directory");
}

const app = express();
const PORT = process.env.PORT || 3000;
const TEAM_ID = process.env.TEAM_ID || "keliateam"; // Your team ID

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// ==================== DATABASE SETUP ====================
const db = new sqlite3.Database("./database/wallet.db");

// Initialize database tables
db.serialize(() => {
  // Cards table
  db.run(`CREATE TABLE IF NOT EXISTS cards (
        uid TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Products table
  db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        price INTEGER
    )`);

  // Transaction ledger
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT,
        type TEXT CHECK(type IN ('TOPUP', 'PAYMENT')),
        amount INTEGER,
        previous_balance INTEGER,
        new_balance INTEGER,
        product_id INTEGER,
        quantity INTEGER,
        status TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(uid) REFERENCES cards(uid),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )`);

  // Insert sample products if none exist
  db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
    if (row.count === 0) {
      const products = [
        ["Double-Breasted Cashmere Coat", 245000],
        ["Silk Charmeuse Evening Gown", 185000],
        ["Hand-Burnished Leather Boots", 65000],
        ["Structured Wool Blazer", 120000],
        ["Raw Selvedge Denim Jeans", 45000],
        ["Fine-Gauge Merino Sweater", 35000],
      ];
      const stmt = db.prepare(
        "INSERT INTO products (name, price) VALUES (?, ?)",
      );
      products.forEach((p) => stmt.run(p[0], p[1]));
      stmt.finalize();
    }
  });
});

// ==================== MQTT SETUP ====================
const mqttClient = mqtt.connect(process.env.MQTT_BROKER, {
  port: process.env.MQTT_PORT,
  clientId: `backend_${TEAM_ID}_${Math.random().toString(16).substr(2, 8)}`,
});

// Base topics
const TOPICS = {
  CARD_STATUS: `rfid/${TEAM_ID}/card/status`,
  TOPUP_CMD: `rfid/${TEAM_ID}/card/topup`,
  PAY_CMD: `rfid/${TEAM_ID}/card/pay`,
  BALANCE_UPDATE: `rfid/${TEAM_ID}/card/balance`,
};

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");

  // Subscribe to card status updates
  mqttClient.subscribe(TOPICS.CARD_STATUS, (err) => {
    if (!err) {
      console.log(`Subscribed to ${TOPICS.CARD_STATUS}`);
    }
  });

  // Subscribe to balance updates from ESP8266
  mqttClient.subscribe(TOPICS.BALANCE_UPDATE, (err) => {
    if (!err) {
      console.log(`Subscribed to ${TOPICS.BALANCE_UPDATE}`);
    }
  });
});

// Handle incoming MQTT messages
mqttClient.on("message", (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log(`MQTT Message on ${topic}:`, data);

    if (topic === TOPICS.CARD_STATUS) {
      // Card detected, ensure it exists in database
      handleCardDetection(data);
      broadcastToWebSocket({
        type: "CARD_DETECTED",
        data,
      });
    } else if (topic === TOPICS.BALANCE_UPDATE) {
      // ESP8266 confirmed balance update, notify all clients via WebSocket
      broadcastToWebSocket({
        type: "BALANCE_UPDATE",
        data: data,
      });
    }
  } catch (error) {
    console.error("Error processing MQTT message:", error);
  }
});

// ==================== WEBSOCKET SETUP ====================
const wss = new WebSocket.Server({ noServer: true });

const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("New WebSocket client connected");

  ws.on("close", () => {
    clients.delete(ws);
  });
});

function broadcastToWebSocket(data) {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ==================== HELPER FUNCTIONS ====================
function handleCardDetection(data) {
  const { uid, balance } = data;

  // Check if card exists
  db.get("SELECT * FROM cards WHERE uid = ?", [uid], (err, row) => {
    if (err) {
      console.error("Database error:", err);
      return;
    }

    if (!row) {
      // New card - insert with balance from ESP8266
      db.run(
        "INSERT INTO cards (uid, balance) VALUES (?, ?)",
        [uid, balance || 0],
        (err) => {
          if (err) console.error("Error inserting new card:", err);
        },
      );
    }
  });
}

// ==================== SAFE WALLET UPDATE FUNCTION ====================
function safeWalletUpdate(uid, amount, type, productId = null, quantity = 1) {
  return new Promise((resolve, reject) => {
    // Start transaction
    db.run("BEGIN TRANSACTION", (err) => {
      if (err) {
        reject({ success: false, error: "Transaction start failed" });
        return;
      }

      // Get current balance with lock (SELECT ... FOR UPDATE equivalent in SQLite)
      db.get("SELECT balance FROM cards WHERE uid = ?", [uid], (err, card) => {
        if (err || !card) {
          db.run("ROLLBACK");
          reject({ success: false, error: "Card not found" });
          return;
        }

        const previousBalance = card.balance;
        let newBalance;
        let isValid = true;
        let message = "";

        if (type === "TOPUP") {
          newBalance = previousBalance + amount;
          message = "Top-up successful";
        } else if (type === "PAYMENT") {
          // Check if sufficient balance
          if (previousBalance >= amount) {
            newBalance = previousBalance - amount;
            message = "Payment successful";
          } else {
            isValid = false;
            message = "Insufficient balance";
          }
        }

        if (!isValid) {
          db.run("ROLLBACK");
          reject({
            success: false,
            error: message,
            previousBalance,
            required: amount,
            available: previousBalance,
          });
          return;
        }

        // Update balance
        db.run(
          "UPDATE cards SET balance = ? WHERE uid = ?",
          [newBalance, uid],
          (err) => {
            if (err) {
              db.run("ROLLBACK");
              reject({ success: false, error: "Balance update failed" });
              return;
            }

            // Record transaction
            db.run(
              `INSERT INTO transactions
                        (uid, type, amount, previous_balance, new_balance, product_id, quantity, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                uid,
                type,
                amount,
                previousBalance,
                newBalance,
                productId,
                quantity,
                "SUCCESS",
              ],
              function (err) {
                if (err) {
                  db.run("ROLLBACK");
                  reject({
                    success: false,
                    error: "Transaction record failed",
                  });
                  return;
                }

                // Commit transaction
                db.run("COMMIT", (err) => {
                  if (err) {
                    reject({ success: false, error: "Commit failed" });
                    return;
                  }

                  resolve({
                    success: true,
                    message,
                    previousBalance,
                    newBalance,
                    transactionId: this.lastID,
                  });
                });
              },
            );
          },
        );
      });
    });
  });
}

// ==================== HTTP ENDPOINTS ====================

// Get card info
app.get("/api/card/:uid", (req, res) => {
  db.get("SELECT * FROM cards WHERE uid = ?", [req.params.uid], (err, row) => {
    if (err || !row) {
      res.status(404).json({ error: "Card not found" });
    } else {
      res.json(row);
    }
  });
});

// Get all products
app.get("/api/products", (req, res) => {
  db.all("SELECT * FROM products", (err, rows) => {
    if (err) {
      res.status(500).json({ error: "Database error" });
    } else {
      res.json(rows);
    }
  });
});

// TOP-UP endpoint
app.post("/topup", async (req, res) => {
  const { uid, amount } = req.body;

  if (!uid || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    // Perform safe wallet update
    const result = await safeWalletUpdate(uid, amount, "TOPUP");

    // Send command to ESP8266 via MQTT
    mqttClient.publish(
      TOPICS.TOPUP_CMD,
      JSON.stringify({
        uid,
        amount,
        newBalance: result.newBalance,
        timestamp: new Date().toISOString(),
      }),
    );

    // Broadcast update via WebSocket
    broadcastToWebSocket({
      type: "TOPUP_COMPLETED",
      data: {
        uid,
        amount,
        previousBalance: result.previousBalance,
        newBalance: result.newBalance,
        timestamp: new Date().toISOString(),
      },
    });

    res.json(result);
  } catch (error) {
    res.status(400).json(error);
  }
});

// PAYMENT endpoint
app.post("/pay", async (req, res) => {
  const { uid, productId, quantity = 1 } = req.body;

  if (!uid || !productId) {
    return res.status(400).json({ error: "Invalid request" });
  }

  // Get product price
  db.get(
    "SELECT * FROM products WHERE id = ?",
    [productId],
    async (err, product) => {
      if (err || !product) {
        return res.status(404).json({ error: "Product not found" });
      }

      const totalAmount = product.price * quantity;

      try {
        // Perform safe wallet update
        const result = await safeWalletUpdate(
          uid,
          totalAmount,
          "PAYMENT",
          productId,
          quantity,
        );

        // Send command to ESP8266 via MQTT
        mqttClient.publish(
          TOPICS.PAY_CMD,
          JSON.stringify({
            uid,
            amount: totalAmount,
            product: product.name,
            newBalance: result.newBalance,
            timestamp: new Date().toISOString(),
          }),
        );

        // Broadcast update via WebSocket
        broadcastToWebSocket({
          type: "PAYMENT_COMPLETED",
          data: {
            uid,
            amount: totalAmount,
            product: product.name,
            previousBalance: result.previousBalance,
            newBalance: result.newBalance,
            timestamp: new Date().toISOString(),
          },
        });

        res.json(result);
      } catch (error) {
        res.status(400).json(error);
      }
    },
  );
});

// Get transaction history for a card
app.get("/api/transactions/:uid", (req, res) => {
  db.all(
    "SELECT * FROM transactions WHERE uid = ? ORDER BY timestamp DESC LIMIT 50",
    [req.params.uid],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: "Database error" });
      } else {
        res.json(rows);
      }
    },
  );
});

// ==================== SERVER STARTUP ====================
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Team ID: ${TEAM_ID}`);
});

// Upgrade HTTP server to handle WebSocket
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
