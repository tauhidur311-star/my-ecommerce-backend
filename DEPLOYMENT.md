# Backend Deployment Guide

## Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/my-ecommerce-backend.git
   cd my-ecommerce-backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment setup**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration values
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

## Production Deployment

### Option 1: Render.com
1. Connect your GitHub repository to Render
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add environment variables from your .env file

### Option 2: Railway.app
1. Connect GitHub repository
2. Railway will auto-detect the Node.js app
3. Add environment variables
4. Deploy automatically

### Option 3: Heroku
1. Install Heroku CLI
2. Create new app: `heroku create my-ecommerce-api`
3. Add environment variables: `heroku config:set VAR_NAME=value`
4. Deploy: `git push heroku main`

### Option 4: DigitalOcean App Platform
1. Create new app from GitHub repository
2. Configure build and run commands
3. Add environment variables
4. Deploy

## Environment Variables Required

```
MONGODB_URI=mongodb://localhost:27017/ecommerce
JWT_SECRET=your-super-secure-jwt-secret
GOOGLE_CLIENT_ID=your-google-client-id
STRIPE_SECRET_KEY=your-stripe-secret
CLOUDINARY_CLOUD_NAME=your-cloudinary-name
CLOUDINARY_API_KEY=your-cloudinary-key
CLOUDINARY_API_SECRET=your-cloudinary-secret
FRONTEND_URL=https://your-frontend-domain.com
NODE_ENV=production
PORT=5000
```