import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { Groq } from 'groq-sdk';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: 'https://construct-iq-ai.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(express.json());

// Initialize Groq AI
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 🌟 Serverless Connection Caching Logic
let isConnected = false;

const connectDB = async (): Promise<any> => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection.db;
  }

  try {
    const dbUri = process.env.MONGODB_URI;
    if (!dbUri) {
      throw new Error('MONGODB_URI environment variable is missing.');
    }

    const con = await mongoose.connect(dbUri, {
      dbName: 'ConstructIQ',
      bufferCommands: false, // সার্ভারলেস এনভায়রনমেন্টের জন্য ফলস রাখা বেস্ট
    });

    isConnected = !!con.connections[0].readyState;
    console.log('🚀 MongoDB Connected Successfully');
    return con.connections[0].db;
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    throw err;
  }
};

// --- Mongoose Schemas & Models ---
const ProjectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  image: { type: String, required: true },
  area: { type: Number, required: true },
  buildingType: { type: String, required: true },
  location: { type: String, required: true },
  aiEstimate: { type: String, required: true },
  userId: { type: String, required: true },
}, { timestamps: true });

// Avoid Model Overwrite Errors in Serverless Redeploys
const Project = mongoose.models.Project || mongoose.model('Project', ProjectSchema);

// --- Extended Request Interface for TypeScript ---
interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

// --- 🔒 Better Auth Token Middleware (Fully Serverless Patch) ---
const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
      res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
      return;
    }

    // 🌟 এখানে অন-ডিমান্ড ডাটাবেজ কানেক্ট হবে, তাই কখনো কানেকশন ড্রপ করবে না
    const db = await connectDB();
    if (!db) {
      res.status(500).json({
        success: false,
        error: 'Database connection is not ready or active. Please retry.'
      });
      return;
    }

    // ১. ডাটাবেজের 'session' কালেকশনে টোকেন চেক
    const sessionDoc = await db.collection('session').findOne({ token: token });

    if (!sessionDoc) {
      res.status(403).json({ success: false, error: 'Invalid token or session expired.' });
      return;
    }

    // সেশন এক্সপায়ার ডেট ভ্যালিডেশন
    if (new Date(sessionDoc.expiresAt) < new Date()) {
      res.status(403).json({ success: false, error: 'Session has expired.' });
      return;
    }

    // ২. সেশনের userId দিয়ে 'user' কালেকশন থেকে ডাটা রিড করা
    const searchUserId = sessionDoc.userId.toString();
    let userObjectId: any = null;

    try {
      if (mongoose.Types.ObjectId.isValid(searchUserId)) {
        userObjectId = new mongoose.Types.ObjectId(searchUserId);
      }
    } catch (e) {
      // Ignore conversion error
    }

    const userDoc = await db.collection('user').findOne({
      $or: [
        { _id: searchUserId },
        ...(userObjectId ? [{ _id: userObjectId }] : []),
        { id: searchUserId }
      ]
    });

    if (!userDoc) {
      res.status(404).json({ success: false, error: 'Associated user not found.' });
      return;
    }

    // রিকোয়েস্ট অবজেক্টে ইউজারের ডাটা পুশ
    req.user = {
      id: userDoc._id.toString(),
      email: userDoc.email,
      name: userDoc.name
    };

    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    res.status(500).json({ success: false, error: 'Authentication internal error.' });
  }
};

// --- Routes ---

app.get('/', async (req: Request, res: Response) => {
  try {
    await connectDB();
    res.send('ConstructIQ AI Server is running via Groq!');
  } catch (err) {
    res.status(500).send('Server status: Database Connection Failing');
  }
});

/**
 * FEATURE A: AI Cost & Material Generator + Save Project (🔒 Secured)
 */
app.post('/api/projects/add', authenticateToken as any, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, image, area, buildingType, location, userId } = req.body;

    if (!title || !image || !area || !buildingType || !location || !userId) {
      res.status(400).json({ success: false, error: 'All fields are required including userId' });
      return;
    }

    const prompt = `You are an expert civil engineer and cost estimator. 
    Create a highly detailed, professional structural material and cost estimation for a ${area} sqft ${buildingType} building located in ${location}. 
    Provide estimated breakdown quantities for: Cement (bags), Steel (tons), Sand (cft), Bricks (pcs), and Total Estimated Budget in BDT.
    Format the response using clean Markdown headers (###) and bullet points. Do not include introductory chit-chat, start directly with the report.`;

    // Call Groq API
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
    });

    const generatedText = chatCompletion.choices[0]?.message?.content || 'Failed to generate estimate due to an AI error.';

    // Ensure database is ready before creating a model document
    await connectDB();

    // Save to MongoDB
    const newProject = new Project({
      title,
      image,
      area,
      buildingType,
      location,
      aiEstimate: generatedText,
      userId
    });

    await newProject.save();

    res.status(201).json({
      success: true,
      message: 'Project created and AI estimate generated successfully!',
      data: newProject
    });

  } catch (error) {
    console.error('Add Project Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

/**
 * GET ALL PROJECTS (Explore Page)
 */
app.get('/api/projects', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();
    const { search, buildingType } = req.query;
    let query: any = {};

    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }
    if (buildingType) {
      query.buildingType = buildingType;
    }

    const projects = await Project.find(query).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch projects' });
  }
});

/**
 * GET SINGLE PROJECT DETAILS
 */
app.get('/api/projects/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await connectDB();
    const { id } = req.params;
    const project = await Project.findById(id);

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    res.status(200).json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch project details' });
  }
});

/**
 * DELETE A PROJECT (🔒 Secured)
 */
app.delete('/api/projects/:id', authenticateToken as any, async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();
    const { id } = req.params;
    await Project.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete project' });
  }
});

/**
 * FEATURE C: AI Smart Construction Assistant / Chatbot
 */
app.post('/api/ai/chat', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ success: false, error: 'Message is required' });
      return;
    }

    const prompt = `You are "ConstructIQ AI Assistant", a smart civil engineering companion. 
    Answer the user's question accurately regarding construction guidelines, building codes, material estimation, or cost optimization.
    User Question: "${message}"`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
    });

    res.status(200).json({ success: true, reply: chatCompletion.choices[0]?.message?.content });
  } catch (error) {
    console.error('AI Chat Error:', error);
    res.status(500).json({ success: false, error: 'AI failed to respond' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`📡 Server running on http://localhost:${PORT}`);
});