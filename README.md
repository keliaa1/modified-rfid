# LINOGE - RFID Wallet System

A premium RFID-based wallet system integrated with a high-end fashion e-commerce storefront. This project combines embedded hardware (ESP8266) with a modern web backend and frontend to provide a seamless payment experience using RFID cards.

## 🌟 Features

- **RFID Integration**: Detect and process RFID cards for secure transactions.
- **Premium Fashion Storefront**: A sleek, modern UI for browsing luxury apparel.
- **Real-time Updates**: WebSocket and MQTT integration for instant balance and transaction status.
- **Admin Dashboard**: Manage products, monitor transactions, and oversee system status.
- **Persistent Storage**: Local SQLite database for reliable transaction logging and user balances.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, SQLite3, MQTT, WebSockets.
- **Frontend**: Vanilla HTML5, CSS3, JavaScript.
- **Hardware**: ESP8266 (Firmware developed in Arduino/C++).
- **Communication**: MQTT for device-to-server, WebSockets for server-to-client.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- [Mosquitto](https://mosquitto.org/) or any MQTT Broker
- RFID-RC522 Module with ESP8266

### Installation

1. **Clone the repository**:

   ```bash
   git clone <repository-url>
   cd RFID-MODIFIED
   ```

2. **Backend Setup**:
   - Navigate to the `backend` directory:
     ```bash
     cd backend
     ```
   - Install dependencies:
     ```bash
     npm install
     ```
   - Create a `.env` file in the `backend` folder:
     ```env
     PORT=9267
     MQTT_BROKER=mqtt://your-broker-url
     MQTT_PORT=1883
     TEAM_ID=your-team-id
     ```
   - Start the server:
     ```bash
     npm start
     ```

3. **Frontend Usage**:
   - Open `frontend/cashier.html` in your browser to access the store.
   - For administrative tasks, use `frontend/admin.html`.

4. **Hardware Setup**:
   - Flash the firmware located in `esp-8266/` to your ESP8266 device using the Arduino IDE.
   - Ensure the MQTT settings in the firmware match your server configuration.

## 📂 Project Structure

- `backend/`: Node.js Express server and SQLite database management.
- `frontend/`: Static web files (HTML, CSS, JS) for the user and admin interfaces.
- `esp-8266/`: C++ firmware for the RFID reader module.

## 📝 License

This project is for educational and development purposes.
