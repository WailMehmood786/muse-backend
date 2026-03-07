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

// ========== SIMPLE POWERFUL INTERVIEWER ==========
const getInterviewerPrompt = (sport) => {
  const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);
  
  return `You're interviewing a ${sportName} athlete for their book. Be natural and brief.

STYLE: React (1-2 words) + Ask ONE question. Under 10 words total.

EXAMPLES:
"I grew up poor"
→ "How poor? What did that look like?"

"My dad left at 10"
→ "Ten... What do you remember?"

"I got injured"
→ "Oh no. How did you deal with it?"

"Coach believed in me"
→ "Powerful. What did they see in you?"

"Made it to pros"
→ "Amazing! Who did you tell first?"

QUESTIONS TO ASK:
- "Where did you grow up?"
- "When did you discover ${sportName}?"
- "What was your biggest challenge?"
- "How did that feel?"
- "What kept you going?"
- "Who believed in you?"
- "What did that teach you?"

RULES:
✅ React + ask (under 10 words)
✅ Use their words
✅ One question only
✅ Natural, brief

❌ No "interesting" or "tell me more"
❌ No book/genre questions
❌ No long responses

Keep it real. Keep it short.`;
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

// ========== AI CHAT ==========
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId, history, sport } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    
    const athleteSport = (sport || "baseball").toLowerCase();
    const systemPrompt = getInterviewerPrompt(athleteSport);
    
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
      max_tokens: 50,
      top_p: 0.9,
      frequency_penalty: 0.8,
      presence_penalty: 0.6
    });
    
    let reply = completion.choices[0].message.content.trim();
    
    // Clean up bad patterns
    const badPatterns = [
      /^Thanks\.\s*/gi,
      /Start with.*intro/gi,
      /Who are you today/gi,
      /Let's dive into/gi,
      /What genre/gi,
      /What.*theme/gi,
      /That's interesting/gi,
      /Tell me more\.?$/gi,
      /\[START_DRAFT\]/gi,
      /\[END_DRAFT\]/gi
    ];
    
    badPatterns.forEach(pattern => {
      reply = reply.replace(pattern, '');
    });
    
    reply = reply.replace(/protagonist/gi, 'you');
    reply = reply.replace(/antagonist/gi, 'challenge');
    
    // Fallback if bad
    if (reply.length < 5 || reply.toLowerCase().includes('genre') || reply.toLowerCase().includes('book')) {
      if (message.length < 10) {
        reply = "Where did you grow up?";
      } else {
        reply = "How did that feel?";
      }
    }
    
    // Keep brief
    const sentences = reply.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 1) {
      reply = sentences[0] + '?';
    }
    
    if (reply.length > 80) {
      const words = reply.split(' ');
      reply = words.slice(0, 10).join(' ') + '?';
    }
    
    console.log(`✅ AI: ${reply}`);
    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ 
      error: "Chat failed",
      reply: "Can you repeat that?"
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
