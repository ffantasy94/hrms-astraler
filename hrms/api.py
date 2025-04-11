import frappe
from frappe import _

@frappe.whitelist()
def get_firebase_config():
    """Get Firebase configuration from site config"""
    try:
        config = {
            "apiKey": frappe.conf.get("firebase_api_key"),
            "authDomain": frappe.conf.get("firebase_auth_domain"),
            "projectId": frappe.conf.get("firebase_project_id"),
            "storageBucket": frappe.conf.get("firebase_storage_bucket"),
            "messagingSenderId": frappe.conf.get("firebase_messaging_sender_id"),
            "appId": frappe.conf.get("firebase_app_id"),
            "measurementId": frappe.conf.get("firebase_measurement_id")
        }
        
        # Check if all required configs are present
        missing_configs = [key for key, value in config.items() if not value]
        if missing_configs:
            frappe.throw(_("Missing Firebase configuration: {0}").format(", ".join(missing_configs)))
            
        return config
    except Exception as e:
        frappe.log_error("Firebase Config Error", str(e))
        frappe.throw(_("Failed to get Firebase configuration"))

@frappe.whitelist()
def get_vapid_key():
    """Get Firebase VAPID key from site config"""
    try:
        vapid_key = frappe.conf.get("firebase_vapid_key")
        if not vapid_key:
            frappe.throw(_("Firebase VAPID key not configured"))
        return {"vapid_key": vapid_key}
    except Exception as e:
        frappe.log_error("VAPID Key Error", str(e))
        frappe.throw(_("Failed to get VAPID key"))

@frappe.whitelist()
def update_fcm_token():
    """Update FCM token for current user"""
    try:
        token = frappe.form_dict.get("fcm_token")
        if not token:
            frappe.throw(_("FCM token is required"))
            
        user = frappe.session.user
        frappe.db.set_value("User", user, "fcm_token", token)
        frappe.db.commit()
        
        return {"message": "Token updated successfully"}
    except Exception as e:
        frappe.log_error("FCM Token Update Error", str(e))
        frappe.throw(_("Failed to update FCM token"))

@frappe.whitelist()
def get_socket_url():
    """Get socket.io URL from site config"""
    try:
        # Use the current domain for socket connection
        protocol = 'https' if frappe.conf.get('ssl_certificate') else 'http'
        host = frappe.conf.get('host_name') or frappe.local.site
        
        socket_url = f"{protocol}://{host}"
        return {"socket_url": socket_url}
    except Exception as e:
        frappe.log_error("Socket URL Error", str(e))
        frappe.throw(_("Failed to get socket URL")) 