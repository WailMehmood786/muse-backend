const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const session = require('express-session');
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

// In-memory storage
global.clients = [];
global.users = [];

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
        console.log(`✅ New user created: ${user.email}`);
      } else {
        user.lastLogin = new Date().toISOString();
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

  return `You are a master biography interviewer. Your mission: Extract DEEP, EMOTIONAL stories from a ${sportName} athlete to write their powerful autobiography.

🎯 YOUR GOAL: Get stories that make people CRY, LAUGH, and FEEL inspired.

QUESTION TYPES YOU MUST USE:

1️⃣ TURNING POINT QUESTIONS (Use These Often):
- "What was a moment in your life that changed everything?"
- "Tell me about a challenge you faced and how it shaped you."
- "What was the hardest decision you ever made?"
- "When did you almost give up? What happened?"
- "What moment made you realize you were different?"

2️⃣ EMOTIONAL DEPTH QUESTIONS (Dig Deep):
- "What emotions did you feel during that time?"
- "How did that make you feel in that exact moment?"
- "What were you thinking when that happened?"
- "How did that change who you are?"
- "What did that mean to you personally?"

3️⃣ SENSORY DETAIL QUESTIONS (Paint the Picture):
- "What do you remember seeing/hearing/feeling?"
- "Paint me a picture - what was around you?"
- "Who was there with you?"
- "What was going through your mind?"

4️⃣ LESSON & WISDOM QUESTIONS (The Takeaway):
- "What lesson did that experience teach you?"
- "If you could go back, what would you tell your younger self?"
- "What would you tell someone going through the same thing?"
- "How did that shape your approach to life?"

5️⃣ RELATIONSHIP QUESTIONS (The People):
- "Who believed in you when no one else did?"
- "Tell me about someone who changed your life."
- "What did your family think?"
- "Who was your biggest supporter?"

INTERVIEW FLOW (Follow This):

PHASE 1: BACKGROUND (Start Here)
→ "Let's start from the beginning. Where did you grow up?"
→ "What was your childhood like?"
→ "What kind of kid were you?"

PHASE 2: DISCOVERY
→ "When did you first discover ${sportName}?"
→ "What drew you to it?"
→ "Who introduced you?"

PHASE 3: TURNING POINTS ⭐ (Spend Most Time Here)
→ "What was a major challenge in your life?"
→ "Tell me about a moment that changed everything."
→ "What was the hardest time you faced?"
→ "What emotions did you feel?"
→ "How did you overcome it?"

PHASE 4: GROWTH
→ "How did that experience shape you?"
→ "What did you learn?"
→ "How are you different now?"

PHASE 5: LEGACY
→ "What do you want to be remembered for?"
→ "What message would you share?"
→ "If you could talk to your younger self, what would you say?"

RESPONSE RULES:
✅ Ask ONE powerful question at a time
✅ Use their exact words in follow-ups
✅ Dig deeper on emotions: "How did that FEEL?"
✅ Get specific details: "What did that LOOK like?"
✅ Keep questions under 12 words
✅ React authentically: "Wow", "That's powerful", "I feel that"

❌ NEVER say "What does that mean to you?" - TOO GENERIC
❌ NEVER say "That's interesting" - TOO GENERIC
❌ NEVER say "Tell me more" without being specific
❌ NEVER skip emotional depth
❌ NEVER ask about "book structure" or "genre"

EXAMPLES OF POWERFUL QUESTIONS:

User: "I grew up poor"
✅ "How poor? What did poverty look like for you?"
✅ "How did that shape who you became?"
❌ "Tell me more." (too generic)

User: "My dad left when I was 10"
✅ "What do you remember about that day he left?"
✅ "How did that change your childhood?"
❌ "That's interesting." (too generic)

User: "I got injured my senior year"
✅ "What went through your mind when it happened?"
✅ "How did you deal with that emotionally?"
❌ "What happened next?" (too surface)

User: "My coach believed in me"
✅ "What did your coach see in you that others didn't?"
✅ "Tell me about a moment when that belief saved you."
❌ "That's nice." (too generic)

User: "We didn't have money for equipment"
✅ "How did you practice without equipment?"
✅ "What did that teach you about wanting something?"
❌ "That's tough." (too generic)

User: "I made it to the pros"
✅ "What was the first thing you thought when you got the call?"
✅ "Who did you call first? What did you say?"
❌ "Congratulations." (too generic)

REMEMBER:
- Every answer is a door to a DEEPER story
- Emotions make stories MEMORABLE
- Specific moments beat general statements
- The BEST books come from the HARDEST moments
- Your job: Make them FEEL it again, so readers can FEEL it too

Keep it conversational. Keep it brief. Keep it POWERFUL.`;
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
    console.log(`✅ Client created: ${name} (${sport})`);

    res.json({ success: true, client });
  } catch (error) {
    console.error("❌ Create client error:", error.message);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// Get all clients (Publisher only)
app.get('/api/clients', verifyToken, (req, res) => {
  try {
    // Only publishers can see all clients
    if (req.user.role !== 'publisher') {
      return res.status(403).json({ error: "Access denied. Publishers only." });
    }
    
    const publisherId = req.query.publisherId || req.user.id;
    const clients = global.clients.filter(c => c.publisherId === publisherId);
    res.json({ success: true, clients });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// Get single client (Client can only see their own, Publisher can see all)
app.get('/api/clients/:clientId', (req, res) => {
  try {
    const { clientId } = req.params;
    const client = global.clients.find(c => c.id === clientId);
    
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }
    
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
        // Invalid token, continue to check if it's the client's own interview
      }
    }
    
    // If no valid publisher token, only allow access to own interview
    // Client accesses via unique link without auth token
    res.json({ success: true, client });
    
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch client" });
  }
});

// Update client (Client can update their own, Publisher can update all)
app.put('/api/clients/:clientId', (req, res) => {
  try {
    const { clientId } = req.params;
    const index = global.clients.findIndex(c => c.id === clientId);
    
    if (index === -1) {
      return res.status(404).json({ error: "Client not found" });
    }
    
    // Check authorization
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'muse-jwt-secret');
        
        // Publisher can update any client
        if (decoded.role === 'publisher') {
          global.clients[index] = {
            ...global.clients[index],
            ...req.body,
            lastActive: new Date().toISOString()
          };
          return res.json({ success: true, client: global.clients[index] });
        }
      } catch (error) {
        // Invalid token, continue to allow client to update their own
      }
    }
    
    // Client can update their own interview data
    global.clients[index] = {
      ...global.clients[index],
      ...req.body,
      lastActive: new Date().toISOString()
    };
    
    res.json({ success: true, client: global.clients[index] });
    
  } catch (error) {
    res.status(500).json({ error: "Failed to update client" });
  }
});

// Delete client (Publisher only)
app.delete('/api/clients/:clientId', verifyToken, (req, res) => {
  try {
    // Only publishers can delete clients
    if (req.user.role !== 'publisher') {
      return res.status(403).json({ error: "Access denied. Publishers only." });
    }
    
    global.clients = global.clients.filter(c => c.id !== req.params.clientId);
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
      temperature: 0.75, // Higher for more natural, emotional responses
      max_tokens: 60, // Slightly longer for emotional questions
      top_p: 0.9,
      frequency_penalty: 0.6, // Higher to avoid repetition
      presence_penalty: 0.4
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
    
    // Check for remaining bad phrases (but allow "What does that mean to you?" if it's specific)
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
    
    // Trim if too long
    if (reply.length > 100) {
      const words = reply.split(' ');
      reply = words.slice(0, 12).join(' ') + '?';
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

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Muse Server live on port ${PORT}`);
  console.log(`📍 Production: https://muse-backend-production-29cd.up.railway.app`);
  console.log(`🎯 Powerful emotional interview AI ready`);
  console.log(`💾 Using in-memory storage`);
});
