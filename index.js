const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

// --- Gemini Initialization ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey || "");

// --- CORS Configuration (IMPORTANT for Vercel) ---
app.use(cors({
  origin: ["https://muse-frontend-three.vercel.app", "http://localhost:3000"], // Frontend URL here
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'wail_muse_secure_key_786';

// --- HEALTH CHECK ---
app.get('/', (req, res) => {
    res.send("🚀 Muse Backend is Live and Running!");
});

// AI Test Route
app.get('/api/test-ai', async (req, res) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent("Hello, are you active?");
        res.json({ success: true, response: result.response.text() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Access denied." });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid token." });
        req.user = user;
        next();
    });
};

// Signup
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) return res.status(400).json({ error: "All fields are required." });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({ data: { email: email.toLowerCase(), password: hashedPassword, name } });
        res.status(201).json({ message: "Account created!", id: user.id, name: user.name });
    } catch (err) { res.status(500).json({ error: "Signup failed. Email might already exist." }); }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials." });
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, name: user.name, id: user.id });
    } catch (err) { res.status(500).json({ error: "Server error." }); }
});

// Google Auth
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const googleData = await googleRes.json();
        if (!googleData.email) return res.status(400).json({ error: "Invalid Google Token." });

        let user = await prisma.user.findUnique({ where: { email: googleData.email.toLowerCase() } });
        if (!user) {
            const randomPass = Math.random().toString(36).slice(-10);
            user = await prisma.user.create({
                data: { email: googleData.email.toLowerCase(), password: await bcrypt.hash(randomPass, 10), name: googleData.name || "User" }
            });
        }
        const jwtToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: jwtToken, name: user.name, id: user.id });
    } catch (error) { res.status(500).json({ error: "Google Auth failed." }); }
});

// --- SESSION MANAGEMENT ---
app.get('/api/sessions/:userId', async (req, res) => {
    try {
        const sessions = await prisma.chat.findMany({
            where: { userId: req.params.userId },
            distinct: ['sessionId'],
            orderBy: { createdAt: 'desc' },
            select: { sessionId: true, content: true, createdAt: true, role: true }
        });
        res.json(sessions);
    } catch (error) { res.status(500).json({ error: "Fetch failed." }); }
});

app.get('/api/history/:sessionId', async (req, res) => {
    try {
        const chats = await prisma.chat.findMany({
            where: { sessionId: req.params.sessionId },
            orderBy: { createdAt: 'asc' }
        });
        res.json(chats);
    } catch (error) { res.status(500).json({ error: "History failed." }); }
});

app.delete('/api/sessions/:sessionId', async (req, res) => {
    try {
        await prisma.chat.deleteMany({ where: { sessionId: req.params.sessionId } });
        res.json({ message: "Deleted." });
    } catch (error) { res.status(500).json({ error: "Delete failed." }); }
});

// --- MAIN AI CHAT ROUTE ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId, history, sessionId, mode } = req.body;
        if (!message) return res.status(400).json({ error: "Message required" });

        const currentSessionId = sessionId || `session_${Date.now()}`;
        const writingMode = mode || "Creative";

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            systemInstruction: `You are an elite professional ghostwriter. Interview the user to write their book. 
            Format book content between [START_DRAFT] and [END_DRAFT]. Style: ${writingMode}. Ask only ONE question at a time. Be very engaging.`
        });

        // Structure history for Gemini
        let finalHistory = [];
        if (history && history.length > 0) {
            let tempHistory = history
                .filter(h => h.text && h.text.trim() !== "")
                .map(h => ({
                    role: h.role === 'ai' || h.role === 'model' ? 'model' : 'user',
                    parts: [{ text: h.text }]
                }));

            // Merge consecutive messages with the same role
            tempHistory.forEach((msg, i) => {
                if (i > 0 && msg.role === finalHistory[finalHistory.length - 1].role) {
                    finalHistory[finalHistory.length - 1].parts[0].text += "\n" + msg.parts[0].text;
                } else {
                    finalHistory.push(msg);
                }
            });

            // Ensure starts with 'user' and ends with 'model'
            if (finalHistory.length > 0 && finalHistory[0].role !== 'user') finalHistory.shift();
            if (finalHistory.length > 0 && finalHistory[finalHistory.length - 1].role !== 'model') finalHistory.pop();
        }

        const chat = model.startChat({ history: finalHistory });
        const result = await chat.sendMessage(message);
        const reply = result.response.text();

        // Save to DB asynchronously (don't block response)
        if (userId) {
            prisma.chat.createMany({
                data: [
                    { content: message, role: 'user', userId, sessionId: currentSessionId },
                    { content: reply, role: 'ai', userId, sessionId: currentSessionId }
                ]
            }).catch(e => console.log("DB Skip:", e.message));
        }

        res.json({ reply, sessionId: currentSessionId });
    } catch (error) { 
        console.error("🔥 AI CHAT ERROR:", error.message);
        res.status(500).json({ error: "Muse is taking a break.", details: error.message }); 
    }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Muse Server live on port ${PORT}`);
});