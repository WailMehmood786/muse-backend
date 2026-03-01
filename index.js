const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

// Safe Gemini Initialization
const apiKey = process.env.GEMINI_API_KEY || "DUMMY_KEY";
if (apiKey === "DUMMY_KEY") {
    console.error("❌ ERROR: GEMINI_API_KEY is missing in environment variables!");
}
const genAI = new GoogleGenerativeAI(apiKey);

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'wail_muse_secure_key_786';

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

// --- REGULAR AUTH ---
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

// --- GOOGLE AUTHENTICATION ROUTE ---
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
    } catch (error) { res.status(500).json({ error: "Google Authentication failed." }); }
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

// --- MAIN AI CHAT ROUTE (MASTER FIX) ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId, history, sessionId, mode } = req.body;
        if (!message) return res.status(400).json({ error: "Message is required" });

        const currentSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const writingMode = mode || "Creative";

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", // Stable Free Tier Model
            systemInstruction: `You are an elite professional ghostwriter creating a custom GPT experience. Your job is to interview the user and write their book for them from start to finish.
            CRITICAL DUAL-RESPONSE WORKFLOW:
            Every single time you have enough detail to write a piece of the book, you MUST separate the "Book Content" from the "Chat Conversation" using specific tags.
            FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
            [START_DRAFT]
            (Write the actual polished, beautifully crafted book paragraphs here, in the user's voice, matching the ${writingMode} style.)
            [END_DRAFT]
            (Write your friendly chat response and ask your NEXT specific interview question here, outside the tags.)
            STRICT RULES:
            1. VOICE: Capture the user's unique tone.
            2. DIG DEEPER: Ask for sensory details (smells, sounds, feelings).
            3. ONE QUESTION: Never ask multiple questions at once. Give them space to think.
            4. USE TAGS: ALWAYS wrap book content in [START_DRAFT] and [END_DRAFT].
            5. ONLY SPEAK ENGLISH.`
        });

        // --- ANTI-CRASH HISTORY FILTER ---
        let rawHistory = (history || [])
            .map(h => ({
                role: h.role === 'ai' || h.role === 'model' ? 'model' : 'user',
                text: h.text || ""
            }))
            .filter(h => h.text.trim() !== "");

        let validHistory = [];
        let lastRole = null;
        
        // Merge consecutive messages to strictly alternate user->model->user->model
        for (const msg of rawHistory) {
            if (msg.role !== lastRole) {
                validHistory.push({ role: msg.role, parts: [{ text: msg.text }] });
                lastRole = msg.role;
            } else {
                validHistory[validHistory.length - 1].parts[0].text += `\n\n${msg.text}`;
            }
        }

        // Gemini API throws an error if history ends with 'user' because sendMessage implies another 'user'
        if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
            validHistory.pop();
        }
        // ----------------------------------

        const chat = model.startChat({ history: validHistory });
        const result = await chat.sendMessage(message);
        const reply = result.response.text();

        if (userId) {
            await prisma.chat.createMany({
                data: [
                    { content: message, role: 'user', userId, sessionId: currentSessionId },
                    { content: reply, role: 'ai', userId, sessionId: currentSessionId }
                ]
            }).catch(e => console.error("DB Save Warning:", e));
        }

        res.json({ reply, sessionId: currentSessionId });
    } catch (error) { 
        console.error("🔥 AI CHAT ERROR:", error.message);
        res.status(500).json({ error: "Muse is taking a break.", details: error.message }); 
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Muse Server live on port ${PORT}`));