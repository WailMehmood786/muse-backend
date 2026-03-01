const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const Groq = require('groq-sdk'); // Groq use karenge lightning speed ke liye
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

// --- Groq Initialization ---
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY, // Railway mein ye key dalni hai
});

// --- CORS Configuration ---
app.use(cors({
    origin: ["https://muse-frontend-three.vercel.app", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'WailMuse786SecureKey';

// --- HEALTH CHECK ---
app.get('/', (req, res) => {
    res.send("🚀 Muse Backend (Groq Ultra-Fast) is Online!");
});

// AI Test Route (Groq Version)
app.get('/api/test-ai', async (req, res) => {
    try {
        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "Hello, are you active?" }],
        });
        res.json({ success: true, response: completion.choices[0].message.content });
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

// --- AUTH ROUTES ---
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) return res.status(400).json({ error: "All fields are required." });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({ data: { email: email.toLowerCase(), password: hashedPassword, name } });
        res.status(201).json({ message: "Account created!", id: user.id, name: user.name });
    } catch (err) { res.status(500).json({ error: "Signup failed." }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials." });
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, name: user.name, id: user.id });
    } catch (err) { res.status(500).json({ error: "Server error." }); }
});

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
            user = await prisma.user.create({
                data: { email: googleData.email.toLowerCase(), password: await bcrypt.hash(Math.random().toString(), 10), name: googleData.name || "User" }
            });
        }
        const jwtToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: jwtToken, name: user.name, id: user.id });
    } catch (error) { res.status(500).json({ error: "Google Auth failed." }); }
});

// --- SESSION & HISTORY ---
app.get('/api/sessions/:userId', async (req, res) => {
    try {
        const sessions = await prisma.chat.findMany({
            where: { userId: req.params.userId },
            distinct: ['sessionId'],
            orderBy: { createdAt: 'desc' },
            select: { sessionId: true, content: true, createdAt: true }
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

// --- MAIN AI CHAT ROUTE (Groq Integration) ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId, history, sessionId, mode } = req.body;
        if (!message) return res.status(400).json({ error: "Message required" });

        const currentSessionId = sessionId || `session_${Date.now()}`;
        const writingMode = mode || "Creative";

        const systemPrompt = `You are Muse, an elite professional ghostwriter. 
        Interview the user to write their book. 
        Format book content between [START_DRAFT] and [END_DRAFT]. 
        Style: ${writingMode}. Ask only ONE question at a time. Be very engaging.`;

        let apiMessages = [{ role: "system", content: systemPrompt }];

        if (history && history.length > 0) {
            history.forEach(h => {
                if (h.text || h.content) {
                    apiMessages.push({
                        role: h.role === 'ai' || h.role === 'assistant' ? 'assistant' : 'user',
                        content: h.text || h.content
                    });
                }
            });
        }

        apiMessages.push({ role: "user", content: message });

        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: apiMessages,
            temperature: 0.7,
            max_tokens: 4096
        });

        const reply = completion.choices[0].message.content;

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
        console.error("🔥 GROQ ERROR:", error.message);
        res.status(500).json({ error: "Muse is exhausted.", details: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Muse Server (Groq) live on port ${PORT}`);
});