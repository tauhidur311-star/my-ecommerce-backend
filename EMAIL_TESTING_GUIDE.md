# 🧪 **EMAIL TESTING GUIDE**

## 📧 **How to Test Your Mailjet Email Service**

Multiple ways to test your email functionality after the migration.

---

## 🎯 **METHOD 1: API ENDPOINTS (EASIEST)**

### **Test Endpoints Available:**
- `POST /api/test/test-email` - Send test emails
- `GET /api/test/email-health` - Check email service health

### **Using Postman/Thunder Client:**

#### **1. Health Check**
```
GET http://localhost:5000/api/test/email-health
```

#### **2. Test Verification Email**
```
POST http://localhost:5000/api/test/test-email
Content-Type: application/json

{
  "email": "your-email@gmail.com",
  "type": "verification"
}
```

#### **3. Test Password Reset Email**
```
POST http://localhost:5000/api/test/test-email
Content-Type: application/json

{
  "email": "your-email@gmail.com",
  "type": "password-reset"
}
```

#### **4. Test 2FA Email**
```
POST http://localhost:5000/api/test/test-email
Content-Type: application/json

{
  "email": "your-email@gmail.com",
  "type": "2fa"
}
```

#### **5. Test Generic Email**
```
POST http://localhost:5000/api/test/test-email
Content-Type: application/json

{
  "email": "your-email@gmail.com",
  "type": "generic"
}
```

---

## 🌐 **METHOD 2: CURL COMMANDS (TERMINAL)**

### **Health Check:**
```bash
curl http://localhost:5000/api/test/email-health
```

### **Test Verification Email:**
```bash
curl -X POST http://localhost:5000/api/test/test-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@gmail.com",
    "type": "verification"
  }'
```

### **Test Password Reset:**
```bash
curl -X POST http://localhost:5000/api/test/test-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@gmail.com",
    "type": "password-reset"
  }'
```

### **Test All Email Types:**
```bash
# Verification
curl -X POST http://localhost:5000/api/test/test-email -H "Content-Type: application/json" -d '{"email": "your-email@gmail.com", "type": "verification"}'

# Password Reset  
curl -X POST http://localhost:5000/api/test/test-email -H "Content-Type: application/json" -d '{"email": "your-email@gmail.com", "type": "password-reset"}'

# 2FA Code
curl -X POST http://localhost:5000/api/test/test-email -H "Content-Type: application/json" -d '{"email": "your-email@gmail.com", "type": "2fa"}'

# Welcome Email
curl -X POST http://localhost:5000/api/test/test-email -H "Content-Type: application/json" -d '{"email": "your-email@gmail.com", "type": "welcome"}'

# Generic Email
curl -X POST http://localhost:5000/api/test/test-email -H "Content-Type: application/json" -d '{"email": "your-email@gmail.com", "type": "generic"}'
```

---

## 💻 **METHOD 3: BROWSER (DIRECT)**

### **Health Check (GET request):**
```
http://localhost:5000/api/test/email-health
```

### **For POST Requests, Use Browser Console:**
```javascript
// Open browser console (F12) and run:

// Health check
fetch('http://localhost:5000/api/test/email-health')
  .then(r => r.json())
  .then(console.log);

// Test verification email
fetch('http://localhost:5000/api/test/test-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'your-email@gmail.com',
    type: 'verification'
  })
}).then(r => r.json()).then(console.log);
```

---

## 🖥️ **METHOD 4: NODE.JS CONSOLE/REPL**

### **Start Node.js REPL:**
```bash
cd backend/
node
```

### **Test Commands:**
```javascript
// Load email service
const emailService = require('./utils/emailService');

// Health check
emailService.healthCheck().then(console.log);

// Test verification email
emailService.sendVerificationEmail({
  _id: 'test123',
  email: 'your-email@gmail.com',
  name: 'Test User'
}, 'test-token').then(console.log);

// Test password reset
emailService.sendPasswordResetEmail({
  _id: 'test123',
  email: 'your-email@gmail.com',
  name: 'Test User'
}, 'reset-token').then(console.log);
```

---

## 🛠️ **METHOD 5: CREATE TEST SCRIPT**

### **Create `test-emails.js`:**
```javascript
const emailService = require('./utils/emailService');

async function testEmails() {
  const testEmail = 'your-email@gmail.com'; // Change this!
  
  try {
    console.log('🧪 Testing Email Service...');
    
    // Health check
    console.log('\n1. Health Check:');
    const health = await emailService.healthCheck();
    console.log(health);
    
    // Test user
    const testUser = {
      _id: 'test-' + Date.now(),
      email: testEmail,
      name: 'Test User'
    };
    
    // Test verification email
    console.log('\n2. Testing Verification Email...');
    const verifyResult = await emailService.sendVerificationEmail(testUser, 'test-token');
    console.log('Verification result:', verifyResult);
    
    // Test password reset
    console.log('\n3. Testing Password Reset...');
    const resetResult = await emailService.sendPasswordResetEmail(testUser, 'reset-token');
    console.log('Reset result:', resetResult);
    
    // Test 2FA
    console.log('\n4. Testing 2FA Code...');
    const tfaResult = await emailService.send2FACode(testUser, '123456');
    console.log('2FA result:', tfaResult);
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testEmails();
```

### **Run Test Script:**
```bash
cd backend/
node test-emails.js
```

---

## 📱 **RECOMMENDED TESTING APPS**

### **1. Postman (Most Popular)**
- Download: https://www.postman.com/downloads/
- Import collection with all test endpoints
- Easy to save and reuse tests

### **2. Thunder Client (VS Code Extension)**
- Install in VS Code
- Lightweight alternative to Postman
- Built into your code editor

### **3. Insomnia**
- Download: https://insomnia.rest/download
- Clean interface for API testing

### **4. HTTP Client (IntelliJ/WebStorm)**
- Built into JetBrains IDEs
- Create `.http` files with requests

---

## 🔍 **WHAT TO EXPECT**

### **Successful Response:**
```json
{
  "success": true,
  "message": "Test verification email sent successfully",
  "data": {
    "email": "your-email@gmail.com",
    "type": "verification",
    "messageId": "576460752303116411",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

### **Error Response:**
```json
{
  "success": false,
  "error": "Mailjet API keys not configured",
  "details": "MAILJET_API_KEY and MAILJET_SECRET_KEY environment variables are required"
}
```

### **Health Check Response:**
```json
{
  "success": true,
  "health": {
    "status": "healthy",
    "service": "mailjet_rest_api",
    "isReady": true
  },
  "serviceInfo": {
    "name": "EmailService",
    "type": "mailjet_rest_api",
    "isReady": true,
    "features": [
      "User verification emails",
      "Password reset emails",
      "2FA authentication codes",
      "Order confirmation emails",
      "Welcome emails",
      "Generic email sending"
    ]
  }
}
```

---

## 🎯 **QUICK START TESTING**

### **1. Start Your Server:**
```bash
cd backend/
npm run dev
```

### **2. Quick Health Check:**
```bash
curl http://localhost:5000/api/test/email-health
```

### **3. Send Test Email:**
```bash
curl -X POST http://localhost:5000/api/test/test-email \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@gmail.com", "type": "verification"}'
```

### **4. Check Your Inbox! 📧**

---

## ✅ **TESTING CHECKLIST**

- [ ] Health check returns "healthy" status
- [ ] Verification email received and looks professional
- [ ] Password reset email received with proper formatting
- [ ] 2FA code email received
- [ ] Check Mailjet dashboard for delivery confirmations
- [ ] Check application logs for successful sends
- [ ] Test with different email addresses
- [ ] Verify all email types work

**Ready to test your pure Mailjet email system!** 🚀📧