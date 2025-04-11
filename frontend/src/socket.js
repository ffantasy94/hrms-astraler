import { io } from "socket.io-client"
import { frappeRequest } from "frappe-ui"

let socket = null;

export async function initSocket() {
	// Check if we're in a browser environment
	if (typeof window === 'undefined') {
		return null;
	}

	try {
		// Get socket URL from server config
		const response = await frappeRequest({
			url: 'hrms.api.get_socket_url',
			method: 'GET'
		});

		const socketUrl = response?.message?.socket_url || window.location.origin;
		console.log('Initializing socket connection to:', socketUrl);

		socket = io(socketUrl, {
			transports: ['websocket', 'polling'],
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
			timeout: 20000
		});

		socket.on("connect", () => {
			console.log('Socket connected successfully');
		});

		socket.on("connect_error", (error) => {
			console.error('Socket connection error:', error);
		});

		socket.on("disconnect", (reason) => {
			console.log('Socket disconnected:', reason);
		});

		socket.on("hrms:refetch_resource", (data) => {
			console.log('Received refetch resource event:', data);
			if (data.cache_key) {
				let resource = window.frappe?.getCachedResource?.(data.cache_key) ||
							  window.frappe?.getCachedListResource?.(data.cache_key);

				if (resource) {
					resource.reload();
				}
			}
		});

		return socket;
	} catch (error) {
		console.error('Error initializing socket:', error);
		return null;
	}
}

export function getSocket() {
	return socket;
}
