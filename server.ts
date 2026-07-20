import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { Groq } from 'groq-sdk';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: ['http://localhost:3000', 'https://constraction-client.vercel.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  }),
);
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
      dbName: 'constructiON',
      bufferCommands: false, // Disable mongoose buffering to avoid memory leaks in serverless
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
const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    shortDescription: { type: String, required: true },
    fullDescription: { type: String, required: true },
    image: { type: String, required: true },
    area: { type: Number, required: true },
    buildingType: { type: String, required: true },
    location: { type: String, required: true },
    aiEstimate: { type: String, required: true },
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

// Avoid Model Overwrite Errors in Serverless Redeploys
const Project =
  mongoose.models.Project || mongoose.model('Project', ProjectSchema);

// --- Extended Request Interface for TypeScript ---
interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

// --- 🔒 Better Auth Token Middleware (Fully Serverless Patch) ---
const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
      res
        .status(401)
        .json({ success: false, error: 'Access denied. No token provided.' });
      return;
    }

    
    const db = await connectDB();
    if (!db) {
      res.status(500).json({
        success: false,
        error: 'Database connection is not ready or active. Please retry.',
      });
      return;
    }

    // 1. database session collection findOne() call to validate the token and retrieve the session document
    const sessionDoc = await db.collection('session').findOne({ token: token });

    if (!sessionDoc) {
      res
        .status(403)
        .json({ success: false, error: 'Invalid token or session expired.' });
      return;
    }

    // Check if the session has expired
    if (new Date(sessionDoc.expiresAt) < new Date()) {
      res.status(403).json({ success: false, error: 'Session has expired.' });
      return;
    }

    // 2. Retrieve user data using the session's userId
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
        { id: searchUserId },
      ],
    });

    if (!userDoc) {
      res
        .status(404)
        .json({ success: false, error: 'Associated user not found.' });
      return;
    }

    // Push user data into the request object
    req.user = {
      id: userDoc._id.toString(),
      email: userDoc.email,
      name: userDoc.name,
    };

    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    res
      .status(500)
      .json({ success: false, error: 'Authentication internal error.' });
  }
};

// --- Routes ---

app.get('/', async (req: Request, res: Response) => {
  try {
    await connectDB();
    res.send('constructiON AI Server is running via Groq!');
  } catch (err) {
    res.status(500).send('Server status: Database Connection Failing');
  }
});

// --- AI Prompt Builder (supports custom prompt templates + adjustable output length) ---
type PromptStyle = 'standard' | 'detailed' | 'summary';
type OutputLength = 'short' | 'standard' | 'detailed';

const STYLE_INSTRUCTIONS: Record<PromptStyle, string> = {
  standard:
    'Write as a professional structural cost estimation report with clear Markdown headers (###) and bullet points.',
  detailed:
    'Write as a highly detailed technical breakdown, including brief reasoning for each material quantity (e.g. why that much cement/steel is needed for this area and building type), using Markdown headers (###) and bullet points.',
  summary:
    'Write as a concise executive summary aimed at a non-technical client — plain language, short bullet points, minimal jargon.',
};

const LENGTH_INSTRUCTIONS: Record<OutputLength, string> = {
  short:
    'Keep the entire response brief — around 120-180 words total. Only include the core material quantities and the total budget.',
  standard:
    'Keep the entire response moderate in length — around 250-350 words total.',
  detailed:
    'Provide a thorough response — around 450-600 words total, including a short breakdown explanation for each material category.',
};

const buildEstimatePrompt = (
  area: number | string,
  buildingType: string,
  location: string,
  promptStyle: PromptStyle = 'standard',
  outputLength: OutputLength = 'standard',
): string => {
  const styleInstruction =
    STYLE_INSTRUCTIONS[promptStyle] || STYLE_INSTRUCTIONS.standard;
  const lengthInstruction =
    LENGTH_INSTRUCTIONS[outputLength] || LENGTH_INSTRUCTIONS.standard;

  return `You are an expert civil engineer and cost estimator.
Create a structural material and cost estimation for a ${area} sqft ${buildingType} building located in ${location}.
Provide estimated breakdown quantities for: Cement (bags), Steel (tons), Sand (cft), Bricks (pcs), and Total Estimated Budget in BDT.
${styleInstruction}
${lengthInstruction}
Do not include introductory chit-chat, start directly with the report.`;
};

/**
 * FEATURE A (part 1): AI Estimate Generator — PREVIEW ONLY, no DB write.
 * Lets the client generate/regenerate an estimate (with a chosen prompt style
 * and output length) before committing to a final save.
 */
app.post(
  '/api/ai/generate-estimate',
  authenticateToken as any,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { area, buildingType, location, promptStyle, outputLength } =
        req.body as {
          area?: number | string;
          buildingType?: string;
          location?: string;
          promptStyle?: PromptStyle;
          outputLength?: OutputLength;
        };

      if (!area || !buildingType || !location) {
        res.status(400).json({
          success: false,
          error:
            'area, buildingType and location are required to generate an estimate',
        });
        return;
      }

      const prompt = buildEstimatePrompt(
        area,
        buildingType,
        location,
        promptStyle,
        outputLength,
      );

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
      });

      const generatedText =
        chatCompletion.choices[0]?.message?.content ||
        'Failed to generate estimate due to an AI error.';

      res.status(200).json({ success: true, estimate: generatedText });
    } catch (error) {
      console.error('Generate Estimate Error:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to generate estimate' });
    }
  },
);

/**
 * FEATURE A (part 2): AI Cost & Material Generator + Save Project (🔒 Secured)
 */
app.post(
  '/api/projects/add',
  authenticateToken as any,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const {
        title,
        shortDescription,
        fullDescription,
        image,
        area,
        buildingType,
        location,
        userId,
        aiEstimate: preGeneratedEstimate,
        promptStyle,
        outputLength,
      } = req.body;

      if (
        !title ||
        !shortDescription ||
        !fullDescription ||
        !image ||
        !area ||
        !buildingType ||
        !location ||
        !userId
      ) {
        res.status(400).json({
          success: false,
          error: 'All fields are required including userId',
        });
        return;
      }

      // If the client already generated (and possibly regenerated) an estimate
      // during the preview step, reuse it instead of calling the AI again.
      let generatedText: string = preGeneratedEstimate;

      if (
        !generatedText ||
        typeof generatedText !== 'string' ||
        !generatedText.trim()
      ) {
        const prompt = buildEstimatePrompt(
          area,
          buildingType,
          location,
          promptStyle,
          outputLength,
        );

        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'llama-3.3-70b-versatile',
        });

        generatedText =
          chatCompletion.choices[0]?.message?.content ||
          'Failed to generate estimate due to an AI error.';
      }

      // Ensure database is ready before creating a model document
      await connectDB();

      // Save to MongoDB
      const newProject = new Project({
        title,
        shortDescription,
        fullDescription,
        image,
        area,
        buildingType,
        location,
        aiEstimate: generatedText,
        userId,
      });

      await newProject.save();

      res.status(201).json({
        success: true,
        message: 'Project created and AI estimate generated successfully!',
        data: newProject,
      });
    } catch (error) {
      console.error('Add Project Error:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  },
);

/**
 * GET ALL PROJECTS (Explore Page)
 */
app.get('/api/projects', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();
    const { search, buildingType, location, sortBy } = req.query;
    const query: Record<string, unknown> = {};

    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }
    if (buildingType) {
      query.buildingType = buildingType;
    }
    if (location) {
      query.location = { $regex: location, $options: 'i' };
    }

    let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
    if (sortBy === 'oldest') sortOption = { createdAt: 1 };
    else if (sortBy === 'area_asc') sortOption = { area: 1 };
    else if (sortBy === 'area_desc') sortOption = { area: -1 };

    const projects = await Project.find(query).sort(sortOption);
    res.status(200).json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch projects' });
  }
});

/**
 * GET SINGLE PROJECT DETAILS
 */
app.get(
  '/api/projects/:id',
  async (req: AuthRequest, res: Response): Promise<void> => {
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
      res
        .status(500)
        .json({ success: false, error: 'Failed to fetch project details' });
    }
  },
);

/**
 * DELETE A PROJECT (🔒 Secured + Ownership-checked)
 */
app.delete(
  '/api/projects/:id',
  authenticateToken as any,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await connectDB();
      const { id } = req.params;

      const project = await Project.findById(id);

      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }

      // Ownership check — a user may only delete their own projects.
      if (!req.user || project.userId !== req.user.id) {
        res.status(403).json({
          success: false,
          error: 'You are not authorized to delete this project.',
        });
        return;
      }

      await Project.findByIdAndDelete(id);
      res
        .status(200)
        .json({ success: true, message: 'Project deleted successfully' });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to delete project' });
    }
  },
);

/**
 * FEATURE C: AI Smart Construction Assistant / Chatbot
 */
interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY_MESSAGES = 12; // cap context sent to the model (last N turns)

/**
 * Small helper: ask the model for exactly 3 short, natural follow-up
 * questions based on the exchange that just happened. Kept as a separate,
 * cheap, non-streaming call so it never blocks or corrupts the main reply.
 */
const generateFollowUpSuggestions = async (
  userMessage: string,
  assistantReply: string,
): Promise<string[]> => {
  try {
    const suggestionCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You generate exactly 3 short, natural follow-up questions (max 8 words each) ' +
            'that a user might realistically ask next in a civil engineering / construction chat. ' +
            'Respond with ONLY a raw JSON object of the exact shape {"suggestions": ["...", "...", "..."]} ' +
            '— no markdown, no code fences, no extra keys, no explanation.',
        },
        {
          role: 'user',
          content: `User asked: "${userMessage}"\nAssistant replied: "${assistantReply}"\n\nGive the JSON object with 3 short follow-up questions.`,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    });

    const raw = suggestionCompletion.choices[0]?.message?.content || '';

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Model occasionally wraps the JSON in prose/code fences despite
      // instructions — fall back to pulling out the first {...} or [...] block.
      const objectMatch = raw.match(/\{[\s\S]*\}/);
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      const candidate = objectMatch?.[0] || arrayMatch?.[0];
      if (!candidate) {
        console.error(
          'Follow-up suggestions: no JSON found in model output:',
          raw,
        );
        return [];
      }
      parsed = JSON.parse(candidate);
    }

    const list: unknown = Array.isArray(parsed)
      ? parsed
      : (parsed as { suggestions?: unknown })?.suggestions;

    if (Array.isArray(list)) {
      return list
        .filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0,
        )
        .map(s => s.trim())
        .slice(0, 3);
    }

    console.error('Follow-up suggestions: unexpected shape from model:', raw);
    return [];
  } catch (err) {
    console.error('Follow-up Suggestion Error:', err);
    return [];
  }
};

app.post(
  '/api/ai/chat',
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { message, history } = req.body as {
      message?: string;
      history?: ChatHistoryItem[];
    };

    if (!message) {
      res.status(400).json({ success: false, error: 'Message is required' });
      return;
    }

    const systemPrompt = `You are "constructiON AI Assistant", a smart civil engineering companion embedded inside the constructiON platform.
Answer the user's questions accurately regarding construction guidelines, building codes, material estimation, and cost optimization.
You have access to the full conversation so far — use earlier messages to understand follow-up questions
(e.g. "what about steel?" after discussing cement should be understood in context).
Keep answers concise, practical, and focused on civil engineering / construction topics.`;

    // Sanitize + cap the incoming history so a bad payload can't blow up the context window
    const safeHistory: ChatHistoryItem[] = Array.isArray(history)
      ? history
          .filter(
            h =>
              h &&
              (h.role === 'user' || h.role === 'assistant') &&
              typeof h.content === 'string' &&
              h.content.trim().length > 0,
          )
          .slice(-MAX_HISTORY_MESSAGES)
      : [];

    // --- Server-Sent Events setup ---
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx etc.)
    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let fullReply = '';

    try {
      const stream = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          ...safeHistory.map(h => ({
            role: h.role,
            content: h.content,
          })),
          { role: 'user', content: message },
        ],
        model: 'llama-3.3-70b-versatile',
        stream: true,
      });

      for await (const part of stream) {
        const token = part.choices[0]?.delta?.content || '';
        if (token) {
          fullReply += token;
          sendEvent('chunk', { token });
        }
      }

      if (!fullReply.trim()) {
        fullReply = 'Sorry, I could not generate a response. Please try again.';
        sendEvent('chunk', { token: fullReply });
      }

      // Generate follow-up suggestions only after the main reply is complete,
      // so it never delays or interferes with the streamed answer.
      const suggestions = await generateFollowUpSuggestions(message, fullReply);

      sendEvent('done', { success: true, reply: fullReply, suggestions });
      res.end();
    } catch (error) {
      console.error('AI Chat Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'AI failed to respond' });
      } else {
        sendEvent('error', { success: false, error: 'AI failed to respond' });
        res.end();
      }
    }
  },
);

// Start Server
app.listen(PORT, () => {
  console.log(`📡 Server running on http://localhost:${PORT}`);
});
