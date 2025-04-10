import { createResource } from 'frappe-ui'

class LocationService {
  constructor() {
    this.watchId = null
    this.isTracking = false
    this.lastCheckinType = null
    this.checkinResource = createResource({
      url: 'hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field',
      auto: false,
    })
  }

  startTracking(employee) {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by this browser')
      return
    }

    if (this.isTracking) return

    this.isTracking = true
    this.employee = employee

    // Watch position with high accuracy
    this.watchId = navigator.geolocation.watchPosition(
      this.handlePositionUpdate.bind(this),
      this.handleError.bind(this),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    )
  }

  stopTracking() {
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
      this.isTracking = false
    }
  }

  async handlePositionUpdate(position) {
    const { latitude, longitude } = position.coords
    
    try {
      // Check if we should create a check-in/out based on location
      const response = await this.checkinResource.submit({
        employee_field_value: this.employee.name,
        employee_fieldname: 'name',
        timestamp: new Date().toISOString(),
        latitude,
        longitude,
        device_id: 'AUTO_LOCATION',
        skip_auto_attendance: 0
      })

      if (response) {
        // Update last checkin type
        this.lastCheckinType = response.log_type
      }
    } catch (error) {
      console.error('Error creating automatic checkin:', error)
    }
  }

  handleError(error) {
    console.error('Error getting location:', error)
  }
}

export default new LocationService() 