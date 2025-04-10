import { createApp } from "vue"
import App from "./App.vue"
import router from "./router"
import { initSocket } from "./socket"

import {
	Button,
	Input,
	setConfig,
	frappeRequest,
	resourcesPlugin,
	FormControl,
} from "frappe-ui"
import { translationsPlugin } from "./plugins/translationsPlugin.js"
import EmptyState from "@/components/EmptyState.vue"

import { IonicVue } from "@ionic/vue"

import { session } from "@/data/session"
import { userResource } from "@/data/user"
import { employeeResource } from "@/data/employee"

import dayjs from "@/utils/dayjs"
import getIonicConfig from "@/utils/ionicConfig"

import FrappePushNotification from "../public/frappe-push-notification"

/* Core CSS required for Ionic components to work properly */
import "@ionic/vue/css/core.css"

/* Theme variables */
import "./theme/variables.css"

import "./main.css"

const app = createApp(App)
const socket = initSocket()

setConfig("resourceFetcher", frappeRequest)
app.use(resourcesPlugin)
app.use(translationsPlugin)

app.component("Button", Button)
app.component("Input", Input)
app.component("FormControl", FormControl)
app.component("EmptyState", EmptyState)

app.use(router)
app.use(IonicVue, getIonicConfig())

if (session?.isLoggedIn && !employeeResource?.data) {
	employeeResource.reload()
}

app.provide("$session", session)
app.provide("$user", userResource)
app.provide("$employee", employeeResource)
app.provide("$socket", socket)
app.provide("$dayjs", dayjs)

async function registerServiceWorker() {
	if ('serviceWorker' in navigator) {
		try {
			// Get config first
			const config = await frappe.getConfig()
			if (!config) {
				console.warn('No config available, skipping service worker registration')
				return
			}

			// Build service worker URL
			let swUrl = '/sw.js'
			if (config) {
				swUrl += `?config=${encodeURIComponent(JSON.stringify(config))}`
			}

			console.log('Registering service worker with URL:', swUrl)
			
			const registration = await navigator.serviceWorker.register(swUrl, {
				scope: '/'
			})
			
			console.log('Service Worker registered successfully:', registration)
			
			// Add event listener for updates
			registration.addEventListener('updatefound', () => {
				const newWorker = registration.installing
				console.log('Service Worker update found:', newWorker)
				
				newWorker.addEventListener('statechange', () => {
					console.log('Service Worker state changed:', newWorker.state)
				})
			})
			
			// Handle errors
			registration.addEventListener('error', (error) => {
				console.error('Service Worker registration error:', error)
			})
			
		} catch (error) {
			console.error('Failed to register service worker:', error)
			// Don't throw error, just log it
		}
	} else {
		console.log('Service Worker not supported')
	}
}

router.isReady().then(async () => {
	if (import.meta.env.DEV) {
		await frappeRequest({
			url: "/api/method/hrms.www.hrms.get_context_for_dev",
		}).then(async (values) => {
			if (!window.frappe) window.frappe = {}
			window.frappe.boot = values
		})
	}

	await translationsPlugin.isReady();
	registerServiceWorker()
	app.mount("#app")
})

router.beforeEach(async (to, _, next) => {
	let isLoggedIn = session.isLoggedIn

	try {
		if (isLoggedIn) await userResource.reload()
	} catch (error) {
		isLoggedIn = false
	}

	if (!isLoggedIn) {
		// password reset page is outside the PWA scope
		if (to.path === "/update-password") {
			return next(false)
		} else if (to.name !== "Login") {
			next({ name: "Login" })
		}
	}

	if (isLoggedIn && to.name !== "InvalidEmployee") {
		await employeeResource.promise
		// user should be an employee to access the app
		// since all views are employee specific
		if (
			!employeeResource?.data ||
			employeeResource?.data?.user_id !== userResource.data.name
		) {
			next({ name: "InvalidEmployee" })
		} else if (to.name === "Login") {
			next({ name: "Home" })
		} else {
			next()
		}
	} else {
		next()
	}
})
