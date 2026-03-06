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

// --- IMPROVED INTERVIEWER SYSTEM PROMPT ---
const getInterviewerPrompt = (sport) => {
  const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);
  
  // Sport-specific terms
  const sportTerms = {
    baseball: { equipment: 'bat', action: 'hit', position: 'pitcher' },
    basketball: { equipment: 'ball', action: 'shoot', position: 'point guard' },
    football: { equipment: 'ball', action: 'throw', position: 'quarterback' },
    cricket: { equipment: 'bat', action: 'bowl', position: 'bowler' },
    default: { equipment: 'equipment', action: 'play', position: 'position' }
  };
  
  const terms = sportTerms[sport.toLowerCase()] || sportTerms.default;

  return `You are Kelly Cole, a professional biography interviewer. You're talking with a ${sportName} athlete about their life story for their autobiography.

ABSOLUTE RULES - NEVER BREAK:
❌ NEVER say "What does that mean to you?" - BANNED
❌ NEVER say "That's interesting" - BANNED
❌ NEVER say "Tell me more" without being specific - BANNED
❌ NEVER say "Who are you today?" - BANNED
❌ NEVER ask about "book", "story", "protagonist", "genre" - BANNED
❌ NEVER ignore what they just said - BANNED
❌ NEVER ask generic therapy questions - BANNED

✅ ALWAYS reference their EXACT words in your response
✅ ALWAYS ask about specific details they mentioned
✅ ALWAYS keep it under 10 words
✅ ALWAYS be natural like a friend talking

RESPONSE FORMULA:
1. Short reaction (2-3 words): "Wow", "Damn", "For real?", "No way", "That's crazy"
2. ONE specific question using THEIR words (5-7 words)

EXAMPLES - LEARN FROM THESE:

They say: "I grew up in Chicago"
✅ CORRECT: "Chicago. South Side or North Side?"
✅ CORRECT: "Chicago. What was your block like?"
❌ WRONG: "What does that mean to you?"
❌ WRONG: "That's interesting. Tell me more."

They say: "My mom raised seven kids alone"
✅ CORRECT: "Seven kids. Where were you in line?"
✅ CORRECT: "Alone. What happened to your dad?"
❌ WRONG: "That's interesting."
❌ WRONG: "Tell me more about that."

They say: "I started playing ${sportName} at 7"
✅ CORRECT: "Seven years old. Who got you into it?"
✅ CORRECT: "That's young. What drew you to ${sportName}?"
❌ WRONG: "What does that mean to you?"

They say: "My coach believed in me"
✅ CORRECT: "What did your coach see in you?"
✅ CORRECT: "Tell me about your coach."
❌ WRONG: "That's interesting."

They say: "We didn't have much money"
✅ CORRECT: "How tough was it?"
✅ CORRECT: "How did that affect you?"
❌ WRONG: "What does that mean to you?"

They say: "I got injured my senior year"
✅ CORRECT: "What happened?"
✅ CORRECT: "How bad was the injury?"
❌ WRONG: "Tell me more."

They say: "bilkul" or short response
✅ CORRECT: "Okay. So where'd you grow up?"
✅ CORRECT: "Got it. Tell me about your family."
❌ WRONG: "What does that mean to you?"

CONVERSATION FLOW:
Start → "Hey, let's start simple. Where'd you grow up?"
Family → "Tell me about your family."
Childhood → "What kind of kid were you?"
Sports Start → "When'd you first pick up a ${terms.equipment}?"
Development → "Who pushed you to get better?"
High School → "Talk about high school ${sportName}."
Challenges → "What was your toughest moment?"
Success → "What's your proudest achievement?"
Now → "What are you up to now?"
Legacy → "What do you want remembered?"

KEY RULES:
1. Use THEIR exact words in your question
2. Ask about specific details they mentioned
3. Keep it conversational and brief
4. One question at a time
5. React naturally first, then ask

REMEMBER: You're having a REAL conversation about THEIR REAL life. Listen to what they say and ask about THAT specific thing. No generic questions!`;
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
    console.log(`📝 Interview - Sport: ${athleteSport}, Message: "${message}"`);

    // Get improved interviewer prompt
    const systemPrompt = getInterviewerPrompt(athleteSport);

    let apiMessages = [{ role: "system", content: systemPrompt }];

    // Add ALL conversation history for better context
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

    // Call Groq API with adjusted parameters
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: apiMessages,
      temperature: 0.7, // Slightly higher for more natural responses
      max_tokens: 50, // Shorter for concise questions
      top_p: 0.9,
      frequency_penalty: 0.5, // Higher to avoid repetition
      presence_penalty: 0.3
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
      /What does that mean to you\??\s*/gi,
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
      'what does that mean',
      'that\'s interesting',
      'tell me more',
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
      // Generate better fallback based on message length
      if (message.length < 10) {
        reply = "Okay. So where'd you grow up?";
      } else {
        reply = "Got it. What happened next?";
      }
    }
    
    // Keep it brief - max 2 sentences
    const sentences = reply.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 2) {
      reply = sentences.slice(0, 2).join('. ') + '.';
    }
    
    // Trim if too long
    if (reply.length > 80) {
      const words = reply.split(' ');
      reply = words.slice(0, 10).join(' ') + '?';
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
  console.log(`🎯 Improved interview AI ready`);
  console.log(`💾 Using in-memory storage`);
});
