# My E-commerce Backend API

A Node.js/Express backend API for an e-commerce application with user authentication, product management, order processing, and real-time features.

## Features

- **Authentication & Authorization**: JWT-based auth with Google OAuth integration
- **Product Management**: CRUD operations for products, categories, and inventory
- **Order Processing**: Cart management, order placement, and tracking
- **Payment Integration**: Stripe payment gateway support
- **Real-time Features**: Socket.io for notifications and live updates
- **Security**: Rate limiting, CSRF protection, input sanitization
- **File Upload**: Cloudinary integration for image management

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT + Google OAuth
- **Real-time**: Socket.io
- **Payment**: Stripe
- **File Upload**: Cloudinary
- **Email**: Nodemailer
- **Security**: Helmet, Rate limiting, XSS protection

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Environment Setup**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Start production server**:
   ```bash
   npm start
   ```

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: JWT signing secret
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `STRIPE_SECRET_KEY`: Stripe secret key
- `CLOUDINARY_*`: Cloudinary configuration
- `EMAIL_*`: Email service configuration

## API Endpoints

- `/api/auth` - Authentication routes
- `/api/products` - Product management
- `/api/orders` - Order management
- `/api/cart` - Shopping cart
- `/api/admin` - Admin operations
- `/api/payments` - Payment processing

## Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests (to be implemented)

## Project Structure

```
├── config/          # Database configuration
├── middleware/      # Express middleware
├── models/          # Mongoose models
├── routes/          # API route handlers
├── utils/           # Utility functions
├── server.js        # Main application file
└── .env.example     # Environment variables template
```