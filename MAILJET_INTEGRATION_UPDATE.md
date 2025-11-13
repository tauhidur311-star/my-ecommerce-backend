# 📧 Mailjet REST API Integration - UPDATED

## ✅ **MAILJET ALERTING SYSTEM CONFIGURED**

The alerting system has been updated to use **Mailjet REST API** instead of SMTP for better reliability and delivery rates.

---

## 🔧 **CONFIGURATION**

### **Environment Variables**
Add these to your `.env` file:

```env
# Mailjet REST API Configuration
MAILJET_API_KEY=your_mailjet_api_key_here
MAILJET_SECRET_KEY=your_mailjet_secret_key_here

# Email Settings
ALERT_EMAIL=admin@yourdomain.com
FROM_EMAIL=security@yourdomain.com
FROM_NAME=E-commerce Security System

# Optional: Slack Integration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### **Getting Mailjet Credentials**
1. **Login to Mailjet**: Visit [https://app.mailjet.com/](https://app.mailjet.com/)
2. **Go to Account Settings** → **REST API** → **Master API Key & Sub API key**
3. **Copy API Key** and **Secret Key**
4. **Add to your `.env`** file

---

## 🚀 **FEATURES**

### **Email Alerts via Mailjet REST API**
- ✅ **High Reliability**: Direct API calls, no SMTP issues
- ✅ **Delivery Tracking**: Message IDs and status tracking
- ✅ **Rich HTML Emails**: Professional security alert templates
- ✅ **Error Handling**: Detailed logging and fallback handling
- ✅ **Rate Limiting**: Built-in Mailjet rate limit compliance

### **Alert Types Supported**
- 🔒 **Security Events**: Failed logins, CSRF violations, suspicious activity
- 📊 **Performance Issues**: Slow queries, high memory usage, database errors
- 📦 **Inventory Alerts**: Low stock, out of stock, high demand
- ⚠️ **System Alerts**: Server errors, service failures

---

## 📨 **EMAIL TEMPLATE**

The system sends professional HTML emails with:

```html
🚨 CRITICAL Security Alert: Multiple Failed Login Attempts

Title: Multiple Failed Login Attempts
Message: Multiple failed login attempts detected from IP: 192.168.1.100
Severity: high
Timestamp: 2024-01-15T10:30:00.000Z
Environment: production

Additional Details:
{
  "ip": "192.168.1.100", 
  "attempts": 10,
  "timeWindow": "5 minutes",
  "userAgent": "Mozilla/5.0..."
}
```

---

## 🧪 **TESTING THE INTEGRATION**

### **Test Alert Sending**
```javascript
// Test in your backend console or create a test endpoint
const alertingSystem = require('./utils/alertingSystem');

// Test security alert
await alertingSystem.handleSecurityEvent('multiple_failed_logins', {
  severity: 'high',
  ip: '192.168.1.100',
  attempts: 10,
  timeWindow: '5 minutes'
});

// Test inventory alert  
await alertingSystem.handleInventoryAlert('low_stock', {
  productId: 'prod_123',
  productName: 'iPhone 15 Pro',
  currentStock: 5,
  threshold: 10
});
```

### **Verify Email Delivery**
1. **Check Mailjet Dashboard**: Monitor sent emails
2. **Review Application Logs**: Check for delivery confirmations
3. **Test Different Severities**: low, medium, high, critical

---

## 📊 **MONITORING & ANALYTICS**

### **Mailjet Dashboard**
- **Delivery Rates**: Track email delivery success
- **Open Rates**: Monitor if alerts are being read
- **Bounce Rates**: Identify email delivery issues
- **Click Tracking**: Track engagement with alerts

### **Application Logs**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Security alert email sent via Mailjet",
  "alertId": "abc123",
  "severity": "high", 
  "title": "Multiple Failed Login Attempts",
  "messageId": "576460752303116411",
  "status": "success"
}
```

---

## 🔧 **TROUBLESHOOTING**

### **Common Issues**

#### **1. Mailjet API Credentials Invalid**
```
Error: Failed to initialize Mailjet client
```
**Solution**: Verify API key and secret in Mailjet dashboard

#### **2. Email Not Sending**
```
Error: Failed to send alert email via Mailjet
```
**Solutions**:
- Check FROM_EMAIL is verified in Mailjet
- Verify account has sending quota remaining
- Check API rate limits

#### **3. Alerts Not Triggering**
**Solutions**:
- Check environment variables are loaded
- Verify alert severity thresholds
- Test with manual alert trigger

### **Debug Mode**
```env
# Add to .env for debugging
LOG_LEVEL=debug
NODE_ENV=development
```

---

## 🔄 **MIGRATION FROM SMTP**

If you were using SMTP before, the migration is automatic:

### **Old SMTP Environment Variables (Remove These)**
```env
# Remove these old SMTP variables
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587  
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### **New Mailjet Variables (Add These)**
```env
# Add these Mailjet variables
MAILJET_API_KEY=your_mailjet_api_key
MAILJET_SECRET_KEY=your_mailjet_secret_key
FROM_EMAIL=security@yourdomain.com
FROM_NAME=E-commerce Security System
```

---

## 🎯 **BENEFITS OF MAILJET REST API**

| **Feature** | **SMTP** | **Mailjet REST API** |
|-------------|----------|---------------------|
| **Reliability** | Medium | High |
| **Delivery Tracking** | No | Yes |
| **Rate Limiting** | Manual | Automatic |
| **Error Handling** | Basic | Advanced |
| **Analytics** | No | Yes |
| **Template Support** | Limited | Full |
| **Scalability** | Limited | High |

---

## 📈 **NEXT STEPS**

1. **Update Environment Variables**: Add Mailjet credentials
2. **Test Alerts**: Trigger test alerts to verify setup
3. **Monitor Delivery**: Check Mailjet dashboard for analytics
4. **Optimize Templates**: Customize email templates if needed
5. **Set Up Webhooks**: (Optional) For advanced delivery tracking

The Mailjet integration provides enterprise-grade email reliability for your security alerting system! 🎉