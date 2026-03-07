const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

// Initialize default publisher on startup
async function initializeDefaultPublisher() {
  try {
    const existingPublisher = await prisma.user.findUnique({
      where: { id: 'publisher_1' }
    });
    
    if (!existingPublisher) {
      await prisma.user.create({
        data: {
          id: 'publisher_1',
          email: 'publisher@muse.com',
          name: 'Publisher',
          role: 'publisher'
        }
      });
      console.log('✅ Default publisher created');
    }
  } catch (error) {
    console.error('Error initializing publisher:', error);
  }
}

initializeDefaultPublisher();

// Initialize Groq AI
let groq = null;
if (process.env.GROQ_API_KEY) {
  try {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    console.log('✅ Groq AI initialized');
  } catch (error) {
    console.error('❌ Groq initialization failed:', error.message);
  }
} else {
  console.log('⚠️  AI service not configured');
}

// Session & Passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'muse-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await prisma.user.findUnique({
        where: { googleId: profile.id }
      });
      
      if (!user) {
        user = await prisma.user.create({
          data: {
            googleId: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            avatar: profile.photos[0]?.value || null,
            role: 'publisher',
            lastLogin: new Date()
          }
        });
        console.log(`✅ New user: ${user.email}`);
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() }
        });
        console.log(`✅ User login: ${user.email}`);
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
  console.log('✅ Google OAuth configured');
}

// CORS
app.use(cors({
  origin: [
    "https://muse-frontend-three.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.send("🚀 Muse Backend Online!");
});

// ========== NATURAL CONVERSATIONAL INTERVIEWER ==========
const getInterviewerPrompt = (sport) => {
  const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);
  
  return `You are a warm, empathetic interviewer talking to a ${sportName} athlete about their life story for a book.

YOUR STYLE:
- Have a natural conversation like a friend
- React to what they say with empathy
- Ask follow-up questions based on their answers
- Keep responses conversational (10-15 words)
- Show genuine interest

CONVERSATION EXAMPLES:

User: "Hello"
You: "Hey! Thanks for sitting down with me. Where did you grow up?"

User: "I'm fine and you"
You: "I'm great! Let's dive in. Tell me about your childhood."

User: "I grew up in Texas"
You: "Texas! What was it like growing up there?"

User: "It was tough, we didn't have much money"
You: "That sounds challenging. How did that shape who you are today?"

User: "My dad left when I was young"
You: "I'm sorry to hear that. How old were you when he left?"

User: "I was 10"
You: "Ten years old... that must have been really hard. How did you cope?"

User: "I got into ${sportName}"
You: "Ah, ${sportName} became your outlet. What drew you to it?"

User: "My coach believed in me"
You: "That's powerful. What did your coach see in you that others didn't?"

User: "I made it to the pros"
You: "That's incredible! What went through your mind when you got the call?"

User: "I'm sharing my story"
You: "I'm here to listen. What's the most important part of your journey?"

QUESTION TYPES TO USE:

OPENING QUESTIONS:
- "Where did you grow up?"
- "What was your childhood like?"
- "When did you first discover ${sportName}?"

DEEP QUESTIONS:
- "What was your biggest challenge?"
- "How did that make you feel?"
- "What kept you going during tough times?"
- "Who believed in you when others didn't?"
- "What moment changed everything for you?"

FOLLOW-UP QUESTIONS:
- "Tell me more about that."
- "How did that shape you?"
- "What did you learn from that experience?"
- "What would you tell your younger self?"

RULES:
✅ Be conversational and natural
✅ React with empathy ("That's tough", "I hear you", "That's powerful")
✅ Ask ONE clear question per response
✅ Keep it 10-15 words
✅ Build on what they just said

❌ Don't just say one word like "Who?" or "How?"
❌ Don't ask about book structure or genre
❌ Don't be robotic or formal
❌ Don't ignore what they just told you

REMEMBER: You're having a real conversation, not interrogating. Listen, react, then ask.`;
};

// Auth Middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'muse-jwt-secret');
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ========== AUTH ROUTES ==========
app.post('/api/publisher/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    
    const correctPassword = process.env.PUBLISHER_PASSWORD;
    if (!correctPassword) return res.status(500).json({ error: 'Server config error' });
    
    if (password !== correctPassword) return res.status(401).json({ error: 'Invalid password' });
    
    const token = jwt.sign(
      { id: 'publisher_1', role: 'publisher', name: 'Publisher' },
      process.env.JWT_SECRET || 'muse-jwt-secret',
      { expiresIn: '24h' }
    );
    
    res.json({ 
      success: true, 
      token,
      user: { id: 'publisher_1', name: 'Publisher', role: 'publisher' }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/publisher/verify', verifyToken, (req, res) => {
  if (req.user.role !== 'publisher') return res.status(403).json({ error: 'Not authorized' });
  res.json({ 
    success: true, 
    user: { id: req.user.id, name: req.user.name, role: req.user.role }
  });
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'https://muse-frontend-three.vercel.app'}?error=auth_failed`,
    session: false 
  }),
  (req, res) => {
    try {
      const token = jwt.sign(
        { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role },
        process.env.JWT_SECRET || 'muse-jwt-secret',
        { expiresIn: '7d' }
      );
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://muse-frontend-three.vercel.app';
      res.redirect(`${frontendUrl}?token=${token}`);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://muse-frontend-three.vercel.app';
      res.redirect(`${frontendUrl}?error=token_failed`);
    }
  }
);

app.get('/api/me', verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json({ 
      success: true, 
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.post('/api/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ success: true, message: 'Logged out' });
  });
});

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
    
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ error: 'User exists' });
    
    const user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 10),
        name,
        role: 'publisher'
      }
    });
    
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET || 'muse-jwt-secret',
      { expiresIn: '7d' }
    );
    
    res.json({ 
      success: true, 
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) return res.status(401).json({ error: 'Invalid credentials' });
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });
    
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });
    
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET || 'muse-jwt-secret',
      { expiresIn: '7d' }
    );
    
    res.json({ 
      success: true, 
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ========== CLIENT ROUTES ==========
app.post('/api/clients', verifyToken, async (req, res) => {
  try {
    const { name, email, bookTitle, sport, publisherId } = req.body;
    if (!name || !email || !bookTitle) return res.status(400).json({ error: "All fields required" });
    
    const frontendUrl = process.env.FRONTEND_URL || 'https://muse-frontend-three.vercel.app';
    
    const client = await prisma.client.create({
      data: {
        name,
        email,
        bookTitle,
        sport: sport || 'baseball',
        uniqueLink: '', // Will update after creation
        publisherId: publisherId || req.user.id
      }
    });
    
    // Update with unique link
    const uniqueLink = `${frontendUrl}/interview/${client.id}?name=${encodeURIComponent(name)}&book=${encodeURIComponent(bookTitle)}&sport=${client.sport}`;
    const updatedClient = await prisma.client.update({
      where: { id: client.id },
      data: { uniqueLink }
    });
    
    console.log(`✅ Client created: ${name}`);
    res.json({ success: true, client: updatedClient });
  } catch (error) {
    console.error("Create client error:", error);
    res.status(500).json({ error: "Failed to create client" });
  }
});

app.get('/api/clients', verifyToken, async (req, res) => {
  try {
    // Only publishers can see all clients
    if (req.user.role !== 'publisher') {
      return res.status(403).json({ error: "Access denied. Publishers only." });
    }
    
    const publisherId = req.query.publisherId || req.user.id;
    const clients = await prisma.client.findMany({
      where: { publisherId },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json({ success: true, clients });
  } catch (error) {
    console.error("Fetch clients error:", error);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

app.get('/api/clients/:clientId', async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.clientId }
    });
    
    if (!client) return res.status(404).json({ error: "Client not found" });
    
    // Check authorization
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'muse-jwt-secret');
        // Publisher can see all clients
        if (decoded.role === 'publisher') {
          return res.json({ success: true, client });
        }
      } catch (error) {
        // Invalid token, continue to allow client access
      }
    }
    
    // Client can access their own interview
    res.json({ success: true, client });
  } catch (error) {
    console.error("Fetch client error:", error);
    res.status(500).json({ error: "Failed to fetch client" });
  }
});

app.put('/api/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const existingClient = await prisma.client.findUnique({
      where: { id: clientId }
    });
    
    if (!existingClient) return res.status(404).json({ error: "Client not found" });
    
    // Check authorization
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'muse-jwt-secret');
        // Publisher can update any client
        if (decoded.role === 'publisher') {
          const client = await prisma.client.update({
            where: { id: clientId },
            data: {
              ...req.body,
              lastActive: new Date()
            }
          });
          return res.json({ success: true, client });
        }
      } catch (error) {
        // Invalid token, continue to allow client update
      }
    }
    
    // Client can update their own interview
    const client = await prisma.client.update({
      where: { id: clientId },
      data: {
        ...req.body,
        lastActive: new Date()
      }
    });
    
    res.json({ success: true, client });
  } catch (error) {
    console.error("Update client error:", error);
    res.status(500).json({ error: "Failed to update client" });
  }
});

app.delete('/api/clients/:clientId', verifyToken, async (req, res) => {
  try {
    // Only publishers can delete clients
    if (req.user.role !== 'publisher') {
      return res.status(403).json({ error: "Access denied. Publishers only." });
    }
    
    await prisma.client.delete({
      where: { id: req.params.clientId }
    });
    
    res.json({ success: true, message: 'Client deleted' });
  } catch (error) {
    console.error("Delete client error:", error);
    res.status(500).json({ error: "Failed to delete client" });
  }
});

// ========== AI CHAT (NATURAL CONVERSATION) ==========
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, sport } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const athleteSport = (sport || "baseball").toLowerCase();
    const systemPrompt = getInterviewerPrompt(athleteSport);

    let apiMessages = [{ role: "system", content: systemPrompt }];

    // Add conversation history
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
      temperature: 0.75,  // Slightly higher for natural conversation
      max_tokens: 80,     // Longer for complete sentences
      top_p: 0.9,
      frequency_penalty: 0.5,  // Lower to allow natural repetition
      presence_penalty: 0.4
    });

    let reply = completion.choices[0].message.content.trim();
    
    // Clean up only really bad patterns
    const badPatterns = [
      /\[START_DRAFT\]/gi,
      /\[END_DRAFT\]/gi,
      /^Thanks\.\s*Start with/gi,
      /Who are you today\?/gi
    ];
    
    badPatterns.forEach(pattern => {
      reply = reply.replace(pattern, '');
    });
    
    // Fallback only if completely empty or too short
    if (reply.length < 3) {
      if (message.length < 10) {
        reply = "Hey! Thanks for being here. Where did you grow up?";
      } else {
        reply = "That's interesting. Tell me more about that.";
      }
    }
    
    // Keep it reasonable length (not too strict)
    if (reply.length > 150) {
      const sentences = reply.split(/[.!?]+/).filter(s => s.trim().length > 0);
      reply = sentences.slice(0, 2).join('. ') + '.';
    }

    console.log(`✅ AI: ${reply}`);
    res.json({ reply });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ 
      error: "Chat failed",
      reply: "Sorry, I had a connection issue. Can you repeat that?"
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('💾 Closing database connection...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('💾 Closing database connection...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Muse Server on port ${PORT}`);
  console.log(`📍 https://muse-backend-production-29cd.up.railway.app`);
  console.log(`💾 Using Supabase PostgreSQL database`);
});

