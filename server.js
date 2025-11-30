const express = require('express');
const bodyParser = require('body-parser');
const Razorpay = require('razorpay');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- Google Sheets API Setup ---
const SPREADSHEET_ID = "1fNp73K5O1M4FqrLg4XyrgFUVOOEFdmKe8XJwD2VDyL4"; // Your ID is included

const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: "https://www.googleapis.com/auth/spreadsheets",
});

// --- Razorpay Instance ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- MERGED: Static Parking Area Info with Latitude/Longitude ---
let parkingData = {
    kr_circle: { name: 'KR Circle', totalSlots: 100, lat: 12.9740, lng: 77.5732 },
    indiranagar: { name: 'Indiranagar', totalSlots: 80, lat: 12.9719, lng: 77.6412 },
    mg_road: { name: 'MG Road', totalSlots: 150, lat: 12.9756, lng: 77.6060 },
    koramangala: { name: 'Koramangala', totalSlots: 60, lat: 12.9345, lng: 77.6180 }
};

// --- ================================================ ---
// ---            COMPLETE HELPER FUNCTIONS               ---
// --- ================================================ ---

async function getSheetData(range) {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: "v4", auth: client });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
        return response.data.values || [];
    } catch (err) {
        console.error(`CRITICAL ERROR reading from sheet range ${range}:`, err.message);
        throw err;
    }
}

async function getActiveAndFutureBookings() {
    const rows = await getSheetData("Bookings!A:L"); // Read all 12 columns for future-proofing
    if (rows.length <= 1) return [];
    const header = rows[0];
    const data = rows.slice(1);
    const now = Date.now();
    return data.map(row => {
        let booking = {};
        header.forEach((key, index) => booking[key] = row[index]);
        return booking;
    }).filter(booking => booking.BookingEndTime && new Date(booking.BookingEndTime).getTime() > now);
}

async function getPhysicalStatus() {
    const rows = await getSheetData("PhysicalStatus!A:B");
    if (rows.length <= 1) return [];
    return rows.slice(1).filter(row => row[1] && row[1].toLowerCase() === 'busy').map(row => parseInt(row[0]));
}

async function setGateCommand(command, bookingId = "") {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    console.log(`Setting gate command to: ${command}`);
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: "GateControl!B2:C2",
        valueInputOption: "USER_ENTERED", resource: { values: [[command, bookingId]] }
    });
}

async function getGateCommand(gateId) {
    const rows = await getSheetData("GateControl!A2:C2");
    if (rows && rows.length > 0 && rows[0][0] === gateId) return rows[0][1] || "NONE";
    return "NONE";
}

// --- ================================================ ---
// ---          COMPLETE API ENDPOINTS                    ---
// --- ================================================ ---

app.post('/api/gate-control', async (req, res) => {
    try {
        const { action, bookingId } = req.body;
        if (!bookingId || !action) {
            return res.status(400).json({ message: "Missing booking ID or action." });
        }
        const validationResponse = await axios.post(process.env.GOOGLE_SCRIPT_URL, {
            action: "validate_and_decrement_use",
            bookingId: bookingId
        });
        if (validationResponse.data.status === "success") {
            await setGateCommand('OPEN', bookingId);
            const message = action === 'entry' ? "Entry authorized. Gate is opening." : "Exit authorized. Thank you!";
            return res.json({ message: message });
        } else {
            return res.status(400).json({ message: "This ticket is not valid (already fully used or expired)." });
        }
    } catch (error) {
        console.error("Error in /api/gate-control:", error);
        if (error.response && error.response.data && error.response.data.message) {
            return res.status(400).json({ message: error.response.data.message });
        }
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

app.get('/api/get-gate-command', async (req, res) => {
    try {
        const { gateId } = req.query;
        if (!gateId) return res.status(400).json({ command: "NONE" });
        const command = await getGateCommand(gateId);
        if (command === "OPEN") await setGateCommand("NONE", "");
        res.json({ command });
    } catch (error) {
        console.error("Error in /api/get-gate-command:", error.message);
        res.status(500).json({ command: "NONE" });
    }
});

// MERGED: /api/locations endpoint with map data and cache control
app.get('/api/locations', async (req, res) => {
    try {
        // Prevent browser caching to always get fresh data
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const allFutureBookings = await getActiveAndFutureBookings();
        const now = Date.now();
        const locationsWithAvailability = Object.keys(parkingData).map(key => {
            const loc = parkingData[key];
            const currentlyBookedCount = allFutureBookings.filter(b => {
                const startTime = new Date(b.BookingStartTime).getTime();
                const endTime = new Date(b.BookingEndTime).getTime();
                return b.Location === loc.name && (startTime <= now && endTime > now);
            }).length;
            const availableSlots = loc.totalSlots - currentlyBookedCount;
            // Include lat and lng for the map
            return { id: key, name: loc.name, total: loc.totalSlots, available: availableSlots, lat: loc.lat, lng: loc.lng };
        });
        res.json(locationsWithAvailability);
    } catch (error) {
        console.error("Error in /api/locations:", error.message);
        res.status(500).json({ error: "Could not retrieve location data." });
    }
});

app.get('/api/slots/:areaId', async (req, res) => {
    try {
        const { areaId } = req.params;
        if (!parkingData[areaId]) return res.status(404).json({ error: 'Area not found' });
        const allFutureBookings = await getActiveAndFutureBookings();
        const physicallyOccupiedSlots = await getPhysicalStatus();
        const areaBookings = allFutureBookings
            .filter(b => b.Location === parkingData[areaId].name)
            .map(b => ({
                slotNumber: parseInt(b.SlotNumber),
                startTime: new Date(b.BookingStartTime).getTime(),
                endTime: new Date(b.BookingEndTime).getTime()
            }));
        res.json({ ...parkingData[areaId], bookings: areaBookings, physicallyOccupied: physicallyOccupiedSlots });
    } catch (error) {
        console.error("Error in /api/slots:", error.message);
        res.status(500).json({ error: "Could not retrieve slot data." });
    }
});

app.post('/api/verify-payment', async (req, res) => {
    try {
        const { order_id, payment_id, signature, bookingDetails } = req.body;
        const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
        hmac.update(order_id + "|" + payment_id);
        const generated_signature = hmac.digest('hex');
        if (generated_signature !== signature) {
            return res.status(400).json({ verified: false, message: "Payment verification failed." });
        }
        const { slotNumber, duration, areaName, totalCost, startTime } = bookingDetails;
        const newBookingId = "SP" + crypto.randomBytes(4).toString('hex').toUpperCase();
        const bookingStartTime = parseInt(startTime);
        const durationInMs = duration * 60 * 60 * 1000;
        const bookingEndTime = bookingStartTime + durationInMs;
        await axios.post(process.env.GOOGLE_SCRIPT_URL, {
            bookingId: newBookingId, paymentId: payment_id, areaName, slotNumber,
            duration, totalCost, bookingStartTime, bookingEndTime
        });
        return res.json({ verified: true, paymentId: payment_id, bookingId: newBookingId });
    } catch (error) {
        console.error("Error in /api/verify-payment:", error.message);
        res.status(500).json({ verified: false, message: "An internal server error occurred." });
    }
});

app.post('/api/create-order', async (req, res) => {
    try {
        const { amount, currency = "INR" } = req.body;
        if (!amount || amount <= 0) return res.status(400).send("Invalid amount");
        const options = { amount: amount * 100, currency, receipt: `receipt_${crypto.randomBytes(4).toString('hex')}` };
        const order = await razorpay.orders.create(options);
        res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
    } catch (error) {
        console.error("Error creating Razorpay order:", error);
        res.status(500).send("Error creating payment order");
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Backend server is running on http://localhost:${port}`);
});