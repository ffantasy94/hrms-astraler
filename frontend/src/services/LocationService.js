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
      url: 'hrms.api.get_shifts',
      auto: false,
      onError: (error) => {
        console.error('Shift API error:', error)
      }
    })
    this.shiftTypeResource = createResource({
      url: 'frappe.client.get',
      auto: false,
    })
    this.locationCheckInterval = null
    this.nextCheckTime = null
    this.shiftTimings = []
    this.retryCount = 0
    this.maxRetries = 3

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
      // Force update shift timings and check location
      await this.updateShiftTimings()
      if (this.shouldTrackLocation()) {
        console.log('In tracking window, starting location tracking')
        this.startLocationTracking()
      } else {
        console.log('Outside tracking window, scheduling next check')
        this.scheduleNextCheck()
      }
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
      // Get shifts for the employee
      const response = await this.shiftResource.submit({
        employee: this.employee.name
      })

      console.log('Shifts response:', response)

      // Handle both array response and message format
      const shifts = Array.isArray(response) ? response : 
                    (response?.message?.length ? response.message : [])

      console.log('Processed shifts:', shifts)

      if (shifts?.length) {
        // Convert shifts to timings
        this.shiftTimings = shifts.map(shift => {
          console.log('Processing shift:', shift)

          if (!shift.start_time || !shift.end_time || !shift.start_date) {
            console.log('Invalid shift data:', shift)
            return null
          }

          // Parse the date and time strings
          const [startHour, startMinute] = shift.start_time.split(':')
          const endTime = shift.end_time
          const [endHour, endMinute] = endTime.split(':')

          // Use shift start_date as base date
          const baseDate = dayjs(shift.start_date)
          
          const start = baseDate
            .hour(parseInt(startHour))
            .minute(parseInt(startMinute))
            .second(0)
          
          const end = baseDate
            .hour(parseInt(endHour))
            .minute(parseInt(endMinute))
            .second(0)

          // If end time is before start time, it means the shift goes into the next day
          if (end.isBefore(start)) {
            end.add(1, 'day')
          }

          const timing = {
            start,
            end,
            checkinBuffer: 30,
            checkoutBuffer: 30,
            shiftType: shift.shift_type,
            assignment: shift.name,
            startDate: shift.start_date,
            endDate: shift.end_date
          }

          console.log('Created shift timing:', {
            shiftType: timing.shiftType,
            assignment: timing.assignment,
            startDate: timing.startDate,
            endDate: timing.endDate,
            start: timing.start.format('YYYY-MM-DD HH:mm:ss'),
            end: timing.end.format('YYYY-MM-DD HH:mm:ss'),
            checkinBuffer: timing.checkinBuffer,
            checkoutBuffer: timing.checkoutBuffer,
            raw_start: shift.start_time,
            raw_end: shift.end_time
          })

          return timing
        }).filter(Boolean)

        if (this.shiftTimings.length === 0) {
          console.log('No valid shifts found in response')
        } else {
          console.log('Updated shift timings:', this.shiftTimings.map(shift => ({
            shiftType: shift.shiftType,
            assignment: shift.assignment,
            startDate: shift.startDate,
            endDate: shift.endDate,
            start: shift.start.format('YYYY-MM-DD HH:mm:ss'),
            end: shift.end.format('YYYY-MM-DD HH:mm:ss'),
            checkinBuffer: shift.checkinBuffer,
            checkoutBuffer: shift.checkoutBuffer
          })))
        }

        this.retryCount = 0 // Reset retry count on success
      } else {
        console.log('No shifts found in response')
        this.shiftTimings = []
      }
    } catch (error) {
      console.error('Error fetching shift timings:', error)
      this.shiftTimings = []
      
      // Retry logic
      if (this.retryCount < this.maxRetries) {
        this.retryCount++
        console.log(`Retrying shift timings update (${this.retryCount}/${this.maxRetries})...`)
        setTimeout(() => this.updateShiftTimings(), 5000) // Retry after 5 seconds
      } else {
        console.log('Max retries reached, will try again at next check')
        this.retryCount = 0
      }
    }
  }

  shouldTrackLocation() {
    if (!this.shiftTimings?.length) {
      console.log('No shift timings available')
      return false
    }

    const now = dayjs()
    console.log('Current time:', now.format('YYYY-MM-DD HH:mm:ss'))
    
    const shouldTrack = this.shiftTimings.some(shift => {
      // Check if the shift is still active based on start_date and end_date
      const isActive = dayjs(shift.startDate).isBefore(now) && 
                      (!shift.endDate || dayjs(shift.endDate).isAfter(now))

      if (!isActive) {
        console.log('Shift is not active:', {
          shift: shift.shiftType,
          startDate: shift.startDate,
          endDate: shift.endDate,
          now: now.format('YYYY-MM-DD')
        })
        return false
      }

      // Get today's shift times
      const todayStart = now.hour(shift.start.hour())
                           .minute(shift.start.minute())
                           .second(0)
      const todayEnd = now.hour(shift.end.hour())
                         .minute(shift.end.minute())
                         .second(0)

      // If end time is before start time, it means the shift goes into the next day
      if (todayEnd.isBefore(todayStart)) {
        todayEnd.add(1, 'day')
      }

      const checkinStart = todayStart.subtract(shift.checkinBuffer, 'minute')
      const checkoutEnd = todayEnd.add(shift.checkoutBuffer, 'minute')
      
      const isInWindow = now.isAfter(checkinStart) && now.isBefore(checkoutEnd)
      console.log('Checking time window:', {
        shiftType: shift.shiftType,
        assignment: shift.assignment,
        now: now.format('YYYY-MM-DD HH:mm:ss'),
        checkinStart: checkinStart.format('YYYY-MM-DD HH:mm:ss'),
        checkoutEnd: checkoutEnd.format('YYYY-MM-DD HH:mm:ss'),
        isInWindow,
        shiftStart: todayStart.format('YYYY-MM-DD HH:mm:ss'),
        shiftEnd: todayEnd.format('YYYY-MM-DD HH:mm:ss'),
        raw_start: shift.start.format('HH:mm:ss'),
        raw_end: shift.end.format('HH:mm:ss')
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
      console.log('Started watchPosition with ID:', this.watchId)
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