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

import FrappePushNotification from "./frappe-push-notification"

import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

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
			// Initialize Firebase
			const initialized = await FrappePushNotification.initialize();
			if (!initialized) {
				console.warn('Failed to initialize Firebase, skipping service worker registration');
				return;
			}

			// Request permission and get token
			const permission = await FrappePushNotification.requestPermission();
			if (permission) {
				const token = await FrappePushNotification.getToken();
				if (token) {
					console.log('FCM Token:', token);
					
					// Send token to server
					await FrappePushNotification.updateToken(token);
				}
			}

			// Handle foreground messages
			FrappePushNotification.onMessage((payload) => {
				console.log('Received foreground message:', payload);
				
				const notification = new Notification(payload.data.title, {
					body: payload.data.body,
					icon: payload.data.notification_icon || '/icon.png',
					data: {
						url: payload.data.click_action
					}
				});

				notification.onclick = () => {
					window.focus();
					if (payload.data.click_action) {
						window.open(payload.data.click_action, '_blank');
					}
					notification.close();
				};
			});

			// Build service worker URL
			let swUrl = '/sw.js'
			if (FrappePushNotification.config) {
				swUrl += `?config=${encodeURIComponent(JSON.stringify(FrappePushNotification.config))}`
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
	
	// Register service worker in a try-catch block
	try {
		await registerServiceWorker();
	} catch (error) {
		console.error('Error registering service worker:', error);
	}
	
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
