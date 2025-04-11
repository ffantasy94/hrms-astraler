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
    this.initialized = false;
    this.initializationPromise = null;
  }

  async initialize() {
    // If already initialized, return the existing promise
    if (this.initialized) {
      return true;
    }

    // If initialization is in progress, return the existing promise
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Create a new promise for initialization
    this.initializationPromise = (async () => {
      try {
        console.log('Fetching Firebase config from server...');
        
        // Fetch Firebase config from server
        const response = await frappeRequest({
          url: 'hrms.api.get_firebase_config',
          method: 'GET',
          onError: (error) => {
            console.error('Error fetching Firebase config:', error);
            if (error.exc_type === 'ValidationError') {
              console.warn('Firebase configuration is missing in site_config.json. Please contact your system administrator.');
              throw error;
            }
          }
        });

        console.log('Firebase config response:', response);

        if (!response || !response.message) {
          throw new Error('Invalid response format from get_firebase_config');
        }

        // Convert response to Firebase config format
        this.config = {
          apiKey: response.message.firebase_api_key,
          authDomain: response.message.firebase_auth_domain,
          projectId: response.message.firebase_project_id,
          storageBucket: response.message.firebase_storage_bucket,
          messagingSenderId: response.message.firebase_messaging_sender_id,
          appId: response.message.firebase_app_id,
          measurementId: response.message.firebase_measurement_id
        };

        console.log('Firebase config loaded:', this.config);

        // Validate required Firebase config fields
        const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
        const missingFields = requiredFields.filter(field => !this.config[field]);
        
        if (missingFields.length > 0) {
          throw new Error(`Missing required Firebase config fields: ${missingFields.join(', ')}. Please contact your system administrator.`);
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
        const vapidKey = await this.fetchVapidKey();
        
        if (!vapidKey) {
          console.warn('VAPID key not found. Push notifications will not work. Please contact your system administrator.');
          return false;
        }
        
        console.log('Firebase initialization completed successfully');
        this.initialized = true;
        return true;
      } catch (error) {
        console.error('Error initializing Firebase:', error);
        if (error.message.includes('site_config.json')) {
          console.warn('Firebase is not configured. Push notifications will not work.');
        } else {
          console.warn('Failed to initialize Firebase. Push notifications will not work.');
        }
        return false;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  async fetchVapidKey() {
    try {
      // Fetch VAPID key from Frappe backend
      const response = await frappeRequest({
        url: 'hrms.api.get_vapid_key',
        method: 'GET',
        onError: (error) => {
          console.error('Error fetching VAPID key:', error);
          if (error.exc_type === 'ValidationError') {
            console.warn('VAPID key is missing in site_config.json. Please contact your system administrator.');
          }
        }
      });
      
      if (response && response.message && response.message.vapid_key) {
        this.vapidKey = response.message.vapid_key;
        console.log('VAPID key loaded successfully');
        return this.vapidKey;
      }
      
      console.warn('No VAPID key found in response');
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