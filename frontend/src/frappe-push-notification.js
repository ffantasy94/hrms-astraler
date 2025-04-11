import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getAnalytics } from "firebase/analytics";
import { frappeRequest } from "frappe-ui";

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
      console.log('Fetching Firebase config from server...');
      
      // Fetch Firebase config from server
      const response = await frappeRequest({
        url: 'hrms.api.get_firebase_config',
        method: 'GET',
        onError: (error) => {
          console.error('Error fetching Firebase config:', error);
        }
      });

      console.log('Firebase config response:', response);

      if (response && response.message) {
        this.config = response.message;
        console.log('Firebase config loaded:', this.config);
      } else {
        throw new Error('Failed to fetch Firebase config: Invalid response format');
      }

      // Validate required Firebase config fields
      const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
      const missingFields = requiredFields.filter(field => !this.config[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required Firebase config fields: ${missingFields.join(', ')}`);
      }

      // Initialize Firebase
      console.log('Initializing Firebase app...');
      this.app = initializeApp(this.config);
      
      // Initialize Analytics
      console.log('Initializing Firebase Analytics...');
      this.analytics = getAnalytics(this.app);
      
      // Initialize Messaging
      console.log('Initializing Firebase Messaging...');
      this.messaging = getMessaging(this.app);
      
      // Get VAPID key from server
      console.log('Fetching VAPID key...');
      await this.fetchVapidKey();
      
      console.log('Firebase initialization completed successfully');
      return true;
    } catch (error) {
      console.error('Error initializing Firebase:', error);
      return false;
    }
  }

  async fetchVapidKey() {
    try {
      // Fetch VAPID key from Frappe backend
      const response = await frappeRequest({
        url: 'hrms.api.get_vapid_key',
        method: 'GET'
      });
      
      if (response && response.message && response.message.vapid_key) {
        this.vapidKey = response.message.vapid_key;
        return this.vapidKey;
      }
      return null;
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
      await frappeRequest({
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