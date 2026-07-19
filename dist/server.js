"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const groq_sdk_1 = require("groq-sdk");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// Middleware
app.use((0, cors_1.default)({
    origin: 'https://construct-iq-ai.vercel.app',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(express_1.default.json());
// Initialize Groq AI
const groq = new groq_sdk_1.Groq({ apiKey: process.env.GROQ_API_KEY });
// MongoDB Connection
mongoose_1.default.connect(process.env.MONGODB_URI, {
    dbName: 'ConstructIQ',
})
    .then(() => console.log('🚀 MongoDB Connected Successfully'))
    .catch((err) => console.error('MongoDB Connection Error:', err));
// --- Mongoose Schemas & Models ---
const ProjectSchema = new mongoose_1.default.Schema({
    title: { type: String, required: true },
    image: { type: String, required: true },
    area: { type: Number, required: true },
    buildingType: { type: String, required: true },
    location: { type: String, required: true },
    aiEstimate: { type: String, required: true },
    userId: { type: String, required: true },
}, { timestamps: true });
const Project = mongoose_1.default.model('Project', ProjectSchema);
// Better Auth এর সেশন স্কিমা (টোকেন চেক করার জন্য)
const SessionSchema = new mongoose_1.default.Schema({}, { strict: false, collection: 'session' });
const Session = mongoose_1.default.model('Session', SessionSchema);
// Better Auth এর ইউজার স্কিমা
const UserSchema = new mongoose_1.default.Schema({}, { strict: false, collection: 'user' });
const User = mongoose_1.default.model('User', UserSchema);
// --- 🔒 Better Auth Token Middleware (TypeScript & Serverless Fixed) ---
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>
        if (!token) {
            res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
            return;
        }
        // 🌟 TypeScript & Serverless Fix: ডাটাবেজ কানেকশন চেক ও এসাইনমেন্ট
        const db = mongoose_1.default.connection.db;
        if (!db) {
            res.status(500).json({
                success: false,
                error: 'Database connection is not ready or active. Please retry.'
            });
            return;
        }
        // ১. ডাটাবেজের 'session' কালেকশনে টোকেন চেক (db ভ্যারিয়েবল ব্যবহার করে)
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
        let userObjectId = null;
        try {
            if (mongoose_1.default.Types.ObjectId.isValid(searchUserId)) {
                userObjectId = new mongoose_1.default.Types.ObjectId(searchUserId);
            }
        }
        catch (e) {
            // Ignore conversion error
        }
        // (db ভ্যারিয়েবল ব্যবহার করে কুয়েরি)
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
    }
    catch (error) {
        console.error('Auth Middleware Error:', error);
        res.status(500).json({ success: false, error: 'Authentication internal error.' });
    }
};
// --- Routes ---
app.get('/', (req, res) => {
    res.send('ConstructIQ AI Server is running via Groq!');
});
/**
 * FEATURE A: AI Cost & Material Generator + Save Project (🔒 Secured)
 */
app.post('/api/projects/add', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error('Add Project Error:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});
/**
 * GET ALL PROJECTS (Explore Page) (🔒 Secured)
 */
app.get('/api/projects', async (req, res) => {
    try {
        const { search, buildingType } = req.query;
        let query = {};
        if (search) {
            query.title = { $regex: search, $options: 'i' };
        }
        if (buildingType) {
            query.buildingType = buildingType;
        }
        const projects = await Project.find(query).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: projects });
    }
    catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch projects' });
    }
});
/**
 * GET SINGLE PROJECT DETAILS (🔒 Secured)
 */
app.get('/api/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const project = await Project.findById(id);
        if (!project) {
            res.status(404).json({ success: false, error: 'Project not found' });
            return;
        }
        res.status(200).json({ success: true, data: project });
    }
    catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch project details' });
    }
});
/**
 * DELETE A PROJECT (🔒 Secured)
 */
app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await Project.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Project deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: 'Failed to delete project' });
    }
});
/**
 * FEATURE C: AI Smart Construction Assistant / Chatbot (🔒 Secured)
 */
app.post('/api/ai/chat', async (req, res) => {
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
    }
    catch (error) {
        console.error('AI Chat Error:', error);
        res.status(500).json({ success: false, error: 'AI failed to respond' });
    }
});
// Start Server
app.listen(PORT, () => {
    console.log(`📡 Server running on http://localhost:${PORT}`);
});
