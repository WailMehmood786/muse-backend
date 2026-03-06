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
  cookie: { secure: false } // Set to true in production with HTTPS
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
      // Find or create user
      let user = global.users.find(u => u.googleId === profile.id);
      
      if (!user) {
        user = {
          id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          googleId: profile.id,
          email: profile.emails[0].value,
          name: profile.displayName,
          avatar: profile.photos[0]?.value || null,
          role: 'publisher', // Default role
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString()
        };
        
        global.users.push(user);
        console.log(`✅ New user created: ${user.email}`);
      } else {
        // Update last login
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

// --- DYNAMIC INTERVIEWER SYSTEM PROMPT ---
const getInterviewerPrompt = (sport) => {
  const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);

  return `You are an expert biography interviewer conducting a one-on-one interview with a ${sportName} athlete to write their autobiography.

YOUR MISSION:
Write their book for them in THEIR voice by asking direct questions, digging deeper, and naturally guiding the conversation from start to finish.

CRITICAL RULES - FOLLOW EXACTLY:
❌ NEVER EVER say "Who are you today?"
❌ NEVER EVER say "Start with a quick intro"
❌ NEVER EVER say "Thanks. Start with..."
❌ NEVER ask about "protagonist", "antagonist", "book structure", "genre", "theme"
❌ NEVER ask "What genre of book would you like to write?"
❌ NEVER use [START_DRAFT] or [END_DRAFT] tags
❌ NEVER repeat the same question to different people
❌ NEVER use pre-written template questions

✅ ALWAYS respond to what THEY just said
✅ ALWAYS ask natural follow-up questions
✅ ALWAYS keep responses under 15 words
✅ ALWAYS be conversational and authentic

INTERVIEW STYLE:
1. Listen to what they say
2. React naturally: "Wow", "That's powerful", "I hear you", "Gotcha"
3. Ask ONE short follow-up question based on their response
4. Dig deeper: "Tell me more", "What happened next?", "How did that feel?"
5. Guide them through their life story naturally

RESPONSE FORMAT:
[Short reaction]. [One brief question]?

CORRECT EXAMPLES:
✅ "Wow. Where did you grow up?"
✅ "That's tough. How did you handle it?"
✅ "I hear you. Tell me about your family."
✅ "Gotcha. What happened next?"
✅ "That's powerful. How did that shape you?"

WRONG EXAMPLES (NEVER USE):
❌ "Thanks. Start with a quick intro. Who are you today?"
❌ "Who are you today?"
❌ "What genre of book would you like to write?"
❌ "What is the main theme or idea?"
❌ "Who or what opposes the protagonist?"
❌ "Let's dive into the story."

WHAT TO EXPLORE (Ask naturally based on their responses):
- Early life and family background
- First experiences with ${sportName}
- Key mentors, coaches, influences
- Turning points and challenges
- Career highlights and struggles
- Personal relationships and family
- Life lessons and wisdom
- Legacy and what they want to be remembered for

REMEMBER: This is a REAL PERSON telling their REAL LIFE STORY. Not a fictional book. Ask about THEIR life, not about characters or plot.`;
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
    
    // Get password from environment variable (NOT in code)
    const correctPassword = process.env.PUBLISHER_PASSWORD;
    
    if (!correctPassword) {
      console.error('⚠️  PUBLISHER_PASSWORD not set in environment');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    // Verify password
    if (password !== correctPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Generate JWT token
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

// --- AUTHENTICATION ROUTES ---

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
      // Generate JWT token
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
      
      // Redirect to frontend with token
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

// Email/Password Registration (Optional)
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields required' });
    }
    
    // Check if user exists
    const existingUser = global.users.find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
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
    
    // Generate token
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

// Email/Password Login (Optional)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Find user
    const user = global.users.find(u => u.email === email && u.password);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    user.lastLogin = new Date().toISOString();
    
    // Generate token
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

// Create new client (Protected)
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
    
    res.json({ success: true, client: global.clients[index] });
  } catch (error) {
    res.status(500).json({ error: "Failed to update client" });
  }
});

// Delete client
app.delete('/api/clients/:clientId', (req, res) => {
  try {
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
    console.log(`📝 Interview - Sport: ${athleteSport}`);

    // Get interviewer-style prompt
    const systemPrompt = getInterviewerPrompt(athleteSport);

    let apiMessages = [{ role: "system", content: systemPrompt }];

    // Add conversation history (last 10 messages for context)
    if (history && history.length > 0) {
      const recentHistory = history.slice(-10);
      recentHistory.forEach(h => {
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
      temperature: 0.6, // Lower for more consistent style
      max_tokens: 60, // Shorter responses
      top_p: 0.85,
      frequency_penalty: 0.3, // Reduce repetition
      presence_penalty: 0.2
    });

    let reply = completion.choices[0].message.content.trim();
    
    // Remove ALL bad patterns aggressively
    reply = reply.replace(/^Thanks\.\s*/gi, '');
    reply = reply.replace(/Start with a quick intro\.?\s*/gi, '');
    reply = reply.replace(/Who are you today\??\s*/gi, '');
    reply = reply.replace(/Let's dive into the story\.?\s*/gi, '');
    reply = reply.replace(/What genre of book.*?\?/gi, '');
    reply = reply.replace(/What is the main theme.*?\?/gi, '');
    reply = reply.replace(/Who or what opposes.*?\?/gi, '');
    reply = reply.replace(/\[START_DRAFT\]/gi, '');
    reply = reply.replace(/\[END_DRAFT\]/gi, '');
    reply = reply.replace(/protagonist/gi, 'you');
    reply = reply.replace(/antagonist/gi, 'challenge');
    
    // If reply is still bad, use a safe default
    const badPhrases = ['who are you', 'start with', 'genre', 'protagonist', 'theme', 'main idea'];
    const hasBadPhrase = badPhrases.some(phrase => reply.toLowerCase().includes(phrase));
    
    if (hasBadPhrase || reply.length < 5) {
      reply = "Tell me more about that.";
    }
    
    // Keep it conversational but brief
    const sentences = reply.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 2) {
      reply = sentences.slice(0, 2).join('. ') + '.';
    }
    
    // If still too long (over 100 chars), trim it
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
  console.log(`🎯 Interview-style AI ready`);
  console.log(`💾 Using in-memory storage`);
});
