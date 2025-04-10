import { createResource } from 'frappe-ui'
import dayjs from 'dayjs'

class LocationService {
  constructor() {
    this.watchId = null
    this.isTracking = this.loadTrackingState()
    this.lastCheckinType = null
    this.checkinResource = createResource({
      url: 'frappe.client.insert',
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
    this.checkinBuffer = 30  // 30 minutes before shift
    this.checkoutBuffer = 30 // 30 minutes after shift

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

  getCurrentTime() {
    // Force actual current date and time
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth()
    const currentDate = now.getDate()
    const currentHours = now.getHours()
    const currentMinutes = now.getMinutes()
    const currentSeconds = now.getSeconds()

    console.log('System current time:', {
      year: currentYear,
      month: currentMonth + 1,
      date: currentDate,
      hours: currentHours,
      minutes: currentMinutes,
      seconds: currentSeconds
    })

    return dayjs().year(currentYear)
                 .month(currentMonth)
                 .date(currentDate)
                 .hour(currentHours)
                 .minute(currentMinutes)
                 .second(currentSeconds)
  }

  async updateShiftTimings() {
    console.log('Updating shift timings...')
    try {
      const now = dayjs()
      
      // Get shifts for the employee with current date
      const response = await this.shiftResource.submit({
        employee: this.employee.name,
        date: now.format('YYYY-MM-DD')
      })

      console.log('Shifts response:', response)
      console.log('Current time:', now.format('YYYY-MM-DD HH:mm:ss'))

      // Handle both array response and message format
      const shifts = Array.isArray(response) ? response : 
                    (response?.message?.length ? response.message : [])

      if (!shifts?.length) {
        console.log('No shifts found for today')
        this.shiftTimings = []
        return
      }

      // Convert shifts to timings
      this.shiftTimings = shifts.map(shift => {
        if (!shift.start_time || !shift.end_time) {
          console.log('Invalid shift data - missing times:', shift)
          return null
        }

        // Parse shift times
        const [startHour, startMinute] = shift.start_time.split(':').map(Number)
        const [endHour, endMinute] = shift.end_time.split(':').map(Number)
        
        // Create shift window using current date
        const shiftDate = now.startOf('day')
        const start = shiftDate.hour(startHour).minute(startMinute).second(0)
        const end = shiftDate.hour(endHour).minute(endMinute).second(0)
        
        // If end time is before start time, shift ends next day
        const adjustedEnd = end.isBefore(start) ? end.add(1, 'day') : end
        
        // Calculate check windows with buffer
        const checkinStart = start.subtract(this.checkinBuffer, 'minutes')
        const checkoutEnd = adjustedEnd.add(this.checkoutBuffer, 'minutes')

        const timing = {
          shiftType: shift.shift_type,
          assignment: shift.name,
          start: start,
          end: adjustedEnd,
          checkinStart,
          checkoutEnd,
          checkinBuffer: this.checkinBuffer,
          checkoutBuffer: this.checkoutBuffer
        }

        console.log('Processed shift:', {
          type: timing.shiftType,
          assignment: timing.assignment,
          start: timing.start.format('HH:mm'),
          end: timing.end.format('HH:mm'),
          checkinWindow: `${timing.checkinStart.format('HH:mm')} - ${timing.start.format('HH:mm')}`,
          checkoutWindow: `${timing.end.format('HH:mm')} - ${timing.checkoutEnd.format('HH:mm')}`
        })

        return timing
      }).filter(Boolean)

      if (this.shiftTimings.length) {
        console.log(`Found ${this.shiftTimings.length} valid shifts for today`)
      } else {
        console.log('No valid shifts found after processing')
      }

      this.retryCount = 0 // Reset retry count on success
      
    } catch (error) {
      console.error('Error fetching shift timings:', error)
      this.shiftTimings = []
      
      if (this.retryCount < this.maxRetries) {
        this.retryCount++
        console.log(`Retrying shift timings update (${this.retryCount}/${this.maxRetries})...`)
        setTimeout(() => this.updateShiftTimings(), 5000)
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
    
    // Check if current time falls within any shift's check windows
    const shouldTrack = this.shiftTimings.some(shift => {
      const isInCheckinWindow = now.isAfter(shift.checkinStart) && now.isBefore(shift.start)
      const isInCheckoutWindow = now.isAfter(shift.end) && now.isBefore(shift.checkoutEnd)
      const isInShift = now.isAfter(shift.start) && now.isBefore(shift.end)
      
      console.log('Checking windows for shift:', {
        type: shift.shiftType,
        current: now.format('HH:mm'),
        isInCheckinWindow,
        isInCheckoutWindow,
        isInShift,
        checkinWindow: `${shift.checkinStart.format('HH:mm')} - ${shift.start.format('HH:mm')}`,
        shiftWindow: `${shift.start.format('HH:mm')} - ${shift.end.format('HH:mm')}`,
        checkoutWindow: `${shift.end.format('HH:mm')} - ${shift.checkoutEnd.format('HH:mm')}`
      })
      
      return isInCheckinWindow || isInCheckoutWindow || isInShift
    })

    console.log('Should track location:', shouldTrack)
    return shouldTrack
  }

  getNextCheckTime() {
    if (!this.shiftTimings?.length) {
      console.log('No shift timings available for next check')
      return null
    }

    const now = dayjs()
    let nextTime = null

    this.shiftTimings.forEach(shift => {
      const checkPoints = [
        shift.checkinStart,  // Start of check-in window
        shift.start,         // Shift start
        shift.end,          // Shift end
        shift.checkoutEnd   // End of check-out window
      ]

      // Find next check point
      for (const point of checkPoints) {
        if (now.isBefore(point) && (!nextTime || point.isBefore(nextTime))) {
          nextTime = point
        }
      }

      // If we're past all check points for today, look at tomorrow
      if (!nextTime) {
        const tomorrow = shift.checkinStart.add(1, 'day')
        if (!nextTime || tomorrow.isBefore(nextTime)) {
          nextTime = tomorrow
        }
      }
    })

    if (nextTime) {
      console.log('Next check scheduled for:', nextTime.format('YYYY-MM-DD HH:mm:ss'))
    } else {
      console.log('Could not determine next check time')
    }
    
    return nextTime
  }

  scheduleNextCheck() {
    const nextTime = this.getNextCheckTime()
    if (!nextTime) {
      console.log('No next check time available')
      return
    }

    const delay = nextTime.diff(this.getCurrentTime())
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
    try {
      const { latitude, longitude } = position.coords
      console.log('Got location update:', { latitude, longitude })

      // Only attempt check-in/out if we have valid coordinates
      if (!latitude || !longitude) {
        console.log('Invalid coordinates, skipping check-in/out')
        return
      }

      console.log('Attempting check-in/out with coordinates')
      
      // Get current shift timing for the check-in
      const now = dayjs()
      const currentShift = this.shiftTimings.find(shift => {
        return now.isAfter(shift.checkinStart) && now.isBefore(shift.checkoutEnd)
      })

      if (!currentShift) {
        console.log('No active shift found for check-in/out')
        return
      }

      // Determine log type based on time
      let logType = 'IN'
      if (now.isAfter(currentShift.end)) {
        logType = 'OUT'
      }

      // Prepare check-in data
      const checkInData = {
        doc: {
          doctype: 'Employee Checkin',
          employee: this.employee.name,
          log_type: logType,
          time: now.format('YYYY-MM-DD HH:mm:ss'),
          latitude: latitude,
          longitude: longitude
        }
      }

      console.log('Submitting check-in with data:', checkInData)
      const response = await this.checkinResource.submit(checkInData)
      console.log('Check-in response:', response)

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