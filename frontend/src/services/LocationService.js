import { createResource } from 'frappe-ui'
import dayjs from 'dayjs'

class LocationService {
  constructor() {
    this.watchId = null
    this.isTracking = this.loadTrackingState()
    this.lastCheckinType = null
    this.checkinResource = createResource({
      url: 'hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field',
      auto: false,
    })
    this.shiftResource = createResource({
      url: 'hrms.hr.doctype.shift_assignment.shift_assignment.get_employee_shift_timings',
      auto: false,
    })
    this.locationCheckInterval = null
    this.nextCheckTime = null
  }

  loadTrackingState() {
    return localStorage.getItem('autoCheckinEnabled') === 'true'
  }

  saveTrackingState(state) {
    localStorage.setItem('autoCheckinEnabled', state)
    localStorage.setItem('employeeData', JSON.stringify(this.employee))
  }

  async startTracking(employee) {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by this browser')
      return
    }

    if (this.isTracking) return

    this.isTracking = true
    this.employee = employee
    this.saveTrackingState(true)

    // Get shift timings first
    await this.updateShiftTimings()

    // Start location tracking if we're in a relevant time window
    if (this.shouldTrackLocation()) {
      this.startLocationTracking()
    } else {
      // Schedule next check
      this.scheduleNextCheck()
    }
  }

  async updateShiftTimings() {
    try {
      const response = await this.shiftResource.submit({
        employee: this.employee.name,
        date: dayjs().format('YYYY-MM-DD')
      })

      if (response?.shift_timings?.length) {
        this.shiftTimings = response.shift_timings.map(shift => ({
          start: dayjs(shift.start_datetime),
          end: dayjs(shift.end_datetime),
          checkinBuffer: 30, // minutes before shift start
          checkoutBuffer: 30  // minutes after shift end
        }))
        console.log('Updated shift timings:', this.shiftTimings)
      }
    } catch (error) {
      console.error('Error fetching shift timings:', error)
    }
  }

  shouldTrackLocation() {
    if (!this.shiftTimings?.length) return false

    const now = dayjs()
    return this.shiftTimings.some(shift => {
      const checkinStart = shift.start.subtract(shift.checkinBuffer, 'minute')
      const checkoutEnd = shift.end.add(shift.checkoutBuffer, 'minute')
      return now.isAfter(checkinStart) && now.isBefore(checkoutEnd)
    })
  }

  getNextCheckTime() {
    if (!this.shiftTimings?.length) return null

    const now = dayjs()
    let nextTime = null

    this.shiftTimings.forEach(shift => {
      const checkinStart = shift.start.subtract(shift.checkinBuffer, 'minute')
      const checkoutEnd = shift.end.add(shift.checkoutBuffer, 'minute')

      if (now.isBefore(checkinStart) && (!nextTime || checkinStart.isBefore(nextTime))) {
        nextTime = checkinStart
      }
      if (now.isBefore(checkoutEnd) && (!nextTime || checkoutEnd.isBefore(nextTime))) {
        nextTime = checkoutEnd
      }
    })

    return nextTime
  }

  scheduleNextCheck() {
    const nextTime = this.getNextCheckTime()
    if (!nextTime) return

    const delay = nextTime.diff(dayjs())
    if (delay <= 0) return

    console.log(`Scheduling next location check in ${delay/1000} seconds`)
    
    // Clear any existing timeouts
    if (this.nextCheckTimeout) {
      clearTimeout(this.nextCheckTimeout)
    }

    this.nextCheckTimeout = setTimeout(() => {
      this.updateShiftTimings().then(() => {
        if (this.shouldTrackLocation()) {
          this.startLocationTracking()
        } else {
          this.scheduleNextCheck()
        }
      })
    }, delay)
  }

  startLocationTracking() {
    // For iOS, use getCurrentPosition periodically
    if (this.isIOS()) {
      this.setupIOSLocationTracking()
    } else {
      // For Android and other platforms, use watchPosition
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
  }

  setupIOSLocationTracking() {
    // Clear any existing interval
    if (this.locationCheckInterval) {
      clearInterval(this.locationCheckInterval)
    }

    // Get location immediately
    this.checkLocation()

    // Then set up interval (every 2 minutes)
    this.locationCheckInterval = setInterval(() => {
      if (this.shouldTrackLocation()) {
        this.checkLocation()
      } else {
        // Stop tracking and schedule next check
        this.stopLocationTracking()
        this.scheduleNextCheck()
      }
    }, 120000) // 2 minutes
  }

  stopLocationTracking() {
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
    }

    if (this.locationCheckInterval) {
      clearInterval(this.locationCheckInterval)
      this.locationCheckInterval = null
    }
  }

  stopTracking() {
    this.stopLocationTracking()
    
    if (this.nextCheckTimeout) {
      clearTimeout(this.nextCheckTimeout)
      this.nextCheckTimeout = null
    }

    this.isTracking = false
    this.saveTrackingState(false)
  }

  isIOS() {
    return [
      'iPad Simulator',
      'iPhone Simulator',
      'iPod Simulator',
      'iPad',
      'iPhone',
      'iPod'
    ].includes(navigator.platform)
    || (navigator.userAgent.includes("Mac") && "ontouchend" in document)
  }

  checkLocation() {
    navigator.geolocation.getCurrentPosition(
      this.handlePositionUpdate.bind(this),
      this.handleError.bind(this),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    )
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
    // On iOS, some errors might require requesting permission again
    if (error.code === error.PERMISSION_DENIED) {
      this.stopTracking()
    }
  }

  // Method to restore tracking state
  restoreTracking() {
    if (this.loadTrackingState()) {
      const savedEmployee = JSON.parse(localStorage.getItem('employeeData'))
      if (savedEmployee) {
        this.startTracking(savedEmployee)
      }
    }
  }
}

export default new LocationService() 