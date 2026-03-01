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

// --- MIDDLEWARE ---
// CORS ko update kiya hai taake Vercel frontend se asani se connect ho
app.use(cors({
  origin: '*', // Production mein isay apni frontend URL se replace kar sakte hain
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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

// --- ROUTES ---

// Health Check (Render/Vercel ki monitoring ke liye)
app.get('/', (req, res) => res.send("Muse API is running... 🚀"));

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) return res.status(400).json({ error: "All fields are required." });
        
        const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (existingUser) return res.status(400).json({ error: "Email already exists." });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({ 
            data: { email: email.toLowerCase(), password: hashedPassword, name } 
        });
        res.status(201).json({ message: "Account created!", id: user.id, name: user.name });
    } catch (err) { 
        console.error("Signup Error:", err);
        res.status(500).json({ error: "Signup failed." }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "Invalid credentials." });
        }
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, name: user.name, id: user.id });
    } catch (err) { res.status(500).json({ error: "Server error." }); }
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

app.get('/api/sessions/:userId', async (req, res) => {
    try {
        const sessions = await prisma.chat.findMany({
            where: { userId: req.params.userId, role: "user" },
            distinct: ['sessionId'], 
            orderBy: { createdAt: 'desc' },
            select: { sessionId: true, content: true, createdAt: true }
        });
        res.json(sessions || []); 
    } catch (error) { res.status(500).json({ error: "Fetch failed." }); }
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

app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId, history, sessionId, mode } = req.body;
        
        const currentSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const writingMode = mode || "Creative";

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            systemInstruction: `You are an elite professional ghostwriter creating a custom GPT experience. Your job is to interview the user and write their book for them from start to finish.
            
            FORMAT YOUR RESPONSE:
            [START_DRAFT] book content [END_DRAFT]
            Followed by your chat response.
            Mode: ${writingMode}`
        });

        const formattedHistory = (history || []).map(h => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.text }]
        }));

        const chat = model.startChat({ history: formattedHistory });
        const result = await chat.sendMessage(message);
        const reply = await result.response.text();

        if (userId) {
            await prisma.chat.createMany({
                data: [
                    { content: message, role: 'user', userId, sessionId: currentSessionId },
                    { content: reply, role: 'ai', userId, sessionId: currentSessionId }
                ]
            });
        }

        res.json({ reply, sessionId: currentSessionId });
    } catch (error) { 
        console.error("Chat Error:", error);
        res.status(500).json({ error: "Muse is taking a break." }); 
    }
});

// --- SERVER START ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Muse Server live on port ${PORT}`));