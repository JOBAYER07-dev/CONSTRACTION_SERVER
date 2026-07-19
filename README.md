# 🏗️ ConstructIQ AI - Backend Server

Backend API for **ConstructIQ AI**, an AI-powered construction cost estimation and project management platform. This server provides authentication, AI-generated construction estimates, project management APIs, and an intelligent construction assistant powered by Groq AI.

## 🌐 Live Links

- **Frontend:** https://construct-iq-ai.vercel.app/
- **Backend API:** https://construct-iq-ai-server.vercel.app

---

# 🚀 Features

- 🔐 Better Auth Session Authentication
- 🤖 AI-powered Construction Cost Estimation (Groq AI)
- 💬 AI Construction Assistant Chat API
- 📂 Project CRUD Operations
- 🔎 Search & Filter Projects
- 🗄 MongoDB Database Integration
- 🌍 CORS Configuration for Frontend
- ⚡ Built with Express.js & TypeScript
- ☁️ Vercel Serverless Deployment

---

# 🛠 Tech Stack

### Backend

- Node.js
- Express.js
- TypeScript
- MongoDB
- Mongoose
- Better Auth
- Groq AI SDK
- dotenv
- CORS

---



# ⚙️ Environment Variables

Create a `.env` file in the root directory.

```env
PORT=5000

MONGODB_URI=your_mongodb_connection_string

GROQ_API_KEY=your_groq_api_key
```

---

# 📦 Installation

Clone the repository

```bash
git clone https://github.com/your-username/construct-iq-ai-server.git
```

Move into the project

```bash
cd construct-iq-ai-server
```

Install dependencies

```bash
npm install
```

Run the development server

```bash
npm run dev
```

Build project

```bash
npm run build
```

Start production server

```bash
npm start
```

---

# 📌 API Endpoints

## Base URL

```
https://construct-iq-ai-server.vercel.app
```

---

## Home

### GET /

Returns server status.

---

## Projects

### POST /api/projects/add

Create a new project and generate AI estimation.

**Protected Route**

---

### GET /api/projects

Get all projects.

Supports:

- Search
- Building Type Filter

Example:

```
/api/projects?search=House
```

```
/api/projects?buildingType=Residential
```

---

### GET /api/projects/:id

Get single project details.

---

### DELETE /api/projects/:id

Delete a project.

**Protected Route**

---

## AI Assistant

### POST /api/ai/chat

Ask construction-related questions.

Example Request

```json
{
  "message": "How much cement is required for a 1200 sqft house?"
}
```

---

# 🔐 Authentication

Protected APIs require a Better Auth session token.

Example

```
Authorization: Bearer YOUR_SESSION_TOKEN
```

---

# 🤖 AI Features

### AI Construction Estimator

Generates:

- Cement Quantity
- Steel Quantity
- Sand Quantity
- Brick Quantity
- Estimated Construction Budget

---

### AI Construction Assistant

Answers questions about:

- Construction Materials
- Building Guidelines
- Cost Optimization
- Civil Engineering
- Structural Planning

Powered by **Groq Llama 3.3 70B Versatile**

---

# 📸 Database Collections

```
Project

User

Session
```

---

# 🚀 Deployment

Backend deployed on

- Vercel

Database

- MongoDB Atlas

---

# 👨‍💻 Author

**Aritro Mazumdar**

Frontend Developer

GitHub:
https://github.com/AritraApon

Portfolio:
https://protfolio-page-one.vercel.app/

LinkedIn:
https://www.linkedin.com/in/aritro-mazumdar-011206apon

---

# ⭐ Support

If you like this project, consider giving it a ⭐ on GitHub.