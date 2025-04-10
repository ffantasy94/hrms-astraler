import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getAnalytics } from "firebase/analytics";

class FrappePushNotification {
  constructor() {
    this.config = null;
    this.app = null;
    this.messaging = null;
    this.analytics = null;
    this.vapidKey = null;
  }

  async initialize() {
    try {
      // Fetch Firebase config from server
      const response = await frappe.request({
        url: 'hrms.api.get_firebase_config',
        method: 'GET',
        callback: (r) => {
          if (r.message) {
            this.config = r.message;
            return this.config;
          }
          return null;
        }
      });

      if (!this.config) {
        throw new Error('Failed to fetch Firebase config');
      }

      // Initialize Firebase
      this.app = initializeApp(this.config);
      
      // Initialize Analytics
      this.analytics = getAnalytics(this.app);
      
      // Initialize Messaging
      this.messaging = getMessaging(this.app);
      
      // Get VAPID key from server
      await this.fetchVapidKey();
      
      return true;
    } catch (error) {
      console.error('Error initializing Firebase:', error);
      return false;
    }
  }

  async fetchVapidKey() {
    try {
      // Fetch VAPID key from Frappe backend
      const response = await frappe.request({
        url: 'hrms.api.get_vapid_key',
        method: 'GET',
        callback: (r) => {
          if (r.message && r.message.vapid_key) {
            this.vapidKey = r.message.vapid_key;
            return this.vapidKey;
          }
          return null;
        }
      });
      return this.vapidKey;
    } catch (error) {
      console.error('Error fetching VAPID key:', error);
      return null;
    }
  }

  async requestPermission() {
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  async getToken() {
    try {
      if (!this.messaging) {
        await this.initialize();
      }
      
      if (!this.vapidKey) {
        await this.fetchVapidKey();
      }
      
      if (!this.vapidKey) {
        throw new Error('VAPID key not found');
      }

      const token = await getToken(this.messaging, {
        vapidKey: this.vapidKey
      });

      return token;
    } catch (error) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  async updateToken(token) {
    try {
      await frappe.request({
        url: 'hrms.api.update_fcm_token',
        method: 'POST',
        body: {
          fcm_token: token
        }
      });
      return true;
    } catch (error) {
      console.error('Error updating FCM token:', error);
      return false;
    }
  }

  onMessage(callback) {
    if (!this.messaging) {
      console.error('Messaging not initialized');
      return;
    }
    
    onMessage(this.messaging, (payload) => {
      console.log('Received message:', payload);
      if (callback) {
        callback(payload);
      }
    });
  }
}

export default new FrappePushNotification(); 