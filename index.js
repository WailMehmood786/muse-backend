const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'wail_muse_secure_key_786';

// --- AUTH MIDDLEWARE ---
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
        const user = await prisma.user.create({ 
            data: { email: email.toLowerCase().trim(), password: hashedPassword, name } 
        });
        res.status(201).json({ message: "Account created!", id: user.id, name: user.name });
    } catch (err) { 
        console.error("Signup Error:", err);
        res.status(500).json({ error: "Signup failed. User might already exist." }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "Invalid credentials." });
        }
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, name: user.name, id: user.id });
    } catch (err) { 
        console.error("Login Error:", err);
        res.status(500).json({ error: "Server error." }); 
    }
});

app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: "Token is required." });

        const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const googleData = await googleRes.json();

        if (!googleData.email) return res.status(400).json({ error: "Invalid Google Token." });

        const { email, name } = googleData;
        let user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

        if (!user) {
            const randomPassword = Math.random().toString(36).slice(-10) + "A1!"; 
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            user = await prisma.user.create({
                data: { email: email.toLowerCase(), password: hashedPassword, name: name || "Google User" }
            });
        }

        const jwtToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: jwtToken, name: user.name, id: user.id });
    } catch (error) {
        console.error("Google Auth Error:", error);
        res.status(500).json({ error: "Google Authentication failed." });
    }
});

// --- SESSION ROUTES ---
app.get('/api/sessions/:userId', async (req, res) => {
    try {
        const sessions = await prisma.chat.findMany({
            where: { userId: req.params.userId, role: "user" },
            distinct: ['sessionId'], 
            orderBy: { createdAt: 'desc' },
            select: { sessionId: true, content: true, createdAt: true }
        });
        res.json(sessions || []); 
    } catch (error) { 
        console.error("Session Fetch Error:", error);
        res.status(500).json({ error: "Fetch failed." }); 
    }
});

app.delete('/api/sessions/:sessionId', async (req, res) => {
    try {
        await prisma.chat.deleteMany({ where: { sessionId: req.params.sessionId } });
        res.status(200).json({ message: "Deleted." });
    } catch (error) { res.status(500).json({ error: "Delete failed." }); }
});

app.get('/api/history/:sessionId', async (req, res) => {
    try {
        const chats = await prisma.chat.findMany({
            where: { sessionId: req.params.sessionId },
            orderBy: { createdAt: 'asc' }
        });
        res.json(chats || []);
    } catch (error) { res.status(500).json({ error: "Failed to load history." }); }
});

// --- MAIN CHAT AI ROUTE ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId, history, sessionId, mode } = req.body;
        
        if (!message) return res.status(400).json({ error: "Message is empty." });

        const currentSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const writingMode = mode || "Creative";

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            systemInstruction: `You are an elite professional ghostwriter. Interview the user and write their book.
            DUAL-RESPONSE: Always use [START_DRAFT] and [END_DRAFT] for book content.
            Capture user's voice in ${writingMode} style. Ask only ONE sensory question at a time. English only.`
        });

        // Refined History Formatting
        const formattedHistory = (history || [])
            .filter(h => h.text && h.text.trim() !== "")
            .map(h => ({
                role: h.role === 'user' ? 'user' : 'model',
                parts: [{ text: h.text }]
            }));

        const chat = model.startChat({ history: formattedHistory });
        const result = await chat.sendMessage(message);
        const reply = await result.response.text();

        // Database save logic
        if (userId) {
            try {
                await prisma.chat.createMany({
                    data: [
                        { content: message, role: 'user', userId, sessionId: currentSessionId },
                        { content: reply, role: 'ai', userId, sessionId: currentSessionId }
                    ]
                });
            } catch (dbErr) {
                console.error("Prisma Save Error:", dbErr);
                // We don't stop the response if DB fails, but we log it
            }
        }

        res.json({ reply, sessionId: currentSessionId });
    } catch (error) { 
        console.error("GEMINI API ERROR:", error);
        res.status(500).json({ error: "Muse is taking a break.", details: error.message }); 
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Muse Server live on port ${PORT}`));