const VisitorEvent = require('../models/VisitorEvent');
const Contact = require('../models/Contact');

class AnalyticsAggregations {
  // Get daily views for time series charts
  static async getDailyViews(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return await VisitorEvent.aggregate([
      { $match: { ts: { $gte: startDate } } },
      { 
        $group: {
          _id: {
            year: { $year: "$ts" },
            month: { $month: "$ts" },
            day: { $dayOfMonth: "$ts" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      { 
        $project: {
          date: {
            $dateFromParts: {
              year: "$_id.year", 
              month: "$_id.month", 
              day: "$_id.day"
            }
          },
          count: 1,
          _id: 0
        }
      }
    ]);
  }

  // Get hourly views for last 48 hours
  static async getHourlyViews(hours = 48) {
    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return await VisitorEvent.aggregate([
      { $match: { ts: { $gte: startDate } } },
      { 
        $group: {
          _id: {
            year: { $year: "$ts" },
            month: { $month: "$ts" },
            day: { $dayOfMonth: "$ts" },
            hour: { $hour: "$ts" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 } },
      { 
        $project: {
          datetime: {
            $dateFromParts: {
              year: "$_id.year", 
              month: "$_id.month", 
              day: "$_id.day", 
              hour: "$_id.hour"
            }
          },
          count: 1,
          _id: 0
        }
      }
    ]);
  }

  // Get top pages by views
  static async getTopPages(limit = 10, days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return await VisitorEvent.aggregate([
      { $match: { ts: { $gte: startDate } } },
      { $group: { _id: "$page", views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: limit },
      { $project: { page: "$_id", views: 1, _id: 0 } }
    ]);
  }

  // Get top referrers
  static async getTopReferrers(limit = 10, days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return await VisitorEvent.aggregate([
      { 
        $match: { 
          ts: { $gte: startDate },
          referrer: { $ne: '', $ne: null }
        } 
      },
      { $group: { _id: "$referrer", views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: limit },
      { $project: { referrer: "$_id", views: 1, _id: 0 } }
    ]);
  }

  // Get device breakdown
  static async getDeviceBreakdown(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return await VisitorEvent.aggregate([
      { $match: { ts: { $gte: startDate } } },
      { $group: { _id: "$deviceType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { deviceType: "$_id", count: 1, _id: 0 } }
    ]);
  }

  // Get geographic data
  static async getGeoData(limit = 10, days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return await VisitorEvent.aggregate([
      { 
        $match: { 
          ts: { $gte: startDate },
          country: { $ne: 'Unknown', $ne: null }
        } 
      },
      { $group: { _id: "$country", views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: limit },
      { $project: { country: "$_id", views: 1, _id: 0 } }
    ]);
  }

  // Get contact submissions by subject
  static async getSubmissionsBySubject(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return await Contact.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: "$subject", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { subject: "$_id", count: 1, _id: 0 } }
    ]);
  }

  // Get daily submissions for time series
  static async getDailySubmissions(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return await Contact.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { 
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      { 
        $project: {
          date: {
            $dateFromParts: {
              year: "$_id.year", 
              month: "$_id.month", 
              day: "$_id.day"
            }
          },
          count: 1,
          _id: 0
        }
      }
    ]);
  }

  // Get active sessions count (sessions with activity in last 30 minutes)
  static async getActiveSessions() {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    const result = await VisitorEvent.aggregate([
      { $match: { ts: { $gte: thirtyMinutesAgo } } },
      { $group: { _id: "$sessionId" } },
      { $count: "activeSessions" }
    ]);
    
    return result.length > 0 ? result[0].activeSessions : 0;
  }

  // Get views per minute (last 60 minutes)
  static async getViewsPerMinute() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const result = await VisitorEvent.aggregate([
      { $match: { ts: { $gte: oneHourAgo } } },
      { $count: "totalViews" }
    ]);
    
    const totalViews = result.length > 0 ? result[0].totalViews : 0;
    return Math.round(totalViews / 60);
  }

  // Get submissions per minute (last 60 minutes)
  static async getSubmissionsPerMinute() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const result = await Contact.aggregate([
      { $match: { createdAt: { $gte: oneHourAgo } } },
      { $count: "totalSubmissions" }
    ]);
    
    const totalSubmissions = result.length > 0 ? result[0].totalSubmissions : 0;
    return Math.round(totalSubmissions / 60);
  }

  // Get today's stats
  static async getTodayStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [views, submissions] = await Promise.all([
      VisitorEvent.countDocuments({ ts: { $gte: today } }),
      Contact.countDocuments({ createdAt: { $gte: today } })
    ]);
    
    return { todayViews: views, todaySubmissions: submissions };
  }
}

module.exports = AnalyticsAggregations;