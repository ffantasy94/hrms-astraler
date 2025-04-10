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
    this.shiftTimings = []

    // Auto update shift timings at midnight
    this.setupDailyShiftUpdate()
  }

  setupDailyShiftUpdate() {
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    
    const msUntilMidnight = tomorrow - now
    
    setTimeout(() => {
      this.updateShiftTimings()
      // Set up daily interval
      setInterval(() => {
        this.updateShiftTimings()
      }, 24 * 60 * 60 * 1000)
    }, msUntilMidnight)
  }

  loadTrackingState() {
    const state = localStorage.getItem('autoCheckinEnabled') === 'true'
    console.log('Loading tracking state:', state)
    return state
  }

  saveTrackingState(state) {
    console.log('Saving tracking state:', state)
    localStorage.setItem('autoCheckinEnabled', state)
    if (this.employee) {
      localStorage.setItem('employeeData', JSON.stringify(this.employee))
    }
  }

  async startTracking(employee) {
    console.log('Starting tracking for employee:', employee)
    
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by this browser')
      return
    }

    if (this.isTracking) {
      console.log('Already tracking, updating employee data')
      this.employee = employee
      this.saveTrackingState(true)
      return
    }

    this.isTracking = true
    this.employee = employee
    this.saveTrackingState(true)

    // Get shift timings first
    await this.updateShiftTimings()

    // Start location tracking if we're in a relevant time window
    if (this.shouldTrackLocation()) {
      console.log('In tracking window, starting location tracking')
      this.startLocationTracking()
    } else {
      console.log('Outside tracking window, scheduling next check')
      this.scheduleNextCheck()
    }
  }

  async updateShiftTimings() {
    console.log('Updating shift timings...')
    try {
      const response = await this.shiftResource.submit({
        employee: this.employee.name,
        date: dayjs().format('YYYY-MM-DD')
      })

      console.log('Shift timings response:', response)

      if (response?.shift_timings?.length) {
        this.shiftTimings = response.shift_timings.map(shift => ({
          start: dayjs(shift.start_datetime),
          end: dayjs(shift.end_datetime),
          checkinBuffer: 30,
          checkoutBuffer: 30
        }))
        console.log('Updated shift timings:', this.shiftTimings)
      } else {
        console.log('No shift timings found')
        this.shiftTimings = []
      }
    } catch (error) {
      console.error('Error fetching shift timings:', error)
      this.shiftTimings = []
    }
  }

  shouldTrackLocation() {
    if (!this.shiftTimings?.length) {
      console.log('No shift timings available')
      return false
    }

    const now = dayjs()
    const shouldTrack = this.shiftTimings.some(shift => {
      const checkinStart = shift.start.subtract(shift.checkinBuffer, 'minute')
      const checkoutEnd = shift.end.add(shift.checkoutBuffer, 'minute')
      
      const isInWindow = now.isAfter(checkinStart) && now.isBefore(checkoutEnd)
      console.log('Checking time window:', {
        now: now.format('YYYY-MM-DD HH:mm:ss'),
        checkinStart: checkinStart.format('YYYY-MM-DD HH:mm:ss'),
        checkoutEnd: checkoutEnd.format('YYYY-MM-DD HH:mm:ss'),
        isInWindow
      })
      
      return isInWindow
    })

    console.log('Should track location:', shouldTrack)
    return shouldTrack
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

    console.log('Next check time:', nextTime?.format('YYYY-MM-DD HH:mm:ss'))
    return nextTime
  }

  scheduleNextCheck() {
    const nextTime = this.getNextCheckTime()
    if (!nextTime) {
      console.log('No next check time available')
      return
    }

    const delay = nextTime.diff(dayjs())
    if (delay <= 0) {
      console.log('Next check time is in the past')
      return
    }

    console.log(`Scheduling next location check in ${delay/1000} seconds`)
    
    if (this.nextCheckTimeout) {
      clearTimeout(this.nextCheckTimeout)
    }

    this.nextCheckTimeout = setTimeout(() => {
      console.log('Executing scheduled check')
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
    console.log('Starting location tracking')
    if (this.isIOS()) {
      this.setupIOSLocationTracking()
    } else {
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
    console.log('Setting up iOS location tracking')
    if (this.locationCheckInterval) {
      clearInterval(this.locationCheckInterval)
    }

    this.checkLocation()

    this.locationCheckInterval = setInterval(() => {
      if (this.shouldTrackLocation()) {
        console.log('Checking location (iOS interval)')
        this.checkLocation()
      } else {
        console.log('Outside tracking window, stopping iOS tracking')
        this.stopLocationTracking()
        this.scheduleNextCheck()
      }
    }, 120000)
  }

  async checkLocation() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.handlePositionUpdate(position)
          resolve(position)
        },
        (error) => {
          this.handleError(error)
          reject(error)
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      )
    })
  }

  async handlePositionUpdate(position) {
    const { latitude, longitude } = position.coords
    console.log('Got location update:', { latitude, longitude })
    
    try {
      console.log('Attempting check-in/out with coordinates')
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
        console.log('Check-in/out response:', response)
        this.lastCheckinType = response.log_type
      } else {
        console.log('No check-in/out created')
      }
    } catch (error) {
      console.error('Error creating automatic checkin:', error)
    }
  }

  handleError(error) {
    console.error('Location error:', error)
    if (error.code === error.PERMISSION_DENIED) {
      console.log('Location permission denied, stopping tracking')
      this.stopTracking()
    }
  }

  stopLocationTracking() {
    console.log('Stopping location tracking')
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
    console.log('Stopping all tracking')
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

  restoreTracking() {
    console.log('Attempting to restore tracking')
    if (this.loadTrackingState()) {
      const savedEmployee = JSON.parse(localStorage.getItem('employeeData'))
      if (savedEmployee) {
        console.log('Restoring tracking for saved employee:', savedEmployee)
        this.startTracking(savedEmployee)
      } else {
        console.log('No saved employee data found')
      }
    }
  }
}

export default new LocationService() 