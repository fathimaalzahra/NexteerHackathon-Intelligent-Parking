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
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE"; // <-- IMPORTANT: Make sure this is correct

const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: "https://www.googleapis.com/auth/spreadsheets",
});

// --- In-Memory CACHE of static info ---
let parkingData = {
    kr_circle: { name: 'KR Circle', totalSlots: 100 },
    indiranagar: { name: 'Indiranagar', totalSlots: 80 },
    mg_road: { name: 'MG Road', totalSlots: 150 },
    koramangala: { name: 'Koramangala', totalSlots: 60 }
};

// --- Helper Function to Read from Google Sheets ---
async function getActiveBookingsFromSheet() {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: "v4", auth: client });

        console.log("Fetching latest data from Google Sheets...");
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "Bookings!A:H",
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return [];

        const header = rows[0];
        const data = rows.slice(1);
        const now = Date.now();

        const activeBookings = data.map(row => {
            let booking = {};
            header.forEach((key, index) => booking[key] = row[index]);
            return booking;
        }).filter(booking => {
            if (!booking.FreeAtTimestamp) return false;
            const freeAt = new Date(booking.FreeAtTimestamp).getTime();
            return freeAt > now;
        });
        
        console.log(`Found ${activeBookings.length} active bookings.`);
        return activeBookings;

    } catch (err) {
        console.error("CRITICAL ERROR reading from Google Sheets:", err.message);
        return [];
    }
}

// --- API Endpoints ---

// **MODIFIED:** /api/slots/:areaId now reads from Google Sheets
app.get('/api/slots/:areaId', async (req, res) => {
    const { areaId } = req.params;
    if (parkingData[areaId]) {
        const allActiveBookings = await getActiveBookingsFromSheet();
        
        const areaBookings = allActiveBookings
            .filter(b => b.Location === parkingData[areaId].name)
            .map(b => ({
                slotNumber: parseInt(b.SlotNumber),
                freeAt: new Date(b.FreeAtTimestamp).getTime(),
                bookedAt: new Date(b.BookingTimestamp).toLocaleString(),
                duration: b.DurationHours
            }));

        res.json({
            ...parkingData[areaId],
            booked: areaBookings
        });
    } else {
        res.status(404).json({ error: 'Area not found' });
    }
});

// --- This endpoint is used for the booking/payment flow ---
app.post('/api/verify-payment', async (req, res) => {
    const { order_id, payment_id, signature, bookingDetails } = req.body;
    const hmac = crypto.createHmac('sha26', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(order_id + "|" + payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature === signature) {
        // ... (This function remains unchanged from our last working version)
        console.log("Payment Verified Successfully.");

        const { areaId, slotNumber, duration, areaName, totalCost } = bookingDetails;
        const bookingId = "SP" + Math.random().toString(36).substr(2, 9).toUpperCase();
        const bookingTimestamp = Date.now();
        const durationInMs = duration * 60 * 60 * 1000;
        const freeAtTimestamp = bookingTimestamp + durationInMs;

        try {
            const sheetPayload = {
                bookingId, paymentId: payment_id, areaName, slotNumber,
                duration, totalCost, bookingTimestamp, freeAtTimestamp
            };
            await axios.post(process.env.GOOGLE_SCRIPT_URL, sheetPayload);
            console.log("Successfully logged booking to Google Sheets.");
        } catch (error) {
            console.error("Error logging to Google Sheets:", error.message);
        }

        res.json({ verified: true, paymentId: payment_id, bookingId: bookingId });

    } else {
        res.status(400).json({ verified: false });
    }
});

// (Other endpoints like create-order and locations remain unchanged)
app.post('/api/create-order', async (req, res) => { /* ... Keep this function as it is ... */ });
app.get('/api/locations', async (req, res) => {
    const allActiveBookings = await getActiveBookingsFromSheet();
    const locationsWithAvailability = Object.keys(parkingData).map(key => {
        const loc = parkingData[key];
        const bookedCount = allActiveBookings.filter(b => b.Location === loc.name).length;
        return {
            id: key,
            name: loc.name,
            total: loc.totalSlots,
            available: loc.totalSlots - bookedCount
        };
    });
    res.json(locationsWithAvailability);
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Backend server is running on http://localhost:${port}`);
});
// ... (keep all the other endpoints above this)

// --- NEW ENDPOINT FOR ESP32 ---
app.post('/api/update-slots-from-hardware', (req, res) => {
    const { areaId, slots } = req.body;
    // Example payload: { "areaId": "indiranagar", "slots": [{"slotNumber": 1, "status": "Busy"}, {"slotNumber": 2, "status": "Free"}] }

    if (!parkingData[areaId]) {
        console.log(`Received update for an unknown area: ${areaId}`);
        return res.status(404).json({ error: 'Area not found' });
    }

    console.log(`Received hardware update for ${areaId}:`, slots);

    // This is a complex problem: What if a car is present but the booking expired? Or booked but no car?
    // For a hackathon, we can simply log this. A real app would need complex logic.
    // We will NOT overwrite the booking data, as that is the "source of truth".
    // Instead, we can add a new property to our frontend data, like 'isOccupied'.

    // This is a placeholder for now. The data is received and logged.
    // In a more advanced setup, you would use WebSockets to push this update to the frontend.

    res.json({ success: true, message: "Hardware data received." });
});


// --- Start Server ---
app.listen(port, () => {
    // ...
});