const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

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

// ========== PERSISTENT FILE-BASED STORAGE ==========
const DATA_DIR = path.join(__dirname, 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('✅ Data directory created');
}

// Load data from files
function loadData() {
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
      global.clients = JSON.parse(data);
      console.log(`✅ Loaded ${global.clients.length} clients from storage`);
    } else {
      global.clients = [];
      saveClients();
    }
  } catch (error) {
    console.error('Error loading clients:', error);
    global.clients = [];
  }

  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      global.users = JSON.parse(data);
      console.log(`✅ Loaded ${global.users.length} users from storage`);
    } else {
      global.users = [];
      saveUsers();
    }
  } catch (error) {
    console.error('Error loading users:', error);
    global.users = [];
  }
}

// Save data to files
function saveClients() {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(global.clients, null, 2));
  } catch (error) {
    console.error('Error saving clients:', error);
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(global.users, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
  }
}

// Initialize storage
loadData();

// Auto-save every 30 seconds
setInterval(() => {
  saveClients();
  saveUsers();
}, 30000);

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'muse-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = global.users.find(u => u.id === id);
  done(null, user);
});

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      let user = global.users.find(u => u.googleId === profile.id);
      
      if (!user) {
        user = {
          id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          googleId: profile.id,
          email: profile.emails[0].value,
          name: profile.displayName,
          avatar: profile.photos[0]?.value || null,
          role: 'publisher',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString()
        };
        
        global.users.push(user);
        saveUsers();
        console.log(`✅ New user created: ${user.email}`);
      } else {
        user.lastLogin = new Date().toISOString();
        saveUsers();
        console.log(`✅ User logged in: ${user.email}`);
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
  console.log('✅ Google OAuth configured');
} else {
  console.log('⚠️  Google OAuth not configured (missing credentials)');
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

// Health check
app.get('/', (req, res) => {
  res.send("🚀 Muse Backend is Online!");
});

// --- POWERFUL EMOTIONAL INTERVIEWER PROMPT ---
const getPowerfulInterviewerPrompt = (sport) => {
  const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);

  return `You are a master biography interviewer having a NATURAL CONVERSATION with a ${sportName} athlete. Your mission: Extract DEEP, EMOTIONAL stories to write their powerful autobiography.

🎯 YOUR GOAL: Have a real conversation - REACT to what they say, then ask deeper questions.

🗣️ CONVERSATION STYLE (CRITICAL):
You are NOT a robot asking questions. You are a HUMAN having a conversation.

ALWAYS follow this pattern:
1. REACT to what they just said (1-2 words)
2. THEN ask your next question

EXAMPLES OF NATURAL CONVERSATION:

User: "I grew up in a small town in Texas"
✅ "Texas! What was that like growing up there?"
✅ "Small town life. What do you remember most about it?"
❌ "What was your childhood like?" (no reaction, too robotic)

User: "My dad left when I was 10"
✅ "Man, that's tough. What do you remember about that day?"
✅ "Ten years old... How did that change things for you?"
❌ "How did that make you feel?" (no empathy shown)

User: "I got injured my senior year"
✅ "Oh no. What went through your mind when it happened?"
✅ "Senior year... that must've been devastating. How did you deal with it?"
❌ "What happened next?" (no reaction)

User: "My coach believed in me when nobody else did"
✅ "That's powerful. What did your coach see in you?"
✅ "Wow. Tell me about a moment when that belief saved you."
❌ "Who was your coach?" (missed the emotional moment)

User: "We didn't have money for equipment"
✅ "I can imagine. How did you practice without it?"
✅ "That's real struggle. What did that teach you?"
❌ "What sport did you play?" (ignored their story)

User: "I made it to the pros"
✅ "Amazing! What was the first thing you thought when you got the call?"
✅ "That's incredible. Who did you tell first?"
❌ "Congratulations." (too generic, no follow-up)

User: "I was scared I'd never play again"
✅ "That fear is real. What kept you going?"
✅ "I feel that. How did you push through?"
❌ "What happened after?" (no empathy)

REACTION WORDS TO USE:
- "Wow" / "Man" / "Damn"
- "That's powerful" / "That's real" / "That's tough"
- "I can feel that" / "I hear you" / "I get it"
- "Amazing" / "Incredible" / "Beautiful"
- "Oh no" / "That's hard" / "That hurts"

QUESTION TYPES (After Your Reaction):

1️⃣ TURNING POINT QUESTIONS:
- "What was a moment that changed everything?"
- "When did you almost give up?"
- "What was the hardest decision you made?"

2️⃣ EMOTIONAL DEPTH QUESTIONS:
- "How did that feel in that exact moment?"
- "What were you thinking when that happened?"
- "What emotions hit you?"

3️⃣ SENSORY DETAIL QUESTIONS:
- "What do you remember seeing/hearing?"
- "Paint me a picture - what was around you?"
- "Who was there with you?"

4️⃣ LESSON QUESTIONS:
- "What did that teach you?"
- "How did that shape who you are?"
- "What would you tell your younger self?"

5️⃣ RELATIONSHIP QUESTIONS:
- "Who believed in you?"
- "Tell me about someone who changed your life."
- "Who was your biggest supporter?"

INTERVIEW FLOW:

PHASE 1: BACKGROUND
→ "Let's start from the beginning. Where did you grow up?"
→ "What kind of kid were you?"

PHASE 2: DISCOVERY
→ "When did you first discover ${sportName}?"
→ "What drew you to it?"

PHASE 3: TURNING POINTS ⭐ (Most Important)
→ "What was a major challenge you faced?"
→ "Tell me about a moment that changed everything."
→ "What emotions did you feel?"

PHASE 4: GROWTH
→ "How did that shape you?"
→ "What did you learn?"

PHASE 5: LEGACY
→ "What do you want to be remembered for?"
→ "What message would you share?"

CRITICAL RULES:
✅ ALWAYS react first (1-2 words), THEN ask
✅ Use their exact words in your reaction
✅ Keep total response under 15 words
✅ Sound like a HUMAN, not a robot
✅ Show empathy and emotion

❌ NEVER just ask a question without reacting
❌ NEVER say "That's interesting" or "Tell me more"
❌ NEVER ask about "book structure" or "genre"
❌ NEVER be robotic or formal

REMEMBER:
- You're having a CONVERSATION, not conducting an interview
- REACT to their emotions
- Make them feel HEARD
- Then dig DEEPER

Keep it natural. Keep it brief. Keep it POWERFUL.`;
};

// --- AUTHENTICATION MIDDLEWARE ---
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'muse-jwt-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// --- AUTHENTICATION ROUTES ---

// Publisher Login (Secure)
app.post('/api/publisher/login', async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }
    
    const correctPassword = process.env.PUBLISHER_PASSWORD;
    
    if (!correctPassword) {
      console.error('⚠️  PUBLISHER_PASSWORD not set in environment');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    if (password !== correctPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    const token = jwt.sign(
      { 
        id: 'publisher_1', 
        role: 'publisher',
        name: 'Publisher'
      },
      process.env.JWT_SECRET || 'muse-jwt-secret',
      { expiresIn: '24h' }
    );
    
    res.json({ 
      success: true, 
      token,
      user: {
        id: 'publisher_1',
        name: 'Publisher',
        role: 'publisher'
      }
    });
  } catch (error) {
    console.error('Publisher login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify Publisher Token
app.get('/api/publisher/verify', verifyToken, (req, res) => {
  if (req.user.role !== 'publisher') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  res.json({ 
    success: true, 
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    }
  });
});

// Google OAuth - Initiate
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth - Callback
app.get('/auth/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'https://muse-frontend-three.vercel.app'}?error=auth_failed`,
    session: false 
  }),
  (req, res) => {
    try {
      const token = jwt.sign(
        { 
          id: req.user.id, 
          email: req.user.email, 
          name: req.user.name,
          role: req.user.role 
        },
        process.env.JWT_SECRET || 'muse-jwt-secret',
        { expiresIn: '7d' }
      );
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://muse-frontend-three.vercel.app';
      res.redirect(`${frontendUrl}?token=${token}`);
    } catch (error) {
      console.error('Token generation error:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'https://muse-frontend-three.vercel.app';
      res.redirect(`${frontendUrl}?error=token_failed`);
    }
  }
);

// Get current user
app.get('/api/me', verifyToken, (req, res) => {
  const user = global.users.find(u => u.id === req.user.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
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
});

// Logout
app.post('/api/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Email/Password Registration
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields required' });
    }
    
    const existingUser = global.users.find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = {
      id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      email,
      password: hashedPassword,
      name,
      role: 'publisher',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    global.users.push(user);
    saveUsers();
    
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET || 'muse-jwt-secret',
      { expiresIn: '7d' }
    );
    
    res.json({ 
      success: true, 
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Email/Password Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const user = global.users.find(u => u.email === email && u.password);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValid = await bcrypt.compare(password, user.password);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    user.lastLogin = new Date().toISOString();
    saveUsers();
    
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET || 'muse-jwt-secret',
      { expiresIn: '7d' }
    );
    
    res.json({ 
      success: true, 
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- CLIENT MANAGEMENT ROUTES ---

// Create new client
app.post('/api/clients', verifyToken, (req, res) => {
  try {
    const { name, email, bookTitle, sport, publisherId } = req.body;
    
    if (!name || !email || !bookTitle) {
      return res.status(400).json({ error: "All fields required" });
    }

    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const frontendUrl = process.env.FRONTEND_URL || 'https://muse-frontend-three.vercel.app';
    const uniqueLink = `${frontendUrl}/interview/${clientId}?name=${encodeURIComponent(name)}&book=${encodeURIComponent(bookTitle)}&sport=${sport || 'baseball'}`;

    const client = {
      id: clientId,
      name,
      email,
      bookTitle,
      sport: sport || 'baseball',
      uniqueLink,
      publisherId: publisherId || 'publisher_1',
      sessionId: null,
      lastActive: new Date().toISOString(),
      status: 'pending',
      progress: 0,
      messages: [],
      bookDraft: '',
      wordCount: 0,
      createdAt: new Date().toISOString()
    };

    global.clients.push(client);
    saveClients();
    console.log(`✅ Client created: ${name} (${sport})`);

    res.json({ success: true, client });
  } catch (error) {
    console.error("❌ Create client error:", error.message);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// Get all clients
app.get('/api/clients', (req, res) => {
  try {
    const publisherId = req.query.publisherId || 'publisher_1';
    const clients = global.clients.filter(c => c.publisherId === publisherId);
    res.json({ success: true, clients });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// Get single client
app.get('/api/clients/:clientId', (req, res) => {
  try {
    const client = global.clients.find(c => c.id === req.params.clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });
    res.json({ success: true, client });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch client" });
  }
});

// Update client
app.put('/api/clients/:clientId', (req, res) => {
  try {
    const index = global.clients.findIndex(c => c.id === req.params.clientId);
    if (index === -1) return res.status(404).json({ error: "Client not found" });
    
    global.clients[index] = {
      ...global.clients[index],
      ...req.body,
      lastActive: new Date().toISOString()
    };
    
    saveClients();
    res.json({ success: true, client: global.clients[index] });
  } catch (error) {
    res.status(500).json({ error: "Failed to update client" });
  }
});

// Delete client
app.delete('/api/clients/:clientId', (req, res) => {
  try {
    global.clients = global.clients.filter(c => c.id !== req.params.clientId);
    saveClients();
    res.json({ success: true, message: 'Client deleted' });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete client" });
  }
});

// --- MAIN AI CHAT ROUTE ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId, history, sport } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const athleteSport = (sport || "baseball").toLowerCase();
    console.log(`📝 Interview - Sport: ${athleteSport}, Message: "${message}"`);

    // Get powerful emotional interviewer prompt
    const systemPrompt = getPowerfulInterviewerPrompt(athleteSport);

    let apiMessages = [{ role: "system", content: systemPrompt }];

    // Add ALL conversation history for context
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

    // Add current message
    apiMessages.push({ role: "user", content: message });

    // Call Groq API
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: apiMessages,
      temperature: 0.8,
      max_tokens: 80,
      top_p: 0.9,
      frequency_penalty: 0.7,
      presence_penalty: 0.5
    });

    let reply = completion.choices[0].message.content.trim();
    
    // Aggressive filtering of bad patterns
    const badPatterns = [
      /^Thanks\.\s*/gi,
      /Start with a quick intro\.?\s*/gi,
      /Who are you today\??\s*/gi,
      /Let's dive into the story\.?\s*/gi,
      /What genre of book.*?\?/gi,
      /What is the main theme.*?\?/gi,
      /Who or what opposes.*?\?/gi,
      /That's interesting\.?\s*/gi,
      /Tell me more\.?\s*$/gi,
      /\[START_DRAFT\]/gi,
      /\[END_DRAFT\]/gi
    ];
    
    badPatterns.forEach(pattern => {
      reply = reply.replace(pattern, '');
    });
    
    // Replace bad words
    reply = reply.replace(/protagonist/gi, 'you');
    reply = reply.replace(/antagonist/gi, 'challenge');
    
    // Check for remaining bad phrases
    const badPhrases = [
      'who are you',
      'start with',
      'genre',
      'protagonist',
      'theme',
      'main idea',
      'book',
      'story'
    ];
    
    const lowerReply = reply.toLowerCase();
    const hasBadPhrase = badPhrases.some(phrase => lowerReply.includes(phrase));
    
    // If still bad or too short, use contextual fallback
    if (hasBadPhrase || reply.length < 5) {
      if (message.length < 10) {
        reply = "Let's start from the beginning. Where did you grow up?";
      } else {
        reply = "How did that make you feel?";
      }
    }
    
    // Keep it brief - max 2 sentences
    const sentences = reply.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 2) {
      reply = sentences.slice(0, 2).join('. ') + '.';
    }
    
    // Trim if too long (allow slightly longer for natural conversation)
    if (reply.length > 120) {
      const words = reply.split(' ');
      reply = words.slice(0, 15).join(' ') + '?';
    }

    console.log(`✅ Interviewer: ${reply}`);

    res.json({ reply });

  } catch (error) {
    console.error("❌ Chat error:", error.message);
    res.status(500).json({ 
      error: "Chat failed",
      reply: "I'm having trouble connecting. Can you repeat that?"
    });
  }
});

// Graceful shutdown - save data before exit
process.on('SIGTERM', () => {
  console.log('💾 Saving data before shutdown...');
  saveClients();
  saveUsers();
  console.log('✅ Data saved successfully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('💾 Saving data before shutdown...');
  saveClients();
  saveUsers();
  console.log('✅ Data saved successfully');
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Muse Server live on port ${PORT}`);
  console.log(`📍 Production: https://muse-backend-production-29cd.up.railway.app`);
  console.log(`🎯 Powerful emotional interview AI ready`);
  console.log(`💾 Using persistent file-based storage`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
});
